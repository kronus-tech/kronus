// billing.test.ts — Integration tests for billing routes
//
// Strategy: use Hono's app.request() test helper with the real app instance.
// The db module is mocked via Bun's mock.module() — no real Postgres connection
// is required. JWT keys are initialised in beforeAll() in ephemeral mode.
//
// Route mounting order (from hub/src/index.ts):
//   app.route("/billing", webhookRoutes)   ← NO auth, raw body
//   app.use("/billing/*", bodyLimit)
//   app.route("/billing", billingRoutes)   ← requireAuth middleware
//
// IMPORTANT: process.env vars and mock.module() calls must happen BEFORE any
// static import. Bun resolves static imports after top-level module code runs.

// ---------------------------------------------------------------------------
// 1. Set required env vars — must be first
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

// Explicitly unset Stripe keys so tests run in stub mode by default
delete process.env["STRIPE_SECRET_KEY"];
delete process.env["STRIPE_WEBHOOK_SECRET"];

// ---------------------------------------------------------------------------
// 2. Mock the db module — same pattern as auth.test.ts
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

type MockReturnValue = Record<string, unknown>[];

let _selectReturn: MockReturnValue = [];
let _insertReturn: MockReturnValue = [];
let _updateReturn: MockReturnValue = [];

// Fluent builder stubs for SELECT: db.select().from().where().limit()
const mockSelectBuilder = {
  from: () => mockSelectBuilder,
  where: () => mockSelectBuilder,
  limit: () => Promise.resolve(_selectReturn),
};

// Fluent builder stubs for INSERT: db.insert().values().returning()
const mockInsertBuilder = {
  values: () => mockInsertBuilder,
  returning: () => Promise.resolve(_insertReturn),
};

// Fluent builder stubs for UPDATE: db.update().set().where()
const mockUpdateBuilder = {
  set: () => mockUpdateBuilder,
  where: () => Promise.resolve(_updateReturn),
};

const mockDb = {
  select: (_fields?: unknown) => mockSelectBuilder,
  insert: (_table?: unknown) => mockInsertBuilder,
  update: (_table?: unknown) => mockUpdateBuilder,
};

// Mock before any static import touches the db module
mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  sql: {},
}));

mock.module("../../src/lib/redis.js", () => ({
  getRedis: () => ({ incr: () => Promise.resolve(1), expire: () => Promise.resolve(1), get: () => Promise.resolve(null), set: () => Promise.resolve("OK"), setex: () => Promise.resolve("OK"), del: () => Promise.resolve(1), pipeline: () => ({ incr: () => ({}), expire: () => ({}), incrby: () => ({}), exec: () => Promise.resolve([]) }), status: "ready" }),
  closeRedis: () => Promise.resolve(),
  isRedisReady: () => true,
}));

// ---------------------------------------------------------------------------
// 3. Static imports — safe after env vars and mocks are in place
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { app } from "../../src/index.js";
import { initializeKeys, signAccessToken } from "../../src/auth/jwt.js";

// ---------------------------------------------------------------------------
// 4. Fixtures and helpers
// ---------------------------------------------------------------------------

const MOCK_USER_ID = "krn_usr_testbilling01";
const MOCK_EMAIL = "billing@example.com";

/** Build a valid access token for a test user */
async function makeAccessToken(userId = MOCK_USER_ID, plan = "free"): Promise<string> {
  return signAccessToken({
    sub: userId,
    plan,
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });
}

/** Build a GET Request with an Authorization header */
function authGet(path: string, token: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Build a POST Request with an Authorization header and JSON body */
function authPost(path: string, token: string, body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** Configure what db.select().from().where().limit() resolves to */
function mockSelectReturns(rows: MockReturnValue): void {
  _selectReturn = rows;
}

/** Configure what db.insert().values().returning() resolves to */
function mockInsertReturns(rows: MockReturnValue): void {
  _insertReturn = rows;
}

// ---------------------------------------------------------------------------
// 5. Global setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();
});

beforeEach(() => {
  _selectReturn = [];
  _insertReturn = [];
  _updateReturn = [];
  // Keep Stripe in stub mode between tests
  delete process.env["STRIPE_SECRET_KEY"];
  delete process.env["STRIPE_WEBHOOK_SECRET"];
});

// ---------------------------------------------------------------------------
// GET /billing/subscription
// ---------------------------------------------------------------------------

