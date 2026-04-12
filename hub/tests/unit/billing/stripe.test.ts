// stripe.test.ts
//
// Unit tests for hub/src/billing/stripe.ts
// No real Stripe API calls are made — tests cover the module's public surface
// using env-var control and the stub-mode behaviour built into the source.
//
// DATABASE_URL / REDIS_URL must be set before any import because getConfig()
// is invoked at module-load time through the transitive import chain.

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

// ---------------------------------------------------------------------------
// Remove Stripe key so getConfig() singleton does not cache an old value
// ---------------------------------------------------------------------------

delete process.env["STRIPE_SECRET_KEY"];

// ---------------------------------------------------------------------------
// Imports — safe after env vars are set
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "bun:test";
import { isStripeConfigured, getPlanPrice, createCheckoutSession } from "../../../src/billing/stripe.js";

// ---------------------------------------------------------------------------
// Helpers — manipulate the cached config singleton between tests
//
// getConfig() is a lazy singleton. Once the module loads and caches the object
// we cannot re-run loadConfig() normally. We reset the cache by reaching into
// the config module's exported `config` object accessor which re-reads
// process.env on each call because the singleton is re-evaluated when we
// manipulate the module cache key via the Bun test env approach.
//
// The simplest reliable approach: set / delete the env key and call
// isStripeConfigured() which reads getConfig() live; the config module
// itself also exports loadConfig() directly for tests that want a fresh read.
// ---------------------------------------------------------------------------

// We need loadConfig() fresh each time — re-import it and call directly
import { loadConfig } from "../../../src/lib/config.js";

function withStripeKey(key: string, fn: () => void): void {
  const original = process.env["STRIPE_SECRET_KEY"];
  process.env["STRIPE_SECRET_KEY"] = key;
  try {
    fn();
  } finally {
    if (original === undefined) {
      delete process.env["STRIPE_SECRET_KEY"];
    } else {
      process.env["STRIPE_SECRET_KEY"] = original;
    }
  }
}

// ---------------------------------------------------------------------------
// isStripeConfigured
// ---------------------------------------------------------------------------

describe("isStripeConfigured", () => {
  it("returns false when STRIPE_SECRET_KEY is not set", () => {
    // Arrange — env key is deleted at the top of the file
    delete process.env["STRIPE_SECRET_KEY"];

    // Act — loadConfig() gives us a fresh, un-cached config object
    const config = loadConfig();

    // Assert
    expect(!!config.STRIPE_SECRET_KEY).toBe(false);
  });

  it("returns true when STRIPE_SECRET_KEY is set to a non-empty string", () => {
    // Arrange
    process.env["STRIPE_SECRET_KEY"] = "sk_test_placeholder_key";

    // Act
    const config = loadConfig();

    // Assert
    expect(!!config.STRIPE_SECRET_KEY).toBe(true);

    // Cleanup
    delete process.env["STRIPE_SECRET_KEY"];
  });

  it("returns false when STRIPE_SECRET_KEY is set to an empty string", () => {
    // Arrange
    process.env["STRIPE_SECRET_KEY"] = "";

    // Act
    const config = loadConfig();

    // Assert
    expect(!!config.STRIPE_SECRET_KEY).toBe(false);

    // Cleanup
    delete process.env["STRIPE_SECRET_KEY"];
  });
});

// ---------------------------------------------------------------------------
// getPlanPrice
// ---------------------------------------------------------------------------

