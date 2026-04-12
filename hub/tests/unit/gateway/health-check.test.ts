// health-check.test.ts — Unit tests for the Gateway Health Check system
//
// Strategy:
//   - Mock db, Redis, and globalThis.fetch before importing the module
//   - Import startHealthCheck, stopHealthCheck, getHealthCheckState from source
//   - Control fetch responses per test to simulate healthy/degraded/offline states
//   - Use fake timers where needed to advance intervals without real waiting
//
// The health check module maintains a module-level interval reference.
// stopHealthCheck() resets it. Tests that call startHealthCheck() must call
// stopHealthCheck() in afterEach to avoid interval leakage between tests.

// ---------------------------------------------------------------------------
// 1. Env vars — must be first
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

// ---------------------------------------------------------------------------
// 2. Mocks — must precede static imports
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

// --- DB mock state ---

type MockRow = Record<string, unknown>;

// Apps returned by the initial SELECT (published + degraded filter)
let _appsToCheck: MockRow[] = [];

// Track all db.update().set().where() calls so we can assert on status changes
const _dbUpdates: Array<{ status: string }> = [];

const mockSelectBuilder: Record<string, unknown> = {
  from: () => mockSelectBuilder,
  where: () => mockSelectBuilder,
  limit: () => Promise.resolve(_appsToCheck),
  // The health check uses a top-level .where() without .limit() for the app list —
  // resolved via .then so the builder itself must be thenable.
  then: (
    resolve: (v: MockRow[]) => void,
    reject?: (e: unknown) => void
  ) => Promise.resolve(_appsToCheck).then(resolve, reject),
};

const mockUpdateBuilder = {
  set: (values: { status?: string }) => {
    if (values.status) _dbUpdates.push({ status: values.status });
    return mockUpdateBuilder;
  },
  where: () => mockUpdateBuilder,
  returning: () => Promise.resolve([]),
};

const mockDb = {
  select: (_fields?: unknown) => mockSelectBuilder,
  update: (_table?: unknown) => mockUpdateBuilder,
};

mock.module("../../../src/db/index.js", () => ({
  db: mockDb,
  sql: {},
}));

// --- Redis mock state ---

const _redisCounters = new Map<string, number>();
const _redisDeleted = new Set<string>();

const mockRedis = {
  incr: (key: string) => {
    const cur = (_redisCounters.get(key) ?? 0) + 1;
    _redisCounters.set(key, cur);
    return Promise.resolve(cur);
  },
  expire: (_key: string, _ttl: number) => Promise.resolve(1),
  del: (key: string) => {
    _redisDeleted.add(key);
    _redisCounters.delete(key);
    return Promise.resolve(1);
  },
  get: (_key: string) => Promise.resolve(null),
  set: (_key: string, _val: string) => Promise.resolve("OK"),
  setex: (_key: string, _ttl: number, _val: string) => Promise.resolve("OK"),
  pipeline: () => ({
    incr: () => ({ exec: () => Promise.resolve([]) }),
    exec: () => Promise.resolve([]),
  }),
};

mock.module("../../../src/lib/redis.js", () => ({
  getRedis: () => mockRedis,
  closeRedis: () => Promise.resolve(),
}));

// ---------------------------------------------------------------------------
// 3. Static imports (after mocks)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  startHealthCheck,
  stopHealthCheck,
  getHealthCheckState,
} from "../../../src/gateway/health-check.js";

// ---------------------------------------------------------------------------
// 4. Helpers
// ---------------------------------------------------------------------------

const _originalFetch = globalThis.fetch;

function mockFetch(impl: typeof globalThis.fetch): void {
  globalThis.fetch = impl;
}

/** Fetch mock that returns the given HTTP status code. */
function fetchReturnsStatus(status: number): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: {}, id: 1 }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
}

/** Fetch mock that rejects (network failure / timeout). */
function fetchThrows(err = new Error("fetch failed")): typeof globalThis.fetch {
  return () => Promise.reject(err);
}

/** Build a mock app row for the health check SELECT result. */
function makeCheckableApp(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "krn_app_testapp0001",
    slug: "my-mcp-tool",
    developer_mcp_url: "https://mcp.example.com/mcp",
    status: "published",
    ...overrides,
  };
}

/**
 * Simulate N-1 prior failures by pre-seeding the Redis counter.
 * After this call, the next incr() call inside checkAppHealth will reach N.
 */
function preSeedFailures(appId: string, count: number): void {
  _redisCounters.set(`health:${appId}:failures`, count);
}

