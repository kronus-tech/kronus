import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { users } from "../db/schema.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyToken,
  revokeToken,
} from "../auth/jwt.js";
import {
  BadRequestError,
  ConflictError,
  RateLimitError,
  UnauthorizedError,
} from "../lib/errors.js";
import { checkRateLimit } from "../lib/rate-limit.js";
import { createLogger } from "../lib/logger.js";
import type { JWTPayload } from "jose";

const logger = createLogger("auth");

// ---------------------------------------------------------------------------
// Timing-safe dummy hash — pre-computed at startup for login anti-enumeration
// ---------------------------------------------------------------------------

const DUMMY_HASH = await hashPassword("timing-safe-dummy-sentinel");

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

interface ValidationError {
  field: string;
  message: string;
}

function validateRegisterBody(body: unknown): {
  email: string;
  name: string;
  password: string;
} {
  if (!body || typeof body !== "object") {
    throw new BadRequestError("Request body is required");
  }

  const raw = body as Record<string, unknown>;
  const errors: ValidationError[] = [];

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (typeof raw["email"] !== "string" || raw["email"].trim() === "") {
    errors.push({ field: "email", message: "Email is required" });
  } else {
    const email = raw["email"].trim();
    if (!EMAIL_RE.test(email)) {
      errors.push({ field: "email", message: "Email must be a valid email address" });
    } else if (email.length > 254) {
      errors.push({ field: "email", message: "Email must be no longer than 254 characters" });
    }
  }

  if (typeof raw["name"] !== "string" || raw["name"].trim() === "") {
    errors.push({ field: "name", message: "Name is required" });
  } else if (raw["name"].trim().length > 100) {
    errors.push({ field: "name", message: "Name must be no longer than 100 characters" });
  }

  if (typeof raw["password"] !== "string" || raw["password"].length === 0) {
    errors.push({ field: "password", message: "Password is required" });
  } else if (raw["password"].length < 8) {
    errors.push({ field: "password", message: "Password must be at least 8 characters" });
  } else if (raw["password"].length > 128) {
    errors.push({ field: "password", message: "Password must be no longer than 128 characters" });
  }

  if (errors.length > 0) {
    throw new BadRequestError("Validation failed", { errors });
  }

  return {
    email: (raw["email"] as string).trim().toLowerCase(),
    name: (raw["name"] as string).trim(),
    password: raw["password"] as string,
  };
}

function validateLoginBody(body: unknown): {
  email: string;
  password: string;
} {
  if (!body || typeof body !== "object") {
    throw new BadRequestError("Request body is required");
  }

  const raw = body as Record<string, unknown>;
  const errors: ValidationError[] = [];

  if (typeof raw["email"] !== "string" || raw["email"].trim() === "") {
    errors.push({ field: "email", message: "Email is required" });
  }

  if (typeof raw["password"] !== "string" || raw["password"].length === 0) {
    errors.push({ field: "password", message: "Password is required" });
  }

  if (errors.length > 0) {
    throw new BadRequestError("Validation failed", { errors });
  }

  return {
    email: (raw["email"] as string).trim().toLowerCase(),
    password: raw["password"] as string,
  };
}

function validateRefreshBody(body: unknown): { refresh_token: string } {
  if (!body || typeof body !== "object") {
    throw new BadRequestError("Request body is required");
  }

  const raw = body as Record<string, unknown>;

  if (typeof raw["refresh_token"] !== "string" || raw["refresh_token"].trim() === "") {
    throw new BadRequestError("refresh_token is required");
  }

  return { refresh_token: raw["refresh_token"] };
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

const authRoutes = new Hono();

// POST /auth/register
authRoutes.post("/register", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`auth:register:${ip}`, 3, 3600);
  if (!rl.allowed) {
    throw new RateLimitError("Too many registration attempts");
  }

  const body = await c.req.json<unknown>();
  const { email, name, password } = validateRegisterBody(body);

  // Check email uniqueness
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    throw new ConflictError("Email already registered");
  }

  const password_hash = await hashPassword(password);

  const inserted = await db
    .insert(users)
    .values({ email, name, password_hash })
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
    });

  const user = inserted[0];
  if (!user) {
    throw new Error("Insert returned no rows");
  }

  const access_token = await signAccessToken({
    sub: user.id,
    plan: user.plan,
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });

  const refresh_token = await signRefreshToken(user.id);

  logger.info("auth:register_success", { user_id: user.id, email: user.email });

  return c.json({ user, access_token, refresh_token }, 201);
});

// POST /auth/login
authRoutes.post("/login", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`auth:login:${ip}`, 5, 60);
  if (!rl.allowed) {
    throw new RateLimitError("Too many login attempts");
  }

  const body = await c.req.json<unknown>();
  const { email, password } = validateLoginBody(body);

  const INVALID_MSG = "Invalid email or password";

  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      plan: users.plan,
      password_hash: users.password_hash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows[0];

  // Use verifyPassword even when user is not found to prevent timing-based
  // enumeration — always run the same code path regardless.
  const passwordOk = user
    ? await verifyPassword(user.password_hash, password)
    : await verifyPassword(DUMMY_HASH, password);

  if (!user || !passwordOk) {
    logger.info("auth:login_failed", { email });
    throw new UnauthorizedError(INVALID_MSG);
  }

  const access_token = await signAccessToken({
    sub: user.id,
    plan: user.plan,
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });

  const refresh_token = await signRefreshToken(user.id);

  logger.info("auth:login_success", { user_id: user.id });

  return c.json(
    {
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan },
      access_token,
      refresh_token,
    },
    200
  );
});

// POST /auth/refresh
authRoutes.post("/refresh", async (c) => {
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl = await checkRateLimit(`auth:refresh:${ip}`, 10, 60);
  if (!rl.allowed) {
    throw new RateLimitError("Too many refresh attempts");
  }

  const body = await c.req.json<unknown>();
  const { refresh_token } = validateRefreshBody(body);

  let payload: JWTPayload;
  try {
    payload = await verifyToken(refresh_token);
  } catch {
    throw new UnauthorizedError("Invalid or expired refresh token");
  }

  if (payload["type"] !== "refresh") {
    throw new UnauthorizedError("Invalid token type");
  }

  const userId = payload.sub;
  if (!userId) {
    throw new UnauthorizedError("Invalid token payload");
  }

  const rows = await db
    .select({ id: users.id, plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const user = rows[0];
  if (!user) {
    throw new UnauthorizedError("User not found");
  }

  const access_token = await signAccessToken({
    sub: user.id,
    plan: user.plan,
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });

  // HUB-04: Issue new refresh token + revoke old one
  const new_refresh_token = await signRefreshToken(user.id);

  // Revoke old refresh token if it has a jti
  if (payload.jti && payload.exp) {
    await revokeToken(payload.jti, new Date(payload.exp * 1000));
  }

  logger.info("auth:token_refresh", { user_id: userId });

  return c.json({ access_token, refresh_token: new_refresh_token }, 200);
});

export { authRoutes };
