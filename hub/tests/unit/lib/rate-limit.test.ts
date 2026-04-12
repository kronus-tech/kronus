// rate-limit.test.ts
//
// Unit tests for hub/src/lib/rate-limit.ts
//
// Redis is mocked with a simple in-memory implementation so no real Redis
// process is required.  mock.module() must be called BEFORE the static
// imports that pull in rate-limit.ts, because Bun resolves module mocks at
// import time.

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

import { describe, it, expect, beforeEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// In-memory Redis mock
// ---------------------------------------------------------------------------
//
// The fake tracks integer counters in a Map.  We expose the store so tests
// can inspect or reset it between runs.

interface FakeRedisStore {
  counters: Map<string, number>;
}

const _store: FakeRedisStore = { counters: new Map() };

const fakeRedis = {
  async incr(key: string): Promise<number> {
    const current = _store.counters.get(key) ?? 0;
    const next = current + 1;
    _store.counters.set(key, next);
    return next;
  },

  async expire(_key: string, _ttl: number): Promise<number> {
    // no-op — TTL tracking not required for these tests
    return 1;
  },

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => {
      const v = _store.counters.get(k);
      return v !== undefined ? String(v) : null;
    });
  },
};

// Inject mock before any module that calls getRedis() is imported
mock.module("../../../src/lib/redis.js", () => ({
  getRedis: () => fakeRedis,
  closeRedis: async () => {},
  isRedisReady: () => true,
}));

import { checkRateLimit, checkRelayRateLimit } from "../../../src/lib/rate-limit.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  _store.counters.clear();
}

// Return the current aligned window start for a given windowSecs so tests
// can predict what key the module will use.
function windowStart(windowSecs: number): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % windowSecs);
}

// ---------------------------------------------------------------------------
// Reset between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetStore();
});

// ---------------------------------------------------------------------------
// checkRateLimit
// ---------------------------------------------------------------------------

describe("checkRateLimit — within limit", () => {
  it("returns allowed: true for the first call", async () => {
    // Arrange
    const key = "test:user1";
    const limit = 5;
    const windowSecs = 60;

    // Act
    const result = await checkRateLimit(key, limit, windowSecs);

    // Assert
    expect(result.allowed).toBe(true);
  });

  it("returns allowed: true for all calls up to the limit", async () => {
    // Arrange
    const key = "test:user2";
    const limit = 3;
    const windowSecs = 60;
    let lastResult = { allowed: false, remaining: 0, resetAt: 0 };

    // Act — make exactly `limit` calls
    for (let i = 0; i < limit; i++) {
      lastResult = await checkRateLimit(key, limit, windowSecs);
    }

    // Assert — the final call at the limit boundary should still be allowed
    expect(lastResult.allowed).toBe(true);
  });

  it("returns correct remaining count after first call", async () => {
    // Arrange
    const key = "test:user3";
    const limit = 10;
    const windowSecs = 60;

    // Act
    const result = await checkRateLimit(key, limit, windowSecs);

    // Assert — 1 call consumed, 9 remaining
    expect(result.remaining).toBe(9);
  });

  it("remaining decrements on each successive call", async () => {
    // Arrange
    const key = "test:user4";
    const limit = 5;
    const windowSecs = 60;

    // Act
    const r1 = await checkRateLimit(key, limit, windowSecs);
    const r2 = await checkRateLimit(key, limit, windowSecs);
    const r3 = await checkRateLimit(key, limit, windowSecs);

    // Assert
    expect(r1.remaining).toBe(4);
    expect(r2.remaining).toBe(3);
    expect(r3.remaining).toBe(2);
  });

  it("remaining is 0 when the limit is exactly reached", async () => {
    // Arrange
    const key = "test:user5";
    const limit = 2;
    const windowSecs = 60;

    // Act
    await checkRateLimit(key, limit, windowSecs);
    const result = await checkRateLimit(key, limit, windowSecs);

    // Assert
    expect(result.remaining).toBe(0);
  });
});

describe("checkRateLimit — exceeding limit", () => {
  it("returns allowed: false when call count exceeds the limit", async () => {
    // Arrange
    const key = "test:blocked1";
    const limit = 2;
    const windowSecs = 60;

    // Consume the entire allowance
    await checkRateLimit(key, limit, windowSecs);
    await checkRateLimit(key, limit, windowSecs);

    // Act — one call over the limit
    const result = await checkRateLimit(key, limit, windowSecs);

    // Assert
    expect(result.allowed).toBe(false);
  });

  it("remaining is 0 when blocked (never negative)", async () => {
    // Arrange
    const key = "test:blocked2";
    const limit = 1;
    const windowSecs = 60;

    await checkRateLimit(key, limit, windowSecs); // consume

    // Act
    const result = await checkRateLimit(key, limit, windowSecs);

    // Assert
    expect(result.remaining).toBe(0);
  });
});

