import { Hono } from "hono";
import { eq, and, ilike, or, gt, asc, desc, avg, count, sql } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { db } from "../db/index.js";
import { apps, app_versions, subscriptions, reviews } from "../db/schema.js";
import { signAccessToken, type AccessTokenPayload } from "../auth/jwt.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import {
  BadRequestError,
  NotFoundError,
  AppError,
} from "../lib/errors.js";
import { getConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppSortParam = "popular" | "new" | "name";

interface AppListItem {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
  pricing_model: string;
  price_cents: number;
  icon_url: string | null;
  created_at: Date | null;
}

interface AppVersionSummary {
  version: string;
  changelog: string | null;
  published_at: Date | null;
}

interface AppRating {
  average: number | null;
  count: number;
}

interface AppDetail {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  type: string;
  developer_id: string;
  // developer_mcp_url excluded from public response (HUB-57)
  pricing_model: string;
  price_cents: number;
  status: string;
  manifest_json: unknown;
  download_url: string | null;
  icon_url: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}

interface ManifestJson {
  files?: string[];
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function parseSortParam(raw: string | undefined): AppSortParam {
  if (raw === "new" || raw === "name") return raw;
  return "popular";
}

function parseLimitParam(raw: string | undefined): number {
  const n = raw !== undefined ? parseInt(raw, 10) : 20;
  if (!Number.isFinite(n) || n < 1) return 20;
  if (n > 100) return 100;
  return n;
}

function sanitizeSearchQuery(q: string): string {
  // Trim; escape LIKE metacharacters so they are treated as literals
  return q.trim().replace(/%/g, "\\%").replace(/_/g, "\\_");
}

// ---------------------------------------------------------------------------
// Pagination helper
// ---------------------------------------------------------------------------

function buildCursorFilter(cursor: string | null) {
  if (!cursor) return undefined;
  return gt(apps.id, cursor);
}

// ---------------------------------------------------------------------------
// Rating query helper
// ---------------------------------------------------------------------------

async function fetchRating(appId: string): Promise<AppRating> {
  const rows = await db
    .select({
      average: avg(reviews.rating),
      count: count(reviews.id),
    })
    .from(reviews)
    .where(eq(reviews.app_id, appId));

  const row = rows[0];
  if (!row) return { average: null, count: 0 };

  const rawAvg = row.average;
  const parsedAvg = rawAvg !== null ? parseFloat(String(rawAvg)) : null;

  return {
    average: parsedAvg !== null && Number.isFinite(parsedAvg) ? Math.round(parsedAvg * 10) / 10 : null,
    count: Number(row.count),
  };
}

// ---------------------------------------------------------------------------
// Sub-app — public routes use no Variables; auth routes declare AuthVariables
// ---------------------------------------------------------------------------

const appRoutes = new Hono<{ Variables: AuthVariables }>();

// ---------------------------------------------------------------------------
// GET /apps — list marketplace apps (public)
// ---------------------------------------------------------------------------

appRoutes.get("/", async (c) => {
  const q = c.req.query("q");
  const typeFilter = c.req.query("type");
  const pricingFilter = c.req.query("pricing");
  const sort = parseSortParam(c.req.query("sort"));
  const cursor = c.req.query("cursor") ?? null;
  const limit = parseLimitParam(c.req.query("limit"));

  // Build WHERE conditions — always filter to published only
  const conditions = [eq(apps.status, "published")];

  if (q !== undefined && q.trim() !== "") {
    const sanitized = sanitizeSearchQuery(q);
    const pattern = `%${sanitized}%`;
    conditions.push(
      or(
        ilike(apps.name, pattern),
        ilike(apps.description, pattern)
      ) as ReturnType<typeof eq>
    );
  }

  if (typeFilter !== undefined && typeFilter.trim() !== "") {
    conditions.push(eq(apps.type, typeFilter.trim()));
  }

  if (pricingFilter !== undefined && pricingFilter.trim() !== "") {
    conditions.push(eq(apps.pricing_model, pricingFilter.trim()));
  }

  const cursorFilter = buildCursorFilter(cursor);
  if (cursorFilter !== undefined) {
    conditions.push(cursorFilter);
  }

  // Fetch limit+1 rows to detect next page
  const fetchLimit = limit + 1;

  let orderClause: ReturnType<typeof asc | typeof desc>;
  if (sort === "new") {
    orderClause = desc(apps.created_at);
  } else if (sort === "name") {
    orderClause = asc(apps.name);
  } else {
    // "popular" — use ID as stable tie-breaker (real popularity sort added in Phase 6)
    orderClause = asc(apps.id);
  }

  const rows = await db
    .select({
      id: apps.id,
      slug: apps.slug,
      name: apps.name,
      description: apps.description,
      type: apps.type,
      pricing_model: apps.pricing_model,
      price_cents: apps.price_cents,
      icon_url: apps.icon_url,
      created_at: apps.created_at,
    })
    .from(apps)
    .where(and(...conditions))
    .orderBy(orderClause)
    .limit(fetchLimit);

  const hasNextPage = rows.length > limit;
  const pageRows: AppListItem[] = hasNextPage ? rows.slice(0, limit) : rows;
  const nextCursor = hasNextPage ? (pageRows[pageRows.length - 1]?.id ?? null) : null;

  return c.json({ apps: pageRows, next_cursor: nextCursor }, 200);
});

// ---------------------------------------------------------------------------
// GET /apps/:slug — app detail (public)
// ---------------------------------------------------------------------------

appRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  const appRows = await db
    .select()
    .from(apps)
    .where(and(eq(apps.slug, slug), eq(apps.status, "published")))
    .limit(1);

  const app = appRows[0];
  if (!app) {
    throw new NotFoundError("App not found");
  }

  // Latest published version
  const versionRows = await db
    .select({
      version: app_versions.version,
      changelog: app_versions.changelog,
      published_at: app_versions.published_at,
    })
    .from(app_versions)
    .where(eq(app_versions.app_id, app.id))
    .orderBy(desc(app_versions.published_at))
    .limit(1);

  const latestVersion: AppVersionSummary | null = versionRows[0] ?? null;

  const rating = await fetchRating(app.id);

  const appDetail: AppDetail = {
    id: app.id,
    slug: app.slug,
    name: app.name,
    description: app.description,
    type: app.type,
    developer_id: app.developer_id,
    // HUB-57: developer_mcp_url intentionally excluded — internal infrastructure
    pricing_model: app.pricing_model,
    price_cents: app.price_cents,
    status: app.status,
    manifest_json: app.manifest_json,
    download_url: app.download_url,
    icon_url: app.icon_url,
    created_at: app.created_at,
    updated_at: app.updated_at,
  };

  return c.json({ app: appDetail, latest_version: latestVersion, rating }, 200);
});

