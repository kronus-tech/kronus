import { getStripe, isStripeConfigured } from "./stripe.js";
import { db } from "../db/index.js";
import { payouts, apps, usage_events } from "../db/schema.js";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("billing:connect");

const PLATFORM_COMMISSION = 0.30; // 30 % platform fee

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PayoutCalculation {
  readonly developer_id: string;
  readonly app_id: string;
  readonly total_calls: number;
  readonly gross_revenue_cents: number;
  readonly commission_cents: number;
  readonly payout_cents: number;
}

// ---------------------------------------------------------------------------
// Connect account management
// ---------------------------------------------------------------------------

export async function createConnectAccount(developerId: string, email: string): Promise<string> {
  if (!isStripeConfigured()) {
    const stubId = `acct_stub_${developerId}`;
    logger.info("Stripe not configured — returning stub Connect account", { developerId });
    return stubId;
  }

  const stripe = getStripe();

  const account = await stripe.accounts.create({
    type: "express",
    email,
    metadata: { kronus_developer_id: developerId },
  });

  logger.info("Stripe Connect account created", { developerId, accountId: account.id });
  return account.id;
}

export async function createAccountLink(connectAccountId: string, returnUrl: string): Promise<string> {
  if (!isStripeConfigured()) {
    logger.info("Stripe not configured — returning stub account link", { connectAccountId });
    return returnUrl;
  }

  const stripe = getStripe();

  const link = await stripe.accountLinks.create({
    account: connectAccountId,
    refresh_url: returnUrl,
    return_url: returnUrl,
    type: "account_onboarding",
  });

  return link.url;
}

// ---------------------------------------------------------------------------
// Payout calculation
// ---------------------------------------------------------------------------

// Flat rate: $0.01 per MCP call (placeholder — will be replaced by per-app pricing)
const RATE_PER_CALL_CENTS = 1;

export async function calculatePayouts(
  periodStart: Date,
  periodEnd: Date
): Promise<PayoutCalculation[]> {
  const results = await db
    .select({
      developer_id: apps.developer_id,
      app_id: apps.id,
      total_calls: sql<number>`count(*)::int`,
      total_bytes: sql<number>`coalesce(sum(${usage_events.payload_bytes}), 0)::int`,
    })
    .from(usage_events)
    .innerJoin(apps, eq(usage_events.app_id, apps.id))
    .where(
      and(
        gte(usage_events.timestamp, periodStart),
        lt(usage_events.timestamp, periodEnd)
      )
    )
    .groupBy(apps.developer_id, apps.id);

  return results.map((r) => {
    const grossRevenue = r.total_calls * RATE_PER_CALL_CENTS;
    const commission = Math.round(grossRevenue * PLATFORM_COMMISSION);
    const payoutAmount = grossRevenue - commission;

    return {
      developer_id: r.developer_id,
      app_id: r.app_id,
      total_calls: r.total_calls,
      gross_revenue_cents: grossRevenue,
      commission_cents: commission,
      payout_cents: payoutAmount,
    };
  });
}

// ---------------------------------------------------------------------------
// Payout execution
// ---------------------------------------------------------------------------

export async function executePayout(
  developerId: string,
  amountCents: number,
  commissionCents: number,
  periodStart: Date,
  periodEnd: Date
): Promise<string> {
  const inserted = await db
    .insert(payouts)
    .values({
      developer_id: developerId,
      amount_cents: amountCents,
      commission_cents: commissionCents,
      period_start: periodStart,
      period_end: periodEnd,
      status: "pending",
    })
    .returning({ id: payouts.id });

  const payoutId = inserted[0]?.id;
  if (!payoutId) {
    throw new Error(`Failed to insert payout record for developer ${developerId}`);
  }

  // TODO: When a real Stripe Connect account ID is stored per developer,
  // create a transfer here:
  //   const stripe = getStripe();
  //   const transfer = await stripe.transfers.create({
  //     amount: amountCents,
  //     currency: "usd",
  //     destination: connectAccountId,
  //     metadata: { kronus_payout_id: payoutId },
  //   });
  //   await db.update(payouts).set({ stripe_transfer_id: transfer.id, status: "paid" })
  //     .where(eq(payouts.id, payoutId));

  await db.update(payouts).set({ status: "paid" }).where(eq(payouts.id, payoutId));

  logger.info("Payout executed", { developerId, amountCents, payoutId });
  return payoutId;
}
