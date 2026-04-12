import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "crypto";
import { db } from "../db/index.js";
import { users, instances, apps, usage_events } from "../db/schema.js";
import { validateManifest, checkMcpCompliance } from "./developer.js";
import { AppError, BadRequestError, NotFoundError } from "../lib/errors.js";
import { getConfig } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("admin");

// ---------------------------------------------------------------------------
// Admin auth middleware — checks X-Admin-Key header against ADMIN_API_KEY env
// ---------------------------------------------------------------------------

const requireAdmin = createMiddleware(async (c, next) => {
  const config = getConfig();

  if (!config.ADMIN_API_KEY) {
    throw new AppError(
      503,
      "ADMIN_DISABLED",
      "Admin API is not configured — set ADMIN_API_KEY"
    );
  }

  const providedKey = c.req.header("X-Admin-Key");
  if (!providedKey) {
    throw new AppError(401, "ADMIN_UNAUTHORIZED", "Missing X-Admin-Key header");
  }

  // Timing-safe comparison — reject immediately if lengths differ (required
  // before timingSafeEqual, which throws if buffers have unequal lengths)
  const expected = Buffer.from(config.ADMIN_API_KEY);
  const provided = Buffer.from(providedKey);

  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw new AppError(401, "ADMIN_UNAUTHORIZED", "Invalid admin key");
  }

  await next();
});

// ---------------------------------------------------------------------------
// Route sub-app
// ---------------------------------------------------------------------------

const adminRoutes = new Hono();
adminRoutes.use("*", requireAdmin);

// ---------------------------------------------------------------------------
// GET /admin/apps/review — List apps pending review
// ---------------------------------------------------------------------------

adminRoutes.get("/apps/review", async (c) => {
  const pendingApps = await db
    .select({
      id: apps.id,
      slug: apps.slug,
      name: apps.name,
      type: apps.type,
      developer_id: apps.developer_id,
      submitted_at: apps.created_at,
      manifest_json: apps.manifest_json,
    })
    .from(apps)
    .where(eq(apps.status, "review"));

  return c.json({ apps: pendingApps });
});

// ---------------------------------------------------------------------------
// POST /admin/apps/:id/approve — Approve with re-validation
// ---------------------------------------------------------------------------

adminRoutes.post("/apps/:id/approve", async (c) => {
  const appId = c.req.param("id");

  const appRows = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
  const app = appRows[0];

  if (!app) throw new NotFoundError("App not found");
  if (app.status !== "review") {
    throw new BadRequestError(`App is ${app.status}, not in review`);
  }

  // Re-validate manifest
  const manifest = app.manifest_json as Record<string, unknown>;
  try {
    validateManifest(manifest);
  } catch (err) {
    return c.json(
      {
        approved: false,
        reason: `Manifest validation failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      422
    );
  }

  // For developer_mcp: re-run MCP compliance test
  if (app.type === "developer_mcp" && app.developer_mcp_url) {
    try {
      await checkMcpCompliance(app.developer_mcp_url);
    } catch (err) {
      return c.json(
        {
          approved: false,
          reason: `MCP compliance check failed: ${err instanceof Error ? err.message : String(err)}`,
        },
        422
      );
    }
  }

  // All checks passed — approve
  await db
    .update(apps)
    .set({ status: "published", updated_at: new Date() })
    .where(eq(apps.id, appId));

  logger.info("App approved", { appId, slug: app.slug });

  return c.json({
    approved: true,
    app: { id: appId, slug: app.slug, status: "published" },
  });
});

// ---------------------------------------------------------------------------
// POST /admin/apps/:id/reject — Reject with feedback
// ---------------------------------------------------------------------------

adminRoutes.post("/apps/:id/reject", async (c) => {
  const appId = c.req.param("id");
  const body = (await c.req.json<unknown>()) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason : "No reason provided";

  const appRows = await db
    .select({ id: apps.id, slug: apps.slug, status: apps.status })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);
  const app = appRows[0];

  if (!app) throw new NotFoundError("App not found");

  await db
    .update(apps)
    .set({ status: "draft", updated_at: new Date() })
    .where(eq(apps.id, appId));

  logger.info("App rejected", { appId, slug: app.slug, reason });

  return c.json({
    app: { id: appId, slug: app.slug, status: "draft" },
    feedback: reason,
  });
});

// ---------------------------------------------------------------------------
// POST /admin/apps/:id/suspend — Suspend a published or degraded app
// ---------------------------------------------------------------------------

adminRoutes.post("/apps/:id/suspend", async (c) => {
  const appId = c.req.param("id");
  const body = (await c.req.json<unknown>()) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason : undefined;

  const appRows = await db
    .select({ id: apps.id, slug: apps.slug, status: apps.status })
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);
  const app = appRows[0];

  if (!app) throw new NotFoundError("App not found");
  if (app.status !== "published" && app.status !== "degraded") {
    throw new BadRequestError(`Cannot suspend app with status: ${app.status}`);
  }

  await db
    .update(apps)
    .set({ status: "suspended", updated_at: new Date() })
    .where(eq(apps.id, appId));

  logger.info("App suspended", { appId, slug: app.slug, reason });

  return c.json({ app: { id: appId, slug: app.slug, status: "suspended" } });
});

// ---------------------------------------------------------------------------
// GET /admin/metrics — Platform-wide metrics
// ---------------------------------------------------------------------------

adminRoutes.get("/metrics", async (c) => {
  const [userCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users);
  const [instanceCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(instances);
  const [publishedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apps)
    .where(eq(apps.status, "published"));
  const [reviewCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apps)
    .where(eq(apps.status, "review"));
  const [degradedCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apps)
    .where(eq(apps.status, "degraded"));
  const [offlineCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apps)
    .where(eq(apps.status, "offline"));
  const [callCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(usage_events);

  return c.json({
    total_users: userCount?.count ?? 0,
    total_instances: instanceCount?.count ?? 0,
    total_apps_published: publishedCount?.count ?? 0,
    apps_pending_review: reviewCount?.count ?? 0,
    apps_degraded: degradedCount?.count ?? 0,
    apps_offline: offlineCount?.count ?? 0,
    total_mcp_calls: callCount?.count ?? 0,
  });
});

// ---------------------------------------------------------------------------
// GET /admin/health — Developer server health status across all non-draft apps
// ---------------------------------------------------------------------------

adminRoutes.get("/health", async (c) => {
  const appList = await db
    .select({
      slug: apps.slug,
      status: apps.status,
      developer_mcp_url: apps.developer_mcp_url,
      last_updated: apps.updated_at,
    })
    .from(apps)
    .where(sql`${apps.status} != 'draft'`);

  return c.json({ apps: appList });
});

export { adminRoutes };