// ---------------------------------------------------------------------------
// POST /apps/:slug/install — install an app (requires auth)
// ---------------------------------------------------------------------------

appRoutes.post("/:slug/install", requireAuth, async (c) => {
  const slug = c.req.param("slug");
  const config = getConfig();

  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  // Lookup app
  const appRows = await db
    .select()
    .from(apps)
    .where(and(eq(apps.slug, slug), eq(apps.status, "published")))
    .limit(1);

  const app = appRows[0];
  if (!app) {
    throw new NotFoundError("App not found");
  }

  // Paid app: verify active subscription
  if (app.pricing_model !== "free") {
    const subRows = await db
      .select({ id: subscriptions.id, status: subscriptions.status })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.user_id, userId),
          eq(subscriptions.app_id, app.id),
          eq(subscriptions.status, "active")
        )
      )
      .limit(1);

    if (subRows.length === 0) {
      // 402 Payment Required — not modelled in AppError class directly, so construct manually
      return c.json(
        {
          error: {
            code: "SUBSCRIPTION_REQUIRED",
            message: "An active subscription is required to install this app",
            subscribe_url: `/apps/${slug}/subscribe`,
          },
        },
        402
      );
    }
  }

  // Build scoped access token with this app in app_access
  const existingAppAccess = Array.isArray(jwtUser["app_access"])
    ? (jwtUser["app_access"] as string[])
    : [];

  const appAccess = existingAppAccess.includes(slug)
    ? existingAppAccess
    : [...existingAppAccess, slug];

  const tokenPayload: AccessTokenPayload = {
    sub: userId,
    instance_id: jwtUser["instance_id"] as string | undefined,
    plan: (jwtUser["plan"] as string | undefined) ?? "free",
    capabilities: Array.isArray(jwtUser["capabilities"])
      ? (jwtUser["capabilities"] as string[])
      : ["apps:install"],
    app_access: appAccess,
    scopes: Array.isArray(jwtUser["scopes"])
      ? (jwtUser["scopes"] as string[])
      : ["read"],
  };

  const access_token = await signAccessToken(tokenPayload);

  // developer_mcp — return gateway info
  if (app.type === "developer_mcp") {
    const gateway_url = `${config.HUB_URL}/mcp/${slug}`;
    return c.json(
      {
        install_type: "gateway",
        gateway_url,
        access_token,
        app: {
          id: app.id,
          slug: app.slug,
          name: app.name,
          type: app.type,
          pricing_model: app.pricing_model,
          icon_url: app.icon_url,
        },
      },
      200
    );
  }

  // local_skill / local_agent — return download info
  const manifest = (app.manifest_json ?? {}) as ManifestJson;
  const files: string[] = Array.isArray(manifest.files) ? manifest.files : [];

  return c.json(
    {
      install_type: "local",
      download_url: app.download_url,
      files,
      access_token,
      app: {
        id: app.id,
        slug: app.slug,
        name: app.name,
        type: app.type,
        pricing_model: app.pricing_model,
        icon_url: app.icon_url,
      },
    },
    200
  );
});

