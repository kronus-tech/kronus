import { createMiddleware } from "hono/factory";
import { eq, and } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { verifyToken } from "../auth/jwt.js";
import { getRedis } from "../lib/redis.js";
import { db } from "../db/index.js";
import { apps, subscriptions } from "../db/schema.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { getRateLimits } from "../relay/types.js";
import {
  UnauthorizedError,
  NotFoundError,
  AppError,
  RateLimitError,
} from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("gateway:auth");

// ---------------------------------------------------------------------------
// Cache TTL for app lookups (seconds)
// ---------------------------------------------------------------------------

const APP_CACHE_TTL = 300; // 5 minutes

// ---------------------------------------------------------------------------
// App shape stored in context — subset of the apps row
// ---------------------------------------------------------------------------

export interface GatewayApp {
  id: string;
  slug: string;
  developer_mcp_url: string;
  pricing_model: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Context variable types — import this in routes that call c.get("gatewayUser") etc.
// ---------------------------------------------------------------------------

export interface GatewayVariables {
  gatewayUser: JWTPayload & {
    sub: string;
    plan: string;
    app_access: string[];
  };
  gatewayApp: GatewayApp;
}

// ---------------------------------------------------------------------------
// SSRF protection — reject URLs that resolve to private/internal networks
// ---------------------------------------------------------------------------

// IPv4 private ranges
const PRIVATE_IP_RE =
  /^(127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

export function isPrivateOrLocalUrl(urlString: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    return true; // unparseable → treat as unsafe
  }

  if (parsed.protocol !== "https:") {
    return true; // only HTTPS allowed
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // Reject hostnames that are plainly internal
  if (host === "localhost") return true;
  if (host.endsWith(".local")) return true;
  if (host.endsWith(".internal")) return true;

  // HUB-41: Block 0.0.0.0 (resolves to loopback on Linux)
  if (host === "0.0.0.0") return true;

  // Reject numeric IPv4 IPs in private ranges
  if (PRIVATE_IP_RE.test(host)) return true;

  // HUB-40: Reject IPv6 private/loopback addresses
  if (host === "::1") return true;
  if (/^fc[0-9a-f]{2}:/i.test(host)) return true;  // fc00::/7 unique local
  if (/^fe[89ab][0-9a-f]:/i.test(host)) return true; // fe80::/10 link-local
  if (/^::ffff:(127\.|10\.|169\.254\.|192\.168\.)/i.test(host)) return true; // IPv4-mapped

  return false;
}

// HUB-39/58: Async DNS resolution check — resolves hostname and validates resolved IPs
export async function isPrivateAfterDnsResolve(urlString: string): Promise<boolean> {
  // First run the string-level check
  if (isPrivateOrLocalUrl(urlString)) return true;

  try {
    const parsed = new URL(urlString);
    const host = parsed.hostname.replace(/^\[|\]$/g, "");

    // If it's already an IP (not a hostname), string check was sufficient
    if (/^[\d.]+$/.test(host) || host.includes(":")) return false;

    // Resolve DNS to get actual IPs
    const { resolve } = await import("dns/promises");
    const addresses = await resolve(host);

    for (const addr of addresses) {
      if (PRIVATE_IP_RE.test(addr)) return true;
      if (addr === "127.0.0.1" || addr === "0.0.0.0") return true;
    }

    // Also check IPv6 records
    try {
      const { resolve6 } = await import("dns/promises");
      const v6Addresses = await resolve6(host);
      for (const addr of v6Addresses) {
        if (addr === "::1") return true;
        if (/^fc[0-9a-f]{2}:/i.test(addr)) return true;
        if (/^fe[89ab][0-9a-f]:/i.test(addr)) return true;
      }
    } catch {
      // No AAAA records — that's fine
    }

    return false;
  } catch {
    // DNS resolution failed — treat as unsafe
    return true;
  }
}

// ---------------------------------------------------------------------------
// Redis-cached app lookup
// ---------------------------------------------------------------------------

async function lookupApp(slug: string): Promise<GatewayApp | null> {
  const redis = getRedis();
  const cacheKey = `gateway:app:${slug}`;

  // Cache read
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    try {
      return JSON.parse(cached) as GatewayApp;
    } catch {
      logger.warn("Corrupt app cache entry, fetching from DB", { slug });
    }
  }

  // Postgres fallback
  const rows = await db
    .select({
      id: apps.id,
      slug: apps.slug,
      developer_mcp_url: apps.developer_mcp_url,
      pricing_model: apps.pricing_model,
      status: apps.status,
    })
    .from(apps)
    .where(eq(apps.slug, slug))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];