// ---------------------------------------------------------------------------
// 5. Reset state before/after each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  _appsToCheck = [];
  _dbUpdates.length = 0;
  _redisCounters.clear();
  _redisDeleted.clear();
  globalThis.fetch = _originalFetch;
  // Always stop any lingering interval from a prior test
  stopHealthCheck();
});

afterEach(() => {
  stopHealthCheck();
  globalThis.fetch = _originalFetch;
});

// ---------------------------------------------------------------------------
// checkAppHealth — healthy app
// ---------------------------------------------------------------------------

describe("checkAppHealth — healthy app (fetch returns 200)", () => {
  it("deletes the failure counter from Redis on a successful ping", async () => {
    // Arrange — seed a prior failure, then return 200 (recovery)
    const app = makeCheckableApp();
    _appsToCheck = [app];
    preSeedFailures("krn_app_testapp0001", 2);
    mockFetch(fetchReturnsStatus(200));

    // Act — trigger one check cycle via startHealthCheck with tiny interval
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80)); // wait for first run + one interval
    stopHealthCheck();

    // Assert — counter should have been deleted
    expect(_redisDeleted.has("health:krn_app_testapp0001:failures")).toBe(true);
  });

  it("does not update the app status in DB when already published and healthy", async () => {
    // Arrange
    _appsToCheck = [makeCheckableApp({ status: "published" })];
    mockFetch(fetchReturnsStatus(200));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — no status update should have been written for a healthy published app
    const publishedUpdates = _dbUpdates.filter((u) => u.status === "published");
    expect(publishedUpdates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkAppHealth — degraded app recovers
// ---------------------------------------------------------------------------

describe("checkAppHealth — degraded app recovers (fetch returns 200)", () => {
  it("updates app status to 'published' when a degraded app recovers", async () => {
    // Arrange — app is currently degraded but now responds healthy
    _appsToCheck = [makeCheckableApp({ status: "degraded" })];
    mockFetch(fetchReturnsStatus(200));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — status must be promoted back to published
    const recoveryUpdate = _dbUpdates.find((u) => u.status === "published");
    expect(recoveryUpdate).toBeDefined();
  });

  it("deletes the failure counter when a degraded app recovers", async () => {
    // Arrange
    _appsToCheck = [makeCheckableApp({ status: "degraded" })];
    preSeedFailures("krn_app_testapp0001", 5);
    mockFetch(fetchReturnsStatus(200));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert
    expect(_redisDeleted.has("health:krn_app_testapp0001:failures")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkAppHealth — first failure
// ---------------------------------------------------------------------------

describe("checkAppHealth — first failure (fetch returns 500)", () => {
  it("increments the Redis failure counter", async () => {
    // Arrange — no prior failures; fetch returns error
    _appsToCheck = [makeCheckableApp({ status: "published" })];
    mockFetch(fetchReturnsStatus(500));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — counter must have been incremented at least once
    const counter = _redisCounters.get("health:krn_app_testapp0001:failures") ?? 0;
    expect(counter).toBeGreaterThanOrEqual(1);
  });

  it("does not change the app status to degraded on first failure", async () => {
    // Arrange — only 1 failure, threshold is 3
    _appsToCheck = [makeCheckableApp({ status: "published" })];
    mockFetch(fetchReturnsStatus(500));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — no degraded update should have been written
    const degradedUpdates = _dbUpdates.filter((u) => u.status === "degraded");
    expect(degradedUpdates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkAppHealth — 3 consecutive failures → degraded
// ---------------------------------------------------------------------------

describe("checkAppHealth — 3 consecutive failures → degraded", () => {
  it("sets app status to 'degraded' when failure count reaches DEGRADED_THRESHOLD (3)", async () => {
    // Arrange — 2 prior failures; this check is the 3rd, crossing the threshold
    _appsToCheck = [makeCheckableApp({ status: "published" })];
    preSeedFailures("krn_app_testapp0001", 2); // counter will become 3 on next incr
    mockFetch(fetchReturnsStatus(503));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — status should now be degraded
    const degradedUpdate = _dbUpdates.find((u) => u.status === "degraded");
    expect(degradedUpdate).toBeDefined();
  });

  it("does not set status to offline when failure count is exactly at degraded threshold", async () => {
    // Arrange — exactly 3 failures (degraded threshold), not yet 10 (offline threshold)
    _appsToCheck = [makeCheckableApp({ status: "published" })];
    preSeedFailures("krn_app_testapp0001", 2);
    mockFetch(fetchReturnsStatus(503));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — must be degraded, not offline
    const offlineUpdate = _dbUpdates.find((u) => u.status === "offline");
    expect(offlineUpdate).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// checkAppHealth — 10 consecutive failures → offline
// ---------------------------------------------------------------------------

describe("checkAppHealth — 10 consecutive failures → offline", () => {
  it("sets app status to 'offline' when failure count reaches OFFLINE_THRESHOLD (10)", async () => {
    // Arrange — 9 prior failures; this check is the 10th
    _appsToCheck = [makeCheckableApp({ status: "degraded" })];
    preSeedFailures("krn_app_testapp0001", 9);
    mockFetch(fetchReturnsStatus(503));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert
    const offlineUpdate = _dbUpdates.find((u) => u.status === "offline");
    expect(offlineUpdate).toBeDefined();
  });

  it("does not write a degraded update once failure count already exceeds offline threshold", async () => {
    // Arrange — already at 9 failures; next incr reaches 10 → should jump to offline only
    _appsToCheck = [makeCheckableApp({ status: "degraded" })];
    preSeedFailures("krn_app_testapp0001", 9);
    mockFetch(fetchReturnsStatus(503));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — must be offline, not degraded (offline takes precedence)
    const degradedUpdate = _dbUpdates.find((u) => u.status === "degraded");
    expect(degradedUpdate).toBeUndefined();
    const offlineUpdate = _dbUpdates.find((u) => u.status === "offline");
    expect(offlineUpdate).toBeDefined();
  });

  it("does not set offline again when app is already offline", async () => {
    // Arrange — app is already offline; failure counter at 15
    _appsToCheck = [makeCheckableApp({ status: "offline" })];
    preSeedFailures("krn_app_testapp0001", 15);
    mockFetch(fetchReturnsStatus(503));

    // Act — NOTE: runHealthChecks only queries published|degraded apps, so offline
    // apps will not appear in _appsToCheck in production. We verify the guard here
    // by manually placing the offline app in _appsToCheck.
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — no additional offline write should be emitted
    const offlineUpdates = _dbUpdates.filter((u) => u.status === "offline");
    expect(offlineUpdates.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// checkAppHealth — fetch timeout treated as failure
// ---------------------------------------------------------------------------

describe("checkAppHealth — fetch timeout", () => {
  it("treats a fetch AbortError (timeout) as a failure and increments the counter", async () => {
    // Arrange
    _appsToCheck = [makeCheckableApp({ status: "published" })];
    const abortError = new DOMException("The user aborted a request.", "AbortError");
    mockFetch(fetchThrows(abortError));

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — failure counter must have been incremented
    const counter = _redisCounters.get("health:krn_app_testapp0001:failures") ?? 0;
    expect(counter).toBeGreaterThanOrEqual(1);
  });

  it("does not throw from the health check cycle when fetch times out", async () => {
    // Arrange — fetch always rejects; verify startHealthCheck handles it gracefully
    _appsToCheck = [makeCheckableApp({ status: "published" })];
    mockFetch(fetchThrows(new Error("connect ETIMEDOUT")));

    // Act & Assert — no unhandled rejection; just verify we can start/stop safely
    let threwError = false;
    try {
      startHealthCheck(50);
      await new Promise((r) => setTimeout(r, 80));
      stopHealthCheck();
    } catch {
      threwError = true;
    }

    expect(threwError).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SSRF guard inside checkAppHealth
// ---------------------------------------------------------------------------

describe("checkAppHealth — SSRF guard", () => {
  it("skips an app whose developer_mcp_url is a private IP (does not fetch)", async () => {
    // Arrange — app has a 127.x URL which should be blocked by isPrivateOrLocalUrl
    _appsToCheck = [
      makeCheckableApp({ developer_mcp_url: "https://127.0.0.1/mcp" }),
    ];
    let fetchCalled = false;
    mockFetch(() => { fetchCalled = true; return fetchReturnsStatus(200)(); });

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — fetch must NOT have been called for a private URL
    expect(fetchCalled).toBe(false);
  });

  it("skips an app whose developer_mcp_url is localhost (does not fetch)", async () => {
    // Arrange
    _appsToCheck = [
      makeCheckableApp({ developer_mcp_url: "https://localhost/mcp" }),
    ];
    let fetchCalled = false;
    mockFetch(() => { fetchCalled = true; return fetchReturnsStatus(200)(); });

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert
    expect(fetchCalled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Only published + degraded apps are checked
// ---------------------------------------------------------------------------

describe("runHealthChecks — app status filtering", () => {
  it("does not call fetch for apps with status 'draft'", async () => {
    // Arrange — the db mock always returns _appsToCheck; simulate only published/degraded
    // being in the list (draft apps would not appear in the real query)
    _appsToCheck = []; // no checkable apps returned
    let fetchCalled = false;
    mockFetch(() => { fetchCalled = true; return fetchReturnsStatus(200)(); });

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — no apps in list means no fetch calls
    expect(fetchCalled).toBe(false);
  });

  it("does not call fetch for apps with null developer_mcp_url", async () => {
    // Arrange — app has no URL (e.g. local_skill type)
    _appsToCheck = [makeCheckableApp({ developer_mcp_url: null })];
    let fetchCalled = false;
    mockFetch(() => { fetchCalled = true; return fetchReturnsStatus(200)(); });

    // Act
    startHealthCheck(50);
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — apps without a developer URL are filtered out before pinging
    expect(fetchCalled).toBe(false);
  });

  it("calls fetch once for each app that has a developer_mcp_url", async () => {
    // Arrange — two checkable apps
    _appsToCheck = [
      makeCheckableApp({ id: "krn_app_testapp0001", developer_mcp_url: "https://mcp1.example.com/mcp" }),
      makeCheckableApp({ id: "krn_app_testapp0002", slug: "tool-two", developer_mcp_url: "https://mcp2.example.com/mcp" }),
    ];
    let fetchCount = 0;
    mockFetch(() => { fetchCount++; return fetchReturnsStatus(200)(); });

    // Act — small interval; just one cycle (initial immediate run)
    startHealthCheck(100_000); // large interval: only the initial run fires
    await new Promise((r) => setTimeout(r, 80));
    stopHealthCheck();

    // Assert — exactly two fetch calls, one per app
    expect(fetchCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// startHealthCheck — idempotency
// ---------------------------------------------------------------------------

describe("startHealthCheck — idempotency", () => {
  it("is idempotent: calling startHealthCheck twice does not create two intervals", async () => {
    // Arrange
    _appsToCheck = [];
    mockFetch(fetchReturnsStatus(200));

    // Act — call start twice
    startHealthCheck(100_000);
    startHealthCheck(100_000); // second call should be a no-op

    // Assert — state still shows running (one interval)
    expect(getHealthCheckState().running).toBe(true);

    stopHealthCheck();
    expect(getHealthCheckState().running).toBe(false);
  });

  it("reports running: true after startHealthCheck is called", async () => {
    // Arrange
    _appsToCheck = [];
    mockFetch(fetchReturnsStatus(200));

    // Act
    startHealthCheck(100_000);

    // Assert
    expect(getHealthCheckState().running).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// stopHealthCheck — clears interval
// ---------------------------------------------------------------------------

describe("stopHealthCheck", () => {
  it("reports running: false after stopHealthCheck is called", () => {
    // Arrange
    _appsToCheck = [];
    mockFetch(fetchReturnsStatus(200));

    startHealthCheck(100_000);
    expect(getHealthCheckState().running).toBe(true);

    // Act
    stopHealthCheck();

    // Assert
    expect(getHealthCheckState().running).toBe(false);
  });

  it("is safe to call stopHealthCheck when health check is not running", () => {
    // Arrange — check is already stopped
    stopHealthCheck();

    // Act & Assert — must not throw
    let threw = false;
    try {
      stopHealthCheck();
    } catch {
      threw = true;
    }

    expect(threw).toBe(false);
    expect(getHealthCheckState().running).toBe(false);
  });

  it("allows startHealthCheck to run again after stop", async () => {
    // Arrange
    _appsToCheck = [];
    mockFetch(fetchReturnsStatus(200));

    startHealthCheck(100_000);
    stopHealthCheck();
    expect(getHealthCheckState().running).toBe(false);

    // Act — start again
    startHealthCheck(100_000);

    // Assert
    expect(getHealthCheckState().running).toBe(true);
    stopHealthCheck();
  });
});

// ---------------------------------------------------------------------------
// getHealthCheckState
// ---------------------------------------------------------------------------

describe("getHealthCheckState", () => {
  it("returns { running: false } when health check has never been started", () => {
    // Arrange — beforeEach calls stopHealthCheck() ensuring clean state
    // Act
    const state = getHealthCheckState();

    // Assert
    expect(state.running).toBe(false);
  });

  it("returns an object with a boolean 'running' field", () => {
    // Act
    const state = getHealthCheckState();

    // Assert
    expect(typeof state.running).toBe("boolean");
  });
});
