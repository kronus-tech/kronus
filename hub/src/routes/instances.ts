import { Hono } from "hono";
import { eq, and, sql } from "drizzle-orm";
import type { JWTPayload } from "jose";
import { db } from "../db/index.js";
import { instances, users } from "../db/schema.js";
import { signAccessToken } from "../auth/jwt.js";
import { requireAuth, type AuthVariables } from "../middleware/auth.js";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { getRedis } from "../lib/redis.js";

const MAX_INSTANCES: Record<string, number> = { free: 1, pro: 5, enterprise: 50 };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface RegisterBody {
  public_key: string;
  machine_fingerprint?: string;
  kronus_version?: string;
  os?: string;
}

function validateRegisterBody(body: unknown): RegisterBody {
  if (!body || typeof body !== "object") {
    throw new BadRequestError("Request body is required");
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw["public_key"] !== "string" || raw["public_key"].trim() === "") {
    throw new BadRequestError("public_key is required and must be a non-empty string");
  }

  const publicKey = raw["public_key"].trim();
  if (publicKey.length > 4096) {
    throw new BadRequestError("public_key exceeds maximum length (4096)");
  }

  const result: RegisterBody = { public_key: publicKey };

  if (raw["machine_fingerprint"] !== undefined) {
    if (typeof raw["machine_fingerprint"] !== "string") {
      throw new BadRequestError("machine_fingerprint must be a string");
    }
    if (raw["machine_fingerprint"].length > 256) {
      throw new BadRequestError("machine_fingerprint exceeds maximum length (256)");
    }
    result.machine_fingerprint = raw["machine_fingerprint"];
  }

  if (raw["kronus_version"] !== undefined) {
    if (typeof raw["kronus_version"] !== "string") {
      throw new BadRequestError("kronus_version must be a string");
    }
    if (raw["kronus_version"].length > 32) {
      throw new BadRequestError("kronus_version exceeds maximum length (32)");
    }
    result.kronus_version = raw["kronus_version"];
  }

  if (raw["os"] !== undefined) {
    if (typeof raw["os"] !== "string") {
      throw new BadRequestError("os must be a string");
    }
    if (raw["os"].length > 64) {
      throw new BadRequestError("os exceeds maximum length (64)");
    }
    result.os = raw["os"];
  }

  return result;
}

interface HeartbeatBody {
  installed_apps?: string[];
  kronus_version?: string;
}

