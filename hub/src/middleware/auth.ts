import { createMiddleware } from "hono/factory";
import { verifyToken } from "../auth/jwt.js";
import { UnauthorizedError } from "../lib/errors.js";
import type { JWTPayload } from "jose";

// ---------------------------------------------------------------------------
// Hono variable types — import this in routes that read c.get("user")
// ---------------------------------------------------------------------------

export type AuthVariables = {
  user: JWTPayload | null;
};

// ---------------------------------------------------------------------------
// requireAuth — throws 401 when no valid Bearer token is present
// ---------------------------------------------------------------------------

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      throw new UnauthorizedError("Missing or invalid Authorization header");
    }

    const token = authHeader.slice(7);

    try {
      const payload = await verifyToken(token);
      c.set("user", payload);
    } catch {
      throw new UnauthorizedError("Invalid or expired token");
    }

    await next();
  }
);

// ---------------------------------------------------------------------------
// optionalAuth — sets user to null when no token is present, never throws
// ---------------------------------------------------------------------------

export const optionalAuth = createMiddleware<{ Variables: AuthVariables }>(
  async (c, next) => {
    const authHeader = c.req.header("Authorization");

    if (!authHeader?.startsWith("Bearer ")) {
      c.set("user", null);
      await next();
      return;
    }

    const token = authHeader.slice(7);

    try {
      const payload = await verifyToken(token);
      c.set("user", payload);
    } catch {
      c.set("user", null);
    }

    await next();
  }
);
