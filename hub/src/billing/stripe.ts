import Stripe from "stripe";
import { getConfig } from "../lib/config.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("billing:stripe");

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const config = getConfig();
    if (!config.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY not configured — billing is disabled");
    }
    _stripe = new Stripe(config.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

export function isStripeConfigured(): boolean {
  const config = getConfig();
  return !!config.STRIPE_SECRET_KEY;
}

// ---------------------------------------------------------------------------
// Plan catalogue — in production these map to real Stripe Price IDs
// ---------------------------------------------------------------------------

interface PlanPrice {
  readonly priceId: string;
  readonly amount: number;
  readonly name: string;
}

const PLAN_PRICES: Readonly<Record<string, PlanPrice>> = {
  pro: { priceId: "price_pro_monthly", amount: 999, name: "Kronus Pro" },
  enterprise: { priceId: "price_enterprise_monthly", amount: 4999, name: "Kronus Enterprise" },
};

export function getPlanPrice(plan: string): PlanPrice | null {
  return PLAN_PRICES[plan] ?? null;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

export interface CheckoutResult {
  readonly url: string;
  readonly sessionId: string;
}

export async function createCheckoutSession(
  userId: string,
  email: string,
  plan: string,
  successUrl: string,
  cancelUrl: string
): Promise<CheckoutResult> {
  const planPrice = getPlanPrice(plan);
  if (!planPrice) {
    throw new Error(`Invalid plan: ${plan}`);
  }

  if (!isStripeConfigured()) {
    const config = getConfig();
    if (config.NODE_ENV === "production") {
      throw new Error("Billing not configured in production — set STRIPE_SECRET_KEY");
    }
    logger.info("Stripe not configured — returning stub checkout session", { userId, plan });
    return { url: `${successUrl}?session_id=stub_session`, sessionId: "stub_session" };
  }

  const stripe = getStripe();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    line_items: [{ price: planPrice.priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { kronus_user_id: userId, plan },
  });

  logger.info("Checkout session created", { userId, plan, sessionId: session.id });

  return { url: session.url ?? successUrl, sessionId: session.id };
}

// ---------------------------------------------------------------------------
// Customer Portal
// ---------------------------------------------------------------------------

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  if (!isStripeConfigured()) {
    const config = getConfig();
    if (config.NODE_ENV === "production") {
      throw new Error("Billing not configured in production — set STRIPE_SECRET_KEY");
    }
    logger.info("Stripe not configured — returning stub portal URL", { customerId });
    return returnUrl;
  }

  const stripe = getStripe();

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return session.url;
}