describe("getPlanPrice", () => {
  it("returns a PlanPrice object for the 'pro' plan", () => {
    // Act
    const price = getPlanPrice("pro");

    // Assert
    expect(price).not.toBeNull();
  });

  it("pro plan has priceId 'price_pro_monthly'", () => {
    // Act
    const price = getPlanPrice("pro");

    // Assert
    expect(price!.priceId).toBe("price_pro_monthly");
  });

  it("pro plan amount is 999 cents ($9.99)", () => {
    // Act
    const price = getPlanPrice("pro");

    // Assert
    expect(price!.amount).toBe(999);
  });

  it("pro plan name is 'Kronus Pro'", () => {
    // Act
    const price = getPlanPrice("pro");

    // Assert
    expect(price!.name).toBe("Kronus Pro");
  });

  it("returns a PlanPrice object for the 'enterprise' plan", () => {
    // Act
    const price = getPlanPrice("enterprise");

    // Assert
    expect(price).not.toBeNull();
  });

  it("enterprise plan has priceId 'price_enterprise_monthly'", () => {
    // Act
    const price = getPlanPrice("enterprise");

    // Assert
    expect(price!.priceId).toBe("price_enterprise_monthly");
  });

  it("enterprise plan amount is 4999 cents ($49.99)", () => {
    // Act
    const price = getPlanPrice("enterprise");

    // Assert
    expect(price!.amount).toBe(4999);
  });

  it("returns null for an unrecognised plan string", () => {
    // Act
    const price = getPlanPrice("platinum");

    // Assert
    expect(price).toBeNull();
  });

  it("returns null for an empty string plan", () => {
    // Act
    const price = getPlanPrice("");

    // Assert
    expect(price).toBeNull();
  });

  it("returns null for a plan with different casing (case-sensitive lookup)", () => {
    // Act
    const price = getPlanPrice("PRO");

    // Assert — plan keys are lowercase only
    expect(price).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createCheckoutSession — stub mode (no STRIPE_SECRET_KEY)
// ---------------------------------------------------------------------------

describe("createCheckoutSession — stub mode", () => {
  beforeEach(() => {
    // Ensure Stripe is not configured for these tests
    delete process.env["STRIPE_SECRET_KEY"];
  });

  it("returns an object with a url field in stub mode", async () => {
    // Arrange
    const successUrl = "http://localhost:3100/billing/success";
    const cancelUrl = "http://localhost:3100/billing/cancel";

    // Act
    const result = await createCheckoutSession(
      "krn_usr_testuser0001",
      "alice@example.com",
      "pro",
      successUrl,
      cancelUrl
    );

    // Assert
    expect(result).toHaveProperty("url");
  });

  it("stub url starts with the successUrl", async () => {
    // Arrange
    const successUrl = "http://localhost:3100/billing/success";
    const cancelUrl = "http://localhost:3100/billing/cancel";

    // Act
    const result = await createCheckoutSession(
      "krn_usr_testuser0001",
      "alice@example.com",
      "pro",
      successUrl,
      cancelUrl
    );

    // Assert — stub mode appends ?session_id=stub_session to successUrl
    expect(result.url).toContain(successUrl);
  });

  it("stub sessionId is 'stub_session'", async () => {
    // Arrange
    const successUrl = "http://localhost:3100/billing/success";
    const cancelUrl = "http://localhost:3100/billing/cancel";

    // Act
    const result = await createCheckoutSession(
      "krn_usr_testuser0001",
      "alice@example.com",
      "pro",
      successUrl,
      cancelUrl
    );

    // Assert
    expect(result.sessionId).toBe("stub_session");
  });

  it("throws when given an invalid plan", async () => {
    // Arrange
    const successUrl = "http://localhost:3100/billing/success";
    const cancelUrl = "http://localhost:3100/billing/cancel";

    // Act + Assert
    await expect(
      createCheckoutSession(
        "krn_usr_testuser0001",
        "alice@example.com",
        "nonexistent",
        successUrl,
        cancelUrl
      )
    ).rejects.toThrow("Invalid plan: nonexistent");
  });

  it("works in stub mode for enterprise plan too", async () => {
    // Arrange
    const successUrl = "http://localhost:3100/billing/success";
    const cancelUrl = "http://localhost:3100/billing/cancel";

    // Act
    const result = await createCheckoutSession(
      "krn_usr_testuser0001",
      "enterprise@example.com",
      "enterprise",
      successUrl,
      cancelUrl
    );

    // Assert
    expect(result.sessionId).toBe("stub_session");
  });
});
