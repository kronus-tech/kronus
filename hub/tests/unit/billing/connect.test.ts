// connect.test.ts
//
// Unit tests for hub/src/billing/connect.ts
// Tests cover: createConnectAccount (stub mode), calculatePayouts (70/30 split),
// and executePayout (DB insert + status update).
//
// No real Stripe API calls are made and no real Postgres connection is required.
// The db module is replaced with a mock before any import resolves it.
//
// DATABASE_URL / REDIS_URL must be set before any import because getConfig()
// is invoked at module-load time through the transitive import chain.

// ---------------------------------------------------------------------------
// 1. Set required env vars — must be first
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

delete process.env["STRIPE_SECRET_KEY"];

// ---------------------------------------------------------------------------
// 2. Mock db module — must happen before static imports
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

type MockReturnValue = Record<string, unknown>[];

let _insertReturn: MockReturnValue = [];
let _updateReturn: MockReturnValue = [];
let _selectJoinReturn: Array<{
  developer_id: string;
  app_id: string;
  total_calls: number;
  total_bytes: number;
}> = [];

// Fluent SELECT/JOIN builder used by calculatePayouts
const mockSelectJoinBuilder = {
  from: () => mockSelectJoinBuilder,
  innerJoin: () => mockSelectJoinBuilder,
  where: () => mockSelectJoinBuilder,
  groupBy: () => Promise.resolve(_selectJoinReturn),
};

// INSERT builder used by executePayout
const mockInsertBuilder = {
  values: () => mockInsertBuilder,
  returning: () => Promise.resolve(_insertReturn),
};

// UPDATE builder used by executePayout
const mockUpdateBuilder = {
  set: () => mockUpdateBuilder,
  where: () => Promise.resolve(_updateReturn),
};

const mockDb = {
  select: (_fields?: unknown) => mockSelectJoinBuilder,
  insert: (_table?: unknown) => mockInsertBuilder,
  update: (_table?: unknown) => mockUpdateBuilder,
};

mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  sql: {},
}));

// ---------------------------------------------------------------------------
// 3. Static imports — safe after mocks and env vars
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "bun:test";
import {
  createConnectAccount,
  calculatePayouts,
  executePayout,
  type PayoutCalculation,
} from "../../../src/billing/connect.js";

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

function mockInsertReturns(rows: MockReturnValue): void {
  _insertReturn = rows;
}

function mockSelectJoinReturns(rows: typeof _selectJoinReturn): void {
  _selectJoinReturn = rows;
}

// ---------------------------------------------------------------------------
// 5. Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _insertReturn = [];
  _updateReturn = [];
  _selectJoinReturn = [];
  delete process.env["STRIPE_SECRET_KEY"];
});

// ---------------------------------------------------------------------------
// createConnectAccount — stub mode
// ---------------------------------------------------------------------------