function validateHeartbeatBody(body: unknown): HeartbeatBody {
  if (!body || typeof body !== "object") {
    return {};
  }

  const raw = body as Record<string, unknown>;
  const result: HeartbeatBody = {};

  if (raw["kronus_version"] !== undefined) {
    if (typeof raw["kronus_version"] !== "string") {
      throw new BadRequestError("kronus_version must be a string");
    }
    result.kronus_version = raw["kronus_version"];
  }

  if (raw["installed_apps"] !== undefined) {
    if (
      !Array.isArray(raw["installed_apps"]) ||
      !raw["installed_apps"].every((a) => typeof a === "string")
    ) {
      throw new BadRequestError("installed_apps must be an array of strings");
    }
    result.installed_apps = raw["installed_apps"] as string[];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Route sub-app
// ---------------------------------------------------------------------------

const instanceRoutes = new Hono<{ Variables: AuthVariables }>();

instanceRoutes.use("*", requireAuth);

// ---------------------------------------------------------------------------
// POST /instances/register
// ---------------------------------------------------------------------------

instanceRoutes.post("/register", async (c) => {
  const body = await c.req.json<unknown>();
  const { public_key, machine_fingerprint, kronus_version, os } =
    validateRegisterBody(body);

  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;

  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  // HUB-13: Re-fetch user from DB for authoritative plan (never trust JWT claims for entitlements)
  const userRows = await db
    .select({ id: users.id, plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = userRows[0];
  if (!user) {
    throw new BadRequestError("User not found");
  }

  // HUB-12: Enforce plan-based instance cap
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(instances)
    .where(and(eq(instances.user_id, userId), eq(instances.status, "active")));

  const currentCount = countResult[0]?.count ?? 0;
  const cap = MAX_INSTANCES[user.plan] ?? 1;

  if (currentCount >= cap) {
    throw new BadRequestError(
      `Instance limit reached for ${user.plan} plan (max ${cap})`
    );
  }

  const inserted = await db
    .insert(instances)
    .values({
      user_id: userId,
      public_key,
      machine_fingerprint,
      kronus_version,
      os,
    })
    .returning({
      id: instances.id,
      user_id: instances.user_id,
      status: instances.status,
      created_at: instances.created_at,
    });

  const instance = inserted[0];
  if (!instance) {
    throw new Error("Instance insert returned no rows");
  }

  // Sign instance-scoped token with authoritative plan from DB
  const access_token = await signAccessToken({
    sub: userId,
    instance_id: instance.id,
    plan: user.plan,
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });

  return c.json({ instance, access_token }, 201);
});

// ---------------------------------------------------------------------------
// POST /instances/heartbeat
// ---------------------------------------------------------------------------

instanceRoutes.post("/heartbeat", async (c) => {
  const body = await c.req.json<unknown>();
  const { kronus_version } = validateHeartbeatBody(body);

  const jwtUser = c.get("user") as JWTPayload;
  const instanceId = jwtUser["instance_id"] as string | undefined;

  if (!instanceId) {
    throw new BadRequestError(
      "No instance_id in token — use instance-scoped token"
    );
  }

  const updateValues: { last_heartbeat: Date; kronus_version?: string } = {
    last_heartbeat: new Date(),
  };

  if (kronus_version !== undefined) {
    updateValues.kronus_version = kronus_version;
  }

  await db
    .update(instances)
    .set(updateValues)
    .where(eq(instances.id, instanceId));

  return c.json(
    { status: "ok", timestamp: new Date().toISOString() },
    200
  );
});

// ---------------------------------------------------------------------------
// DELETE /instances/:id
// ---------------------------------------------------------------------------

instanceRoutes.delete("/:id", async (c) => {
  const instanceId = c.req.param("id");

  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;

  if (!userId) {
    throw new BadRequestError("Token is missing sub claim");
  }

  // Use and() so the WHERE clause verifies both id AND ownership in one query.
  // This avoids a separate SELECT that would reveal whether the instance exists.
  const deleted = await db
    .delete(instances)
    .where(and(eq(instances.id, instanceId), eq(instances.user_id, userId)))
    .returning({ id: instances.id });

  if (deleted.length === 0) {
    throw new NotFoundError("Instance not found");
  }

  return new Response(null, { status: 204 });
});

// ---------------------------------------------------------------------------
// POST /instances/relay-ticket — HUB-22: Issue one-time relay connection ticket
// ---------------------------------------------------------------------------

instanceRoutes.post("/relay-ticket", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  const instanceId = jwtUser["instance_id"] as string | undefined;

  if (!userId) throw new BadRequestError("Token missing sub claim");
  if (!instanceId) throw new BadRequestError("Token must include instance_id");

  const plan = typeof jwtUser["plan"] === "string" ? jwtUser["plan"] : "free";

  // Generate one-time ticket
  const ticketId = crypto.randomUUID();
  const ticketData = JSON.stringify({
    sub: userId,
    instance_id: instanceId,
    plan,
    capabilities: jwtUser["capabilities"] ?? ["apps:install"],
    app_access: jwtUser["app_access"] ?? [],
    scopes: jwtUser["scopes"] ?? ["read"],
  });

  const redis = getRedis();
  await redis.setex(`relay:ticket:${ticketId}`, 300, ticketData); // 5 min TTL

  return c.json({ ticket_id: ticketId, expires_in: 300 }, 201);
});

export { instanceRoutes };