describe("GET /billing/subscription — happy path", () => {
  it("returns 200 for an authenticated user", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ plan: "free", stripe_customer_id: null }]);

    // Act
    const response = await app.request(authGet("/billing/subscription", token));

    // Assert
    expect(response.status).toBe(200);
  });

  it("response body contains the user's plan", async () => {
    // Arrange
    const token = await makeAccessToken(MOCK_USER_ID, "pro");
    mockSelectReturns([{ plan: "pro", stripe_customer_id: null }]);

    // Act
    const response = await app.request(authGet("/billing/subscription", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["plan"]).toBe("pro");
  });

  it("response body contains stripe_configured flag", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ plan: "free", stripe_customer_id: null }]);

    // Act
    const response = await app.request(authGet("/billing/subscription", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert — Stripe is not configured in test env
    expect(typeof body["stripe_configured"]).toBe("boolean");
    expect(body["stripe_configured"]).toBe(false);
  });

  it("response body contains has_customer_id flag", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ plan: "free", stripe_customer_id: null }]);

    // Act
    const response = await app.request(authGet("/billing/subscription", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["has_customer_id"]).toBe(false);
  });

  it("has_customer_id is true when stripe_customer_id is present", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ plan: "pro", stripe_customer_id: "cus_testcustomer123" }]);

    // Act
    const response = await app.request(authGet("/billing/subscription", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["has_customer_id"]).toBe(true);
  });
});

describe("GET /billing/subscription — auth failures", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/subscription")
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns 401 when Authorization header has an invalid token", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/subscription", {
        headers: { Authorization: "Bearer not.a.valid.token" },
      })
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns 404 when authenticated user is not found in the database", async () => {
    // Arrange — token is valid but db returns no rows
    const token = await makeAccessToken();
    mockSelectReturns([]);

    // Act
    const response = await app.request(authGet("/billing/subscription", token));

    // Assert
    expect(response.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// POST /billing/subscribe/:plan
// ---------------------------------------------------------------------------

describe("POST /billing/subscribe/:plan — stub mode", () => {
  it("returns 200 for a valid 'pro' plan", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ email: MOCK_EMAIL }]);

    // Act
    const response = await app.request(authPost("/billing/subscribe/pro", token));

    // Assert
    expect(response.status).toBe(200);
  });

  it("response contains checkout_url", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ email: MOCK_EMAIL }]);

    // Act
    const response = await app.request(authPost("/billing/subscribe/pro", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["checkout_url"]).toBe("string");
  });

  it("response contains session_id", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ email: MOCK_EMAIL }]);

    // Act
    const response = await app.request(authPost("/billing/subscribe/pro", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["session_id"]).toBe("string");
  });

  it("stub session_id is 'stub_session'", async () => {
    // Arrange — STRIPE_SECRET_KEY is not set, so stub mode is active
    const token = await makeAccessToken();
    mockSelectReturns([{ email: MOCK_EMAIL }]);

    // Act
    const response = await app.request(authPost("/billing/subscribe/pro", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["session_id"]).toBe("stub_session");
  });

  it("returns 200 for the 'enterprise' plan", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ email: MOCK_EMAIL }]);

    // Act
    const response = await app.request(authPost("/billing/subscribe/enterprise", token));

    // Assert
    expect(response.status).toBe(200);
  });

  it("returns 400 for an invalid plan name", async () => {
    // Arrange
    const token = await makeAccessToken();

    // Act
    const response = await app.request(authPost("/billing/subscribe/platinum", token));

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 for an empty plan name segment", async () => {
    // Arrange — 'free' is not in the plan catalogue
    const token = await makeAccessToken();

    // Act
    const response = await app.request(authPost("/billing/subscribe/free", token));

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 401 without a valid auth token", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/subscribe/pro", { method: "POST" })
    );

    // Assert
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /billing/portal
// ---------------------------------------------------------------------------

describe("GET /billing/portal", () => {
  it("returns 400 when the user has no stripe_customer_id", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ stripe_customer_id: null }]);

    // Act
    const response = await app.request(authGet("/billing/portal", token));

    // Assert — user has not subscribed yet, so no customer ID exists
    expect(response.status).toBe(400);
  });

  it("400 response error message mentions billing account", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ stripe_customer_id: null }]);

    // Act
    const response = await app.request(authGet("/billing/portal", token));
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    const message = body.error["message"] as string;
    expect(message.toLowerCase()).toContain("billing");
  });

  it("returns 400 when user row is not found", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([]);

    // Act
    const response = await app.request(authGet("/billing/portal", token));

    // Assert — no stripe_customer_id means 400 (the route checks u?.stripe_customer_id)
    expect(response.status).toBe(400);
  });

  it("returns 200 with portal_url in stub mode when customer ID is present", async () => {
    // Arrange — Stripe is not configured, so createPortalSession returns returnUrl
    const token = await makeAccessToken();
    mockSelectReturns([{ stripe_customer_id: "cus_testcustomer123" }]);

    // Act
    const response = await app.request(authGet("/billing/portal", token));

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(typeof body["portal_url"]).toBe("string");
  });

  it("returns 401 without auth", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/portal")
    );

    // Assert
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /billing/usage
// ---------------------------------------------------------------------------

