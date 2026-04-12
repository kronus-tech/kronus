import { Hono } from "hono";
import type Stripe from "stripe";
import { getStripe, isStripeConfigured } from "./stripe.js";
import { getConfig } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";
import { getRedis } from "../lib/redis.js";
import { db } from "../db/index.js";
import { subscriptions, users } from "../db/schema.js";
import { eq } from "drizzle-orm";

const logger = createLogger("billing:webhooks");

export const webhookRoutes = new Hono();

// ---------------------------------------------------------------------------
// POST /billing/webhooks
//
// Stripe calls this endpoint directly — NO auth middleware, NO bodyLimit.
// The raw request body must reach stripe.webhooks.constructEvent() intact.
// ---------------------------------------------------------------------------

webhookRoutes.post("/webhooks", async (c) => {
  if (!isStripeConfigured()) {
    const config = getConfig();
    if (config.NODE_ENV === "production") {
      return c.json({ error: "Billing not configured" }, 503);
    }
    return c.json({ received: true, mode: "stub" }, 200);
  }

  const config = getConfig();
  const signature = c.req.header("stripe-signature");

  if (!signature) {
    logger.warn("Webhook received without stripe-signature header");
    return c.json({ error: "Missing signature" }, 400);
  }

  if (!config.STRIPE_WEBHOOK_SECRET) {
    logger.warn("STRIPE_WEBHOOK_SECRET not set — cannot verify webhook");
    return c.json({ error: "Webhook secret not configured" }, 500);
  }

  // Read raw body — must NOT use c.req.json() or Hono's body parser here.
  // Stripe's signature covers the exact bytes sent over the wire.
  const rawBody = await c.req.text();

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, config.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn("Webhook signature verification failed", { error: String(err) });
    return c.json({ error: "Invalid signature" }, 400);
  }

  // HUB-67: Idempotency check — skip already-processed events
  const redis = getRedis();
  const eventKey = `stripe:webhook:${event.id}`;
  const alreadySeen = await redis.get(eventKey);
  if (alreadySeen) {
    logger.info("Webhook already processed", { eventId: event.id });
    return c.json({ received: true }, 200);
  }

  logger.info("Webhook received", { type: event.type, id: event.id });

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionChange(sub);
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(sub);
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await handlePaymentFailed(invoice);
      break;
    }
    default:
      logger.debug("Unhandled webhook event type", { type: event.type });
  }

  // HUB-67: Mark event as processed (48h TTL covers Stripe's retry window)
  await redis.setex(eventKey, 172_800, "1");

  return c.json({ received: true }, 200);
});

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleSubscriptionChange(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata?.["kronus_user_id"];
  if (!userId) {
    logger.warn("Subscription event missing kronus_user_id metadata", { subId: sub.id });
    return;
  }

  const status =
    sub.status === "active" ? "active" :
    sub.status === "past_due" ? "past_due" :
    "cancelled";

  await db
    .update(subscriptions)
    .set({
      stripe_subscription_id: sub.id,
      status,
      current_period_start: new Date(sub.current_period_start * 1000),
      current_period_end: new Date(sub.current_period_end * 1000),
    })
    .where(eq(subscriptions.stripe_subscription_id, sub.id));

  const plan = sub.metadata?.["plan"];
  if (plan && ["pro", "enterprise"].includes(plan)) {
    await db.update(users).set({ plan }).where(eq(users.id, userId));
  }

  logger.info("Subscription updated", { userId, status, plan: plan ?? "n/a" });
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription): Promise<void> {
  await db
    .update(subscriptions)
    .set({ status: "cancelled" })
    .where(eq(subscriptions.stripe_subscription_id, sub.id));

  const userId = sub.metadata?.["kronus_user_id"];
  if (userId) {
    await db.update(users).set({ plan: "free" }).where(eq(users.id, userId));
    logger.info("Subscription cancelled — user reverted to free plan", { userId });
  }
}

async function handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
  const subField = invoice.subscription;
  const subId = typeof subField === "string" ? subField : (subField as Stripe.Subscription | null)?.id;

  if (!subId) {
    logger.warn("Payment failed event has no subscription reference");
    return;
  }

  await db
    .update(subscriptions)
    .set({ status: "past_due" })
    .where(eq(subscriptions.stripe_subscription_id, subId));

  logger.warn("Payment failed — subscription marked past_due", { subscriptionId: subId });
}
