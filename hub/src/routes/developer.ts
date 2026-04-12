import { Hono } from "hono";
import { eq, and, sql, desc } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { db } from "../db/index.js";
import { apps, app_versions, usage_events, payouts } from "../db/schema.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import { isPrivateOrLocalUrl, isPrivateAfterDnsResolve } from "../gateway/auth-middleware.js";
import {
  AppError,
  BadRequestError,
  NotFoundError,
} from "../lib/errors.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEMVER_RE = /^\d+\.\d+\.\d+$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/;
const APP_TYPES = ["developer_mcp", "local_skill", "local_agent", "hybrid"] as const;

// ---------------------------------------------------------------------------
// Manifest interfaces
// ---------------------------------------------------------------------------

interface ManifestMcp {
  tools?: unknown[];
  [key: string]: unknown;
}

interface ManifestPricing {
  model?: string;
  [key: string]: unknown;
}

interface ManifestFile {
  src: string;
  dest: string;
}

interface AppManifest {
  name: string;
  display_name: string;
  version: string;
  description: string;
  type: string;
  mcp_url?: string;
  mcp?: ManifestMcp;
  files?: unknown[];
  pricing?: ManifestPricing;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Body interfaces
// ---------------------------------------------------------------------------

interface UpdateMetaBody {
  description?: string;
  icon_url?: string;
}

interface PublishVersionBody {
  version: string;
  changelog?: string;
  developer_mcp_url?: string;
  kronus_min_version?: string;
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertString(
  value: unknown,
  field: string,
  minLen: number,
  maxLen: number
): string {
  if (typeof value !== "string") {
    throw new BadRequestError(`${field} is required and must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minLen) {
    throw new BadRequestError(
      `${field} must be at least ${minLen} character(s)`
    );
  }
  if (trimmed.length > maxLen) {
    throw new BadRequestError(
      `${field} must be at most ${maxLen} characters`
    );
  }
  return trimmed;
}

function assertOptionalString(
  value: unknown,
  field: string,
  maxLen: number
): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new BadRequestError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new BadRequestError(`${field} must be at most ${maxLen} characters`);
  }
  return trimmed === "" ? undefined : trimmed;
}

export function validateManifest(raw: unknown): AppManifest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestError("Manifest must be a JSON object");
  }

  const m = raw as Record<string, unknown>;

  // name: lowercase alphanumeric+hyphens, 1-63 chars
  const name = assertString(m["name"], "name", 1, 63);
  if (!SLUG_RE.test(name)) {
    throw new BadRequestError(
      "name must be lowercase alphanumeric with hyphens (slug format)"
    );
  }

  const display_name = assertString(m["display_name"], "display_name", 1, 100);

  const version = assertString(m["version"], "version", 1, 64);
  if (!SEMVER_RE.test(version)) {
    throw new BadRequestError("version must be semver format (e.g. 1.0.0)");
  }

  const description = assertString(m["description"], "description", 20, 2000);

  const type = assertString(m["type"], "type", 1, 32);
  if (!(APP_TYPES as readonly string[]).includes(type)) {
    throw new BadRequestError(
      `type must be one of: ${APP_TYPES.join(", ")}`
    );
  }

  const manifest: AppManifest = {
    ...m,
    name,
    display_name,
    version,
    description,
    type,
  };

  // Type-specific validation
  if (type === "developer_mcp") {
    if (typeof manifest["mcp_url"] !== "string" || manifest["mcp_url"].trim() === "") {
      throw new BadRequestError(
        "mcp_url is required for developer_mcp type"
      );
    }
    manifest["mcp_url"] = manifest["mcp_url"].trim();

    // Validate HTTPS URL
    let parsed: URL;
    try {
      parsed = new URL(manifest["mcp_url"] as string);
    } catch {
      throw new BadRequestError("mcp_url must be a valid URL");
    }
    if (parsed.protocol !== "https:") {
      throw new BadRequestError("mcp_url must use HTTPS");
    }

    const mcpSection = manifest["mcp"];
    if (
      !mcpSection ||
      typeof mcpSection !== "object" ||
      !Array.isArray((mcpSection as ManifestMcp).tools) ||
      (mcpSection as ManifestMcp).tools!.length === 0
    ) {
      throw new BadRequestError(
        "mcp.tools must be a non-empty array for developer_mcp type"
      );
    }
  }

  if (type === "local_skill" || type === "local_agent") {
    const files = manifest["files"];
    if (!Array.isArray(files) || files.length === 0) {
      throw new BadRequestError(
        `files must be a non-empty array for ${type} type`
      );
    }
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (
        !f ||
        typeof f !== "object" ||
        typeof (f as ManifestFile).src !== "string" ||
        typeof (f as ManifestFile).dest !== "string"
      ) {
        throw new BadRequestError(
          `files[${i}] must have src and dest string fields`
        );
      }
      // HUB-59: Reject path traversal in file paths
      const SAFE_PATH_RE = /^[a-zA-Z0-9.][a-zA-Z0-9._/-]{0,255}$/;
      const src = (f as ManifestFile).src;
      const dest = (f as ManifestFile).dest;
      if (src.includes("..") || dest.includes("..")) {
        throw new BadRequestError(`files[${i}] paths must not contain '..'`);
      }
      if (src.startsWith("/") || dest.startsWith("/")) {
        throw new BadRequestError(`files[${i}] paths must be relative, not absolute`);
      }
      if (!SAFE_PATH_RE.test(src) || !SAFE_PATH_RE.test(dest)) {
        throw new BadRequestError(`files[${i}] paths contain invalid characters`);
      }
    }
  }

  return manifest;
}

// ---------------------------------------------------------------------------
// MCP compliance check
// ---------------------------------------------------------------------------

export async function checkMcpCompliance(mcpUrl: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let response: Response;
  try {
    response = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id: 1,
        params: {},
      }),
      signal: controller.signal,
      redirect: "error",
    });
  } catch (err) {
    throw new AppError(
      422,
      "MCP_COMPLIANCE_FAILED",
      "MCP server did not respond correctly"
    );
  } finally {
    clearTimeout(timeout);
  }

  // HUB-62: Always cancel response body to prevent file descriptor leak
  try {
    if (!response.ok) {
      throw new AppError(
        422,
        "MCP_COMPLIANCE_FAILED",
        "MCP server did not respond correctly"
      );
    }
  } finally {
    await response.body?.cancel();
  }
}

// ---------------------------------------------------------------------------
// Ownership helper
// ---------------------------------------------------------------------------

async function requireAppOwnership(
  appId: string,
  userId: string
): Promise<typeof apps.$inferSelect> {
  const rows = await db
    .select()
    .from(apps)
    .where(eq(apps.id, appId))
    .limit(1);

  const app = rows[0];
  if (!app) {
    throw new NotFoundError("App not found");
  }
  if (app.developer_id !== userId) {
    throw new AppError(403, "FORBIDDEN", "You do not own this app");
  }
  return app;
}

// ---------------------------------------------------------------------------
// Route sub-app
// ---------------------------------------------------------------------------

const developerRoutes = new Hono<{ Variables: AuthVariables }>();

developerRoutes.use("*", requireAuth);

// ---------------------------------------------------------------------------
// POST /developer/apps — Submit new app
// ---------------------------------------------------------------------------

developerRoutes.post("/apps", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  const body = await c.req.json<unknown>();
  const manifest = validateManifest(body);

  const slug = manifest.name; // already validated as slug format

  // SSRF check for developer_mcp (HUB-39/58: async DNS resolution at submission time)
  if (manifest.type === "developer_mcp") {
    const mcpUrl = manifest["mcp_url"] as string;
    if (await isPrivateAfterDnsResolve(mcpUrl)) {
      throw new BadRequestError(
        "mcp_url must not resolve to a private or local network address"
      );
    }
    await checkMcpCompliance(mcpUrl);
  }

  // Slug uniqueness check
  const existing = await db
    .select({ id: apps.id })
    .from(apps)
    .where(eq(apps.slug, slug))
    .limit(1);

  if (existing.length > 0) {
    throw new AppError(409, "CONFLICT", `App slug '${slug}' is already taken`);
  }

  // HUB-61: Validate pricing model against allowlist
  const VALID_PRICING_MODELS = ["free", "one_time", "subscription", "usage"];
  const rawPricingModel =
    manifest.pricing && typeof manifest.pricing.model === "string"
      ? manifest.pricing.model
      : "free";
  if (!VALID_PRICING_MODELS.includes(rawPricingModel)) {
    throw new BadRequestError(
      `pricing.model must be one of: ${VALID_PRICING_MODELS.join(", ")}`
    );
  }
  const pricingModel = rawPricingModel;

  const mcpUrl =
    manifest.type === "developer_mcp"
      ? (manifest["mcp_url"] as string)
      : null;

  const inserted = await db
    .insert(apps)
    .values({
      slug,
      name: manifest.display_name,
      description: manifest.description,
      type: manifest.type,
      developer_id: userId,
      developer_mcp_url: mcpUrl ?? undefined,
      pricing_model: pricingModel,
      status: "review",
      manifest_json: manifest as Record<string, unknown>,
    })
    .returning({
      id: apps.id,
      slug: apps.slug,
      status: apps.status,
    });

  const app = inserted[0];
  if (!app) {
    throw new Error("App insert returned no rows");
  }

  // Insert first version
  await db.insert(app_versions).values({
    app_id: app.id,
    version: manifest.version,
    developer_mcp_url: mcpUrl ?? undefined,
  });

  return c.json(
    {
      app: { id: app.id, slug: app.slug, status: app.status },
      message: "Submitted for review",
    },
    201
  );
});

// ---------------------------------------------------------------------------
// PUT /developer/apps/:id — Update metadata
// ---------------------------------------------------------------------------

developerRoutes.put("/apps/:id", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  const appId = c.req.param("id");
  await requireAppOwnership(appId, userId);

  const body = await c.req.json<unknown>();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("Request body must be a JSON object");
  }

  const raw = body as UpdateMetaBody;

  const updateValues: { description?: string; icon_url?: string } = {};

  const description = assertOptionalString(raw.description, "description", 2000);
  if (description !== undefined) {
    if (description.length < 20) {
      throw new BadRequestError("description must be at least 20 characters");
    }
    updateValues.description = description;
  }

  const icon_url = assertOptionalString(raw.icon_url, "icon_url", 2048);
  if (icon_url !== undefined) {
    let parsedIconUrl: URL;
    try {
      parsedIconUrl = new URL(icon_url);
    } catch {
      throw new BadRequestError("icon_url must be a valid HTTPS URL");
    }
    if (parsedIconUrl.protocol !== "https:") {
      throw new BadRequestError("icon_url must use HTTPS");
    }
    // HUB-64: SSRF check on icon_url
    if (await isPrivateAfterDnsResolve(icon_url)) {
      throw new BadRequestError("icon_url must not point to a private or local address");
    }
    updateValues.icon_url = icon_url;
  }

  if (Object.keys(updateValues).length === 0) {
    throw new BadRequestError(
      "No updatable fields provided (allowed: description, icon_url)"
    );
  }

  const updated = await db
    .update(apps)
    .set(updateValues)
    .where(eq(apps.id, appId))
    .returning();

  const app = updated[0];
  if (!app) {
    throw new Error("App update returned no rows");
  }

  return c.json({ app }, 200);
});

// ---------------------------------------------------------------------------
// POST /developer/apps/:id/versions — Publish new version
// ---------------------------------------------------------------------------

developerRoutes.post("/apps/:id/versions", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  const appId = c.req.param("id");
  const app = await requireAppOwnership(appId, userId);

  const body = await c.req.json<unknown>();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("Request body must be a JSON object");
  }

  const raw = body as PublishVersionBody;

  // version is required
  const version = assertString(raw.version, "version", 1, 64);
  if (!SEMVER_RE.test(version)) {
    throw new BadRequestError("version must be semver format (e.g. 1.0.0)");
  }

  // Check version uniqueness for this app
  const existingVersion = await db
    .select({ id: app_versions.id })
    .from(app_versions)
    .where(
      and(
        eq(app_versions.app_id, appId),
        eq(app_versions.version, version)
      )
    )
    .limit(1);

  if (existingVersion.length > 0) {
    throw new AppError(
      409,
      "CONFLICT",
      `Version ${version} already exists for this app`
    );
  }

  const changelog = assertOptionalString(raw.changelog, "changelog", 4000);
  const kronus_min_version = assertOptionalString(
    raw.kronus_min_version,
    "kronus_min_version",
    32
  );

  let newMcpUrl: string | undefined = undefined;

  if (raw.developer_mcp_url !== undefined) {
    const candidate = assertOptionalString(
      raw.developer_mcp_url,
      "developer_mcp_url",
      2048
    );

    if (candidate !== undefined) {
      // Only relevant for developer_mcp type
      if (app.type !== "developer_mcp") {
        throw new BadRequestError(
          "developer_mcp_url is only applicable to developer_mcp type apps"
        );
      }

      // Validate URL
      let parsed: URL;
      try {
        parsed = new URL(candidate);
      } catch {
        throw new BadRequestError("developer_mcp_url must be a valid URL");
      }
      if (parsed.protocol !== "https:") {
        throw new BadRequestError("developer_mcp_url must use HTTPS");
      }

      // SSRF check
      if (await isPrivateAfterDnsResolve(candidate)) {
        throw new BadRequestError(
          "developer_mcp_url must not resolve to a private or local network address"
        );
      }

      // MCP compliance test
      await checkMcpCompliance(candidate);

      newMcpUrl = candidate;
    }
  }

  const insertValues: {
    app_id: string;
    version: string;
    changelog?: string;
    developer_mcp_url?: string;
    kronus_min_version?: string;
  } = {
    app_id: appId,
    version,
  };

  if (changelog !== undefined) insertValues.changelog = changelog;
  if (newMcpUrl !== undefined) insertValues.developer_mcp_url = newMcpUrl;
  if (kronus_min_version !== undefined)
    insertValues.kronus_min_version = kronus_min_version;

  const inserted = await db
    .insert(app_versions)
    .values(insertValues)
    .returning({
      id: app_versions.id,
      version: app_versions.version,
      published_at: app_versions.published_at,
    });

  const ver = inserted[0];
  if (!ver) {
    throw new Error("Version insert returned no rows");
  }

  // If the URL changed, update the canonical developer_mcp_url on the app row
  if (newMcpUrl !== undefined) {
    await db
      .update(apps)
      .set({ developer_mcp_url: newMcpUrl })
      .where(eq(apps.id, appId));
  }

  return c.json({ version: ver }, 201);
});

// ---------------------------------------------------------------------------
// Analytics row shape
// ---------------------------------------------------------------------------

interface AnalyticsRow {
  app_id: string;
  app_slug: string;
  total_calls: number;
  total_bytes: number;
}

// ---------------------------------------------------------------------------
// GET /developer/analytics — Usage stats
// ---------------------------------------------------------------------------

developerRoutes.get("/analytics", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  // Fetch all apps owned by this developer
  const devApps = await db
    .select({ id: apps.id, slug: apps.slug })
    .from(apps)
    .where(eq(apps.developer_id, userId));

  if (devApps.length === 0) {
    return c.json({ apps: [] as AnalyticsRow[] }, 200);
  }

  const appIds = devApps.map((a) => a.id);
  const slugByAppId = new Map(devApps.map((a) => [a.id, a.slug]));

  // Aggregate usage_events per app_id using Drizzle's sql tag for a safe IN list
  const idList = sql.join(
    appIds.map((id) => sql`${id}`),
    sql`, `
  );

  const rows = await db.execute<{
    app_id: string;
    total_calls: string;
    total_bytes: string;
  }>(
    sql`SELECT app_id,
               COUNT(*) AS total_calls,
               COALESCE(SUM(payload_bytes), 0) AS total_bytes
          FROM usage_events
         WHERE app_id IN (${idList})
         GROUP BY app_id`
  );

  const analyticsRows: AnalyticsRow[] = rows.map((row) => ({
    app_id: row.app_id,
    app_slug: slugByAppId.get(row.app_id) ?? "",
    total_calls: Number(row.total_calls),
    total_bytes: Number(row.total_bytes),
  }));

  // Include apps with zero usage
  const coveredIds = new Set(analyticsRows.map((r) => r.app_id));
  for (const a of devApps) {
    if (!coveredIds.has(a.id)) {
      analyticsRows.push({
        app_id: a.id,
        app_slug: a.slug,
        total_calls: 0,
        total_bytes: 0,
      });
    }
  }

  return c.json({ apps: analyticsRows }, 200);
});

// ---------------------------------------------------------------------------
// Payout summary shape
// ---------------------------------------------------------------------------

interface PayoutSummary {
  total_earned_cents: number;
  total_commission_cents: number;
}

// ---------------------------------------------------------------------------
// GET /developer/payouts — Payout history
// ---------------------------------------------------------------------------

developerRoutes.get("/payouts", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  const rows = await db
    .select()
    .from(payouts)
    .where(eq(payouts.developer_id, userId))
    .orderBy(desc(payouts.created_at));

  const summary: PayoutSummary = rows.reduce<PayoutSummary>(
    (acc, row) => ({
      total_earned_cents: acc.total_earned_cents + row.amount_cents,
      total_commission_cents:
        acc.total_commission_cents + row.commission_cents,
    }),
    { total_earned_cents: 0, total_commission_cents: 0 }
  );

  return c.json({ payouts: rows, summary }, 200);
});

export { developerRoutes };