describe("GET /billing/usage", () => {
  it("returns 200 for an authenticated user", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ total_calls: 42, total_bytes: 8192 }]);

    // Act
    const response = await app.request(authGet("/billing/usage", token));

    // Assert
    expect(response.status).toBe(200);
  });

  it("response body contains total_calls", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ total_calls: 42, total_bytes: 8192 }]);

    // Act
    const response = await app.request(authGet("/billing/usage", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["total_calls"]).toBeDefined();
  });

  it("response body contains total_bytes", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ total_calls: 42, total_bytes: 8192 }]);

    // Act
    const response = await app.request(authGet("/billing/usage", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["total_bytes"]).toBeDefined();
  });

  it("response body contains period_start as an ISO 8601 string", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ total_calls: 0, total_bytes: 0 }]);

    // Act
    const response = await app.request(authGet("/billing/usage", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["period_start"]).toBe("string");
    expect(() => new Date(body["period_start"] as string)).not.toThrow();
  });

  it("response body contains period_end as an ISO 8601 string", async () => {
    // Arrange
    const token = await makeAccessToken();
    mockSelectReturns([{ total_calls: 0, total_bytes: 0 }]);

    // Act
    const response = await app.request(authGet("/billing/usage", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["period_end"]).toBe("string");
  });

  it("returns 0 counts when there are no usage events", async () => {
    // Arrange — route defaults to { total_calls: 0, total_bytes: 0 } when rows[0] is undefined
    const token = await makeAccessToken();
    mockSelectReturns([]);

    // Act
    const response = await app.request(authGet("/billing/usage", token));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["total_calls"]).toBe(0);
    expect(body["total_bytes"]).toBe(0);
  });

  it("returns 401 without auth", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/usage")
    );

    // Assert
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /billing/webhooks — stub mode (no STRIPE_SECRET_KEY)
// ---------------------------------------------------------------------------

describe("POST /billing/webhooks — stub mode (Stripe not configured)", () => {
  it("returns 200", async () => {
    // Arrange — STRIPE_SECRET_KEY is not set
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/webhooks", { method: "POST" })
    );

    // Assert
    expect(response.status).toBe(200);
  });

  it("response body is { received: true, mode: 'stub' }", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/webhooks", { method: "POST" })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["received"]).toBe(true);
    expect(body["mode"]).toBe("stub");
  });

  it("does not require an Authorization header", async () => {
    // Act — no auth header, no stripe-signature
    const response = await app.request(
      new Request("http://localhost/billing/webhooks", { method: "POST" })
    );

    // Assert — webhook route has no auth middleware
    expect(response.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /billing/webhooks — with STRIPE_SECRET_KEY but missing/invalid sig
// ---------------------------------------------------------------------------

describe("POST /billing/webhooks — Stripe configured, signature checks", () => {
  beforeEach(() => {
    // Configure a fake key so isStripeConfigured() returns true and the
    // signature-verification branch is reached. The Stripe SDK will reject the
    // request because the key/secret are not real — that is exactly what we
    // want to verify (400 on invalid signature).
    process.env["STRIPE_SECRET_KEY"] = "sk_test_fakekeyfortesting";
    process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fakesecretfortesting";
  });

  it("returns 400 when stripe-signature header is absent", async () => {
    // Act — no stripe-signature header
    const response = await app.request(
      new Request("http://localhost/billing/webhooks", {
        method: "POST",
        body: JSON.stringify({ type: "customer.subscription.created" }),
        headers: { "Content-Type": "application/json" },
      })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("response error mentions 'Missing signature' when header is absent", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/webhooks", {
        method: "POST",
        body: "{}",
      })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["error"]).toBe("Missing signature");
  });

  it("returns 400 when stripe-signature header has an invalid value", async () => {
    // Arrange — send an obviously bogus signature
    const response = await app.request(
      new Request("http://localhost/billing/webhooks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": "t=0,v1=invalidsignaturevalue",
        },
        body: JSON.stringify({ type: "customer.subscription.created" }),
      })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("response error mentions 'Invalid signature' on verification failure", async () => {
    // Act
    const response = await app.request(
      new Request("http://localhost/billing/webhooks", {
        method: "POST",
        headers: {
          "stripe-signature": "t=0,v1=invalidsignaturevalue",
        },
        body: "{}",
      })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["error"]).toBe("Invalid signature");
  });
});