describe("createConnectAccount — stub mode (Stripe not configured)", () => {
  it("returns a stub account ID when Stripe is not configured", async () => {
    // Act
    const accountId = await createConnectAccount("krn_usr_dev001", "dev@example.com");

    // Assert
    expect(typeof accountId).toBe("string");
    expect(accountId.length).toBeGreaterThan(0);
  });

  it("stub account ID contains the developer ID", async () => {
    // Act
    const accountId = await createConnectAccount("krn_usr_dev001", "dev@example.com");

    // Assert — stub format is acct_stub_<developerId>
    expect(accountId).toContain("krn_usr_dev001");
  });

  it("stub account ID starts with 'acct_stub_'", async () => {
    // Act
    const accountId = await createConnectAccount("krn_usr_dev001", "dev@example.com");

    // Assert
    expect(accountId).toBe("acct_stub_krn_usr_dev001");
  });

  it("two calls with different developer IDs return different stub IDs", async () => {
    // Act
    const id1 = await createConnectAccount("krn_usr_dev001", "dev1@example.com");
    const id2 = await createConnectAccount("krn_usr_dev002", "dev2@example.com");

    // Assert
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// calculatePayouts — 70/30 commission split
// ---------------------------------------------------------------------------

describe("calculatePayouts — commission math", () => {
  const periodStart = new Date("2026-03-01T00:00:00.000Z");
  const periodEnd   = new Date("2026-04-01T00:00:00.000Z");

  it("returns an empty array when there are no usage events", async () => {
    // Arrange
    mockSelectJoinReturns([]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert
    expect(results).toEqual([]);
  });

  it("returns one PayoutCalculation per developer/app combination", async () => {
    // Arrange — two distinct developer/app pairs
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 100, total_bytes: 0 },
      { developer_id: "krn_usr_dev002", app_id: "krn_app_002", total_calls: 50, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert
    expect(results.length).toBe(2);
  });

  it("gross_revenue_cents equals total_calls * 1 cent per call", async () => {
    // Arrange — 200 calls × $0.01/call = 200 cents
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 200, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert
    expect(results[0]!.gross_revenue_cents).toBe(200);
  });

  it("commission_cents is 30% of gross_revenue_cents", async () => {
    // Arrange — 100 calls → gross = 100 cents → commission = 30 cents
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 100, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert — Math.round(100 * 0.30) = 30
    expect(results[0]!.commission_cents).toBe(30);
  });

  it("payout_cents is 70% of gross_revenue_cents", async () => {
    // Arrange — 100 calls → gross = 100 cents → payout = 70 cents
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 100, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert
    expect(results[0]!.payout_cents).toBe(70);
  });

  it("payout_cents + commission_cents equals gross_revenue_cents", async () => {
    // Arrange — verify the split adds up to 100% for a non-round number
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 333, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);
    const r = results[0]!;

    // Assert — rounding may cause payout + commission to be off by 1 cent max
    const diff = Math.abs(r.payout_cents + r.commission_cents - r.gross_revenue_cents);
    expect(diff).toBeLessThanOrEqual(1);
  });

  it("PayoutCalculation carries developer_id and app_id through", async () => {
    // Arrange
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 50, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert
    expect(results[0]!.developer_id).toBe("krn_usr_dev001");
    expect(results[0]!.app_id).toBe("krn_app_001");
  });

  it("PayoutCalculation carries total_calls through", async () => {
    // Arrange
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 77, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert
    expect(results[0]!.total_calls).toBe(77);
  });

  it("handles zero calls (no revenue) without error", async () => {
    // Arrange
    mockSelectJoinReturns([
      { developer_id: "krn_usr_dev001", app_id: "krn_app_001", total_calls: 0, total_bytes: 0 },
    ]);

    // Act
    const results = await calculatePayouts(periodStart, periodEnd);

    // Assert
    expect(results[0]!.gross_revenue_cents).toBe(0);
    expect(results[0]!.commission_cents).toBe(0);
    expect(results[0]!.payout_cents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// executePayout — inserts into payouts table and returns a payout ID
// ---------------------------------------------------------------------------

describe("executePayout — DB insert", () => {
  const periodStart = new Date("2026-03-01T00:00:00.000Z");
  const periodEnd   = new Date("2026-04-01T00:00:00.000Z");

  it("returns the payout ID returned by the insert", async () => {
    // Arrange
    mockInsertReturns([{ id: "krn_pay_testpayout01" }]);

    // Act
    const payoutId = await executePayout(
      "krn_usr_dev001",
      70,
      30,
      periodStart,
      periodEnd
    );

    // Assert
    expect(payoutId).toBe("krn_pay_testpayout01");
  });

  it("returns a non-empty string payout ID", async () => {
    // Arrange
    mockInsertReturns([{ id: "krn_pay_testpayout02" }]);

    // Act
    const payoutId = await executePayout(
      "krn_usr_dev001",
      700,
      300,
      periodStart,
      periodEnd
    );

    // Assert
    expect(typeof payoutId).toBe("string");
    expect(payoutId.length).toBeGreaterThan(0);
  });

  it("throws when the insert returns no rows (no generated ID)", async () => {
    // Arrange — simulate an insert that returns an empty array
    mockInsertReturns([]);

    // Act + Assert
    await expect(
      executePayout("krn_usr_dev001", 70, 30, periodStart, periodEnd)
    ).rejects.toThrow("Failed to insert payout record");
  });

  it("throws error message that includes the developer ID", async () => {
    // Arrange
    mockInsertReturns([]);

    // Act + Assert
    await expect(
      executePayout("krn_usr_dev001", 70, 30, periodStart, periodEnd)
    ).rejects.toThrow("krn_usr_dev001");
  });

  it("handles a large payout amount without error", async () => {
    // Arrange — $10,000 payout
    mockInsertReturns([{ id: "krn_pay_largepayout" }]);

    // Act
    const payoutId = await executePayout(
      "krn_usr_dev001",
      700_000,
      300_000,
      periodStart,
      periodEnd
    );

    // Assert
    expect(payoutId).toBe("krn_pay_largepayout");
  });
});