describe("checkRateLimit — resetAt", () => {
  it("returns resetAt in the future relative to now", async () => {
    // Arrange
    const key = "test:reset1";
    const limit = 10;
    const windowSecs = 60;
    const nowSecs = Math.floor(Date.now() / 1000);

    // Act
    const result = await checkRateLimit(key, limit, windowSecs);

    // Assert — resetAt must be after now
    expect(result.resetAt).toBeGreaterThan(nowSecs);
  });

  it("resetAt equals the next window boundary", async () => {
    // Arrange
    const key = "test:reset2";
    const windowSecs = 60;
    const now = Math.floor(Date.now() / 1000);
    const expectedReset = windowStart(windowSecs) + windowSecs;

    // Act
    const result = await checkRateLimit(key, 10, windowSecs);

    // Assert — allow ±1 s for execution time
    expect(Math.abs(result.resetAt - expectedReset)).toBeLessThanOrEqual(1);
  });

  it("resetAt is a positive Unix timestamp (seconds, not ms)", async () => {
    // Arrange
    const key = "test:reset3";

    // Act
    const result = await checkRateLimit(key, 5, 60);

    // Assert — Unix seconds since epoch in 2024+ is > 1_700_000_000
    expect(result.resetAt).toBeGreaterThan(1_700_000_000);
    // If it were milliseconds it would be > 1.7 trillion
    expect(result.resetAt).toBeLessThan(9_999_999_999);
  });
});

// ---------------------------------------------------------------------------
// checkRelayRateLimit — plan-aware relay limiter
// ---------------------------------------------------------------------------

describe("checkRelayRateLimit — free tier per-minute", () => {
  it("allows the first call for a free user", async () => {
    // Arrange
    const userId = "krn_usr_free001";

    // Act
    const result = await checkRelayRateLimit(userId, "free");

    // Assert
    expect(result.allowed).toBe(true);
  });

  it("blocks a free user after 10 calls in the same minute", async () => {
    // Arrange
    const userId = "krn_usr_free002";

    // Consume the 10-call per-minute allowance
    for (let i = 0; i < 10; i++) {
      await checkRelayRateLimit(userId, "free");
    }

    // Act — call #11 should be blocked
    const result = await checkRelayRateLimit(userId, "free");

    // Assert
    expect(result.allowed).toBe(false);
  });

  it("remaining decrements correctly for free tier minute window", async () => {
    // Arrange
    const userId = "krn_usr_free003";

    // Act — make 3 calls
    let lastResult = { allowed: false, remaining: 0, resetAt: 0 };
    for (let i = 0; i < 3; i++) {
      lastResult = await checkRelayRateLimit(userId, "free");
    }

    // Assert — 3 consumed out of 10 = 7 remaining
    expect(lastResult.remaining).toBe(7);
  });
});

describe("checkRelayRateLimit — free tier per-day", () => {
  it("blocks a free user after 100 calls in the same day window", async () => {
    // Arrange — pre-fill the minute bucket so minute check passes, then
    // pre-fill the day bucket up to the 100-call limit.
    //
    // We directly seed the in-memory store to avoid making 100 real calls
    // and triggering the minute limit first.
    const userId = "krn_usr_freeday";
    const now = Math.floor(Date.now() / 1000);

    // Put the per-minute counter at 1 (within 10/min limit)
    const minWindowStart = now - (now % 60);
    const minKey = `rl:relay:${userId}:min:${minWindowStart}`;
    _store.counters.set(minKey, 1);

    // Put the per-day counter AT the 100-call limit
    const dayWindowStart = now - (now % 86400);
    const dayKey = `rl:relay:${userId}:day:${dayWindowStart}`;
    _store.counters.set(dayKey, 100);

    // Act — next call should be blocked by the day limit
    const result = await checkRelayRateLimit(userId, "free");

    // Assert
    expect(result.allowed).toBe(false);
  });
});

describe("checkRelayRateLimit — pro tier", () => {
  it("allows more than 10 calls per minute for a pro user", async () => {
    // Arrange
    const userId = "krn_usr_pro001";

    // Act — make 15 calls (exceeds free tier but within pro 60/min)
    let lastResult = { allowed: true, remaining: 0, resetAt: 0 };
    for (let i = 0; i < 15; i++) {
      lastResult = await checkRelayRateLimit(userId, "pro");
    }

    // Assert — pro tier allows 60/min, so 15 should all pass
    expect(lastResult.allowed).toBe(true);
  });

  it("blocks a pro user after 60 calls in the same minute", async () => {
    // Arrange
    const userId = "krn_usr_pro002";

    for (let i = 0; i < 60; i++) {
      await checkRelayRateLimit(userId, "pro");
    }

    // Act
    const result = await checkRelayRateLimit(userId, "pro");

    // Assert
    expect(result.allowed).toBe(false);
  });

  it("does not share rate limit state between different userIds", async () => {
    // Arrange — exhaust user A's minute limit
    const userA = "krn_usr_pro003a";
    const userB = "krn_usr_pro003b";

    for (let i = 0; i < 60; i++) {
      await checkRelayRateLimit(userA, "pro");
    }

    // Act — user B should still have a full allowance
    const result = await checkRelayRateLimit(userB, "pro");

    // Assert
    expect(result.allowed).toBe(true);
  });
});

describe("checkRelayRateLimit — enterprise tier", () => {
  it("allows the first call for an enterprise user", async () => {
    // Arrange
    const userId = "krn_usr_ent001";

    // Act
    const result = await checkRelayRateLimit(userId, "enterprise");

    // Assert
    expect(result.allowed).toBe(true);
  });

  it("allows 60 calls per minute (more than pro) for enterprise", async () => {
    // Arrange
    const userId = "krn_usr_ent002";

    let lastResult = { allowed: true, remaining: 0, resetAt: 0 };
    for (let i = 0; i < 61; i++) {
      lastResult = await checkRelayRateLimit(userId, "enterprise");
    }

    // Assert — 61 calls is still within enterprise 300/min limit
    expect(lastResult.allowed).toBe(true);
  });
});