// ---------------------------------------------------------------------------
// POST /apps/:slug/subscribe — start subscription (requires auth)
// ---------------------------------------------------------------------------

appRoutes.post("/:slug/subscribe", requireAuth, async (c) => {
  const slug = c.req.param("slug");

  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  // Lookup app — allow draft/published so developers can test; restrict to published for safety
  const appRows = await db
    .select({
      id: apps.id,
      slug: apps.slug,
      pricing_model: apps.pricing_model,
      status: apps.status,
    })
    .from(apps)
    .where(and(eq(apps.slug, slug), eq(apps.status, "published")))
    .limit(1);

  const app = appRows[0];
  if (!app) {
    throw new NotFoundError("App not found");
  }

  // Cannot subscribe to a free app
  if (app.pricing_model === "free") {
    throw new BadRequestError("This app is free and does not require a subscription");
  }

  // Check for existing active subscription (unique constraint: user_id + app_id)
  const existingSub = await db
    .select({ id: subscriptions.id, status: subscriptions.status })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.user_id, userId),
        eq(subscriptions.app_id, app.id)
      )
    )
    .limit(1);

  if (existingSub.length > 0) {
    const sub = existingSub[0]!;
    if (sub.status === "active") {
      // Return 409 — already subscribed
      return c.json(
        {
          error: {
            code: "CONFLICT",
            message: "You already have an active subscription for this app",
          },
        },
        409
      );
    }
  }

  // Stripe integration stub — create subscription record directly with status "active"
  // Phase 6 will replace this with a Stripe checkout session and webhook confirmation.
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  let inserted: Array<{ id: string; status: string; app_id: string }>;

  if (existingSub.length > 0) {
    // Reactivate a cancelled/past_due subscription
    const updated = await db
      .update(subscriptions)
      .set({
        status: "active",
        current_period_start: now,
        current_period_end: periodEnd,
      })
      .where(
        and(
          eq(subscriptions.user_id, userId),
          eq(subscriptions.app_id, app.id)
        )
      )
      .returning({ id: subscriptions.id, status: subscriptions.status, app_id: subscriptions.app_id });

    inserted = updated;
  } else {
    inserted = await db
      .insert(subscriptions)
      .values({
        user_id: userId,
        app_id: app.id,
        status: "active",
        current_period_start: now,
        current_period_end: periodEnd,
      })
      .returning({ id: subscriptions.id, status: subscriptions.status, app_id: subscriptions.app_id });
  }

  const subscription = inserted[0];
  if (!subscription) {
    throw new Error("Subscription upsert returned no rows");
  }

  return c.json(
    {
      subscription: {
        id: subscription.id,
        status: subscription.status,
        app_slug: slug,
      },
      message: "Subscription activated (Stripe integration pending)",
    },
    201
  );
});

export { appRoutes };
