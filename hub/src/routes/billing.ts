import { Hono } from "hono";
import type { JWTPayload } from "jose";
import { requireAuth } from "../middleware/auth.js";
import type { AuthVariables } from "../middleware/auth.js";
import {
  createCheckoutSession,
  createPortalSession,
  isStripeConfigured,
  getPlanPrice,
} from "../billing/stripe.js";
import { db } from "../db/index.js";
import { users, usage_events } from "../db/schema.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { BadRequestError, NotFoundError } from "../lib/errors.js";
import { getConfig } from "../lib/config.js";

// ---------------------------------------------------------------------------
// All routes in this file require a valid JWT — applied at the router level
// ---------------------------------------------------------------------------

export const billingRoutes = new Hono<{ Variables: AuthVariables }>();

billingRoutes.use("*", requireAuth);

// ---------------------------------------------------------------------------
// GET /billing/subscription — current plan + Stripe status
// ---------------------------------------------------------------------------

billingRoutes.get("/subscription", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) throw new BadRequestError("Token is missing sub claim");

  const rows = await db
    .select({ plan: users.plan, stripe_customer_id: users.stripe_customer_id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const u = rows[0];
  if (!u) throw new NotFoundError("User not found");

  return c.json({
    plan: u.plan,
    stripe_configured: isStripeConfigured(),
    has_customer_id: !!u.stripe_customer_id,
  });
});

// ---------------------------------------------------------------------------
// POST /billing/subscribe/:plan — initiate a Stripe Checkout session
// ---------------------------------------------------------------------------

billingRoutes.post("/subscribe/:plan", async (c) => {
  const plan = c.req.param("plan");
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) throw new BadRequestError("Token is missing sub claim");

  if (!getPlanPrice(plan)) {
    throw new BadRequestError(`Invalid plan: ${plan}. Valid options: pro, enterprise.`);
  }

  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const u = rows[0];
  if (!u) throw new NotFoundError("User not found");

  const config = getConfig();

  const { url, sessionId } = await createCheckoutSession(
    userId,
    u.email,
    plan,
    `${config.HUB_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
    `${config.HUB_URL}/billing/cancel`
  );

  return c.json({ checkout_url: url, session_id: sessionId });
});

// ---------------------------------------------------------------------------
// GET /billing/portal — Stripe Customer Portal link
// ---------------------------------------------------------------------------

billingRoutes.get("/portal", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) throw new BadRequestError("Token is missing sub claim");

  const rows = await db
    .select({ stripe_customer_id: users.stripe_customer_id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const u = rows[0];
  if (!u?.stripe_customer_id) {
    throw new BadRequestError("No billing account found. Subscribe to a plan first.");
  }

  const config = getConfig();
  const portalUrl = await createPortalSession(u.stripe_customer_id, config.HUB_URL);

  return c.json({ portal_url: portalUrl });
});

// ---------------------------------------------------------------------------
// GET /billing/usage — current-month usage summary for the authenticated user
// ---------------------------------------------------------------------------

billingRoutes.get("/usage", async (c) => {
  const jwtUser = c.get("user") as JWTPayload;
  const userId = jwtUser.sub;
  if (!userId) throw new BadRequestError("Token is missing sub claim");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const rows = await db
    .select({
      total_calls: sql<number>`count(*)::int`,
      total_bytes: sql<number>`coalesce(sum(${usage_events.payload_bytes}), 0)::int`,
    })
    .from(usage_events)
    .where(
      and(
        eq(usage_events.instance_id, userId),
        gte(usage_events.timestamp, monthStart)
      )
    );

  const u = rows[0] ?? { total_calls: 0, total_bytes: 0 };

  return c.json({
    period_start: monthStart.toISOString(),
    period_end: now.toISOString(),
    total_calls: u.total_calls,
    total_bytes: u.total_bytes,
  });
});
