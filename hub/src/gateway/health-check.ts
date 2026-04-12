import { eq, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { apps } from "../db/schema.js";
import { getRedis } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";
import { isPrivateOrLocalUrl } from "./auth-middleware.js";

// ---------------------------------------------------------------------------
// Simple concurrency limiter — avoids importing p-limit or similar
// ---------------------------------------------------------------------------

async function pLimit<T>(tasks: Array<() => Promise<T>>, concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let index = 0;

  async function runNext(): Promise<void> {
    while (index < tasks.length) {
      const i = index++;
      try {
        const value = await tasks[i]();
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

const MAX_CONCURRENT_CHECKS = 20;

const logger = createLogger("health-check");

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PING_TIMEOUT_MS = 10_000; // 10 seconds
const DEGRADED_THRESHOLD = 3;
const OFFLINE_THRESHOLD = 10;

let healthCheckInterval: ReturnType<typeof setInterval> | null = null;

export function startHealthCheck(intervalMs = DEFAULT_INTERVAL_MS): void {
  if (healthCheckInterval) return; // idempotent

  logger.info("Health check started", { interval_ms: intervalMs });

  // Run immediately on start, then on interval
  runHealthChecks().catch((err: unknown) => {
    logger.error("Initial health check failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  });

  healthCheckInterval = setInterval(async () => {
    try {
      await runHealthChecks();
    } catch (err: unknown) {
      logger.error("Health check cycle failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, intervalMs);
}

export function stopHealthCheck(): void {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    logger.info("Health check stopped");
  }
}

async function runHealthChecks(): Promise<void> {
  // Only check published or degraded apps — offline apps are already stopped
  const appsToCheck = await db
    .select({
      id: apps.id,
      slug: apps.slug,
      developer_mcp_url: apps.developer_mcp_url,
      status: apps.status,
    })
    .from(apps)
    .where(or(eq(apps.status, "published"), eq(apps.status, "degraded")));

  // Filter to only apps with a developer URL
  const checkable = appsToCheck.filter((a) => a.developer_mcp_url !== null);

  if (checkable.length === 0) return;

  logger.debug("Running health checks", { app_count: checkable.length });

  // Concurrency-capped checks — one failure must not block others
  const tasks = checkable.map(
    (app) => () => checkAppHealth(app.id, app.slug, app.developer_mcp_url as string, app.status)
  );
  const results = await pLimit(tasks, MAX_CONCURRENT_CHECKS);

  const healthy = results.filter(
    (r) => r.status === "fulfilled" && r.value === true
  ).length;
  const unhealthy = results.filter(
    (r) => r.status === "fulfilled" && r.value === false
  ).length;
  const errors = results.filter((r) => r.status === "rejected").length;

  logger.info("Health check complete", {
    total: checkable.length,
    healthy,
    unhealthy,
    errors,
  });
}

async function checkAppHealth(
  appId: string,
  slug: string,
  mcpUrl: string,
  currentStatus: string
): Promise<boolean> {
  const redis = getRedis();
  const failureKey = `health:${appId}:failures`;

  // SSRF guard — same protection as the gateway proxy
  if (isPrivateOrLocalUrl(mcpUrl)) {
    logger.warn("Health check skipped: private/internal URL", { slug, mcpUrl });
    return false;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

  let healthy = false;

  try {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      signal: controller.signal,
      redirect: "error",
    });

    healthy = response.ok; // 2xx = healthy
    await response.body?.cancel(); // HUB-63: prevent file descriptor leak
  } catch {
    healthy = false;
  } finally {
    clearTimeout(timeout);
  }

  if (healthy) {
    // Reset failure counter on recovery
    await redis.del(failureKey);

    // Promote degraded app back to published
    if (currentStatus === "degraded") {
      await db
        .update(apps)
        .set({ status: "published", updated_at: new Date() })
        .where(eq(apps.id, appId));
      logger.info("App recovered", { slug, from: "degraded", to: "published" });
    }

    return true;
  }

  // Failure path — increment counter with 24h auto-expiry
  const failures = await redis.incr(failureKey);
  await redis.expire(failureKey, 86400); // TTL 24h — auto-cleanup if checks stop

  if (failures >= OFFLINE_THRESHOLD && currentStatus !== "offline") {
    await db
      .update(apps)
      .set({ status: "offline", updated_at: new Date() })
      .where(eq(apps.id, appId));
    logger.warn("App marked offline", { slug, failures });
  } else if (
    failures >= DEGRADED_THRESHOLD &&
    currentStatus === "published"
  ) {
    await db
      .update(apps)
      .set({ status: "degraded", updated_at: new Date() })
      .where(eq(apps.id, appId));
    logger.warn("App marked degraded", { slug, failures });
  } else {
    logger.debug("App health check failed", { slug, failures });
  }

  return false;
}

// For testing
export function getHealthCheckState(): { running: boolean } {
  return { running: healthCheckInterval !== null };
}