  // developer_mcp_url may be null for bundled apps — treat as missing
  if (!row.developer_mcp_url) return null;

  const app: GatewayApp = {
    id: row.id,
    slug: row.slug,
    developer_mcp_url: row.developer_mcp_url,
    pricing_model: row.pricing_model,
    status: row.status,
  };

  // Cache the result
  await redis.setex(cacheKey, APP_CACHE_TTL, JSON.stringify(app));

  return app;
}

// ---------------------------------------------------------------------------
// Subscription check (Redis-first, Postgres fallback)
// ---------------------------------------------------------------------------

async function hasActiveSubscription(
  userId: string,
  appId: string
): Promise<boolean> {
  const redis = getRedis();
  const subKey = `sub:${userId}:${appId}`;

  const cached = await redis.get(subKey);
  if (cached !== null) {
    return cached === "1";
  }

  // Postgres fallback — single query with both conditions
  const rows = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.user_id, userId),
        eq(subscriptions.app_id, appId)
      )
    )
    .limit(1);

  const hasSubscription = rows.length > 0 && rows[0].status === "active";

  // Cache result for 5 minutes
  await redis.setex(subKey, APP_CACHE_TTL, hasSubscription ? "1" : "0");

  return hasSubscription;
}

// ---------------------------------------------------------------------------
// gatewayAuth — main middleware
// ---------------------------------------------------------------------------

export const gatewayAuth = createMiddleware<{ Variables: GatewayVariables }>(
  async (c, next) => {
    // 1. Extract Bearer token
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing or invalid Authorization header");
    }

    const token = authHeader.slice(7);

    // 2. Verify JWT
    let payload: JWTPayload;
    try {
      payload = await verifyToken(token);
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }

    // HUB-49: Reject refresh tokens — only access tokens can use the gateway
    if (payload["type"] === "refresh") {
      throw new UnauthorizedError("Refresh tokens cannot be used for gateway access");
    }

    const userId = payload.sub;
    if (!userId) {
      throw new UnauthorizedError("Token missing sub claim");
    }

    const plan = (payload["plan"] as string | undefined) ?? "free";
    const appAccess = (payload["app_access"] as string[] | undefined) ?? [];

    // 3. Extract and validate app slug format (HUB-47)
    const slug = c.req.param("slug");
    if (!slug || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
      throw new AppError(400, "BAD_REQUEST", "Invalid app slug format");
    }

    // 4. Look up app (Redis cache → Postgres)
    const app = await lookupApp(slug);

    if (!app) {
      throw new NotFoundError(`App '${slug}' not found`);
    }

    // 5. Check app status
    if (app.status === "draft" || app.status === "suspended") {
      throw new NotFoundError(`App '${slug}' is not available`);
    }

    if (app.status === "degraded" || app.status === "offline") {
      throw new AppError(503, "APP_UNAVAILABLE", "App is temporarily unavailable");
    }

    if (app.status !== "published") {
      throw new NotFoundError(`App '${slug}' is not available`);
    }

    // 6. SSRF guard on developer URL
    if (isPrivateOrLocalUrl(app.developer_mcp_url)) {
      logger.error("SSRF: blocked request to internal developer URL", {
        slug,
        developer_mcp_url: app.developer_mcp_url,
      });
      throw new AppError(502, "APP_CONFIG_ERROR", "App configuration error");
    }

    // 7. Access check: paid apps require app_access claim or active subscription
    if (app.pricing_model !== "free") {
      const hasTokenAccess = appAccess.includes(slug);

      if (!hasTokenAccess) {
        // Fall back to live subscription lookup
        const subscribed = await hasActiveSubscription(userId, app.id);
        if (!subscribed) {
          throw new AppError(403, "SUBSCRIPTION_REQUIRED", `An active subscription is required to access '${slug}'`);
        }
      }
    }

    // 8. Rate limit (per-user per-app, using plan limits)
    const limits = getRateLimits(plan);
    const rlResult = await checkRateLimit(
      `gateway:${userId}:${slug}:min`,
      limits.callsPerMin,
      60
    );

    if (!rlResult.allowed) {
      throw new RateLimitError("Gateway rate limit exceeded");
    }

    // 9. Set context variables for downstream handlers
    const gatewayUser = {
      ...payload,
      sub: userId,
      plan,
      app_access: appAccess,
    } as GatewayVariables["gatewayUser"];

    c.set("gatewayUser", gatewayUser);
    c.set("gatewayApp", app);

    await next();
  }
);
