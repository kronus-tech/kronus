// types.test.ts
//
// Unit tests for hub/src/relay/types.ts
// Pure logic — no database, Redis, or network needed.

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

import { describe, it, expect } from "bun:test";
import {
  getRateLimits,
  RATE_LIMITS,
  RelayCloseCode,
  type RelayMessage,
  type RelayResponse,
  type RelayError,
  type ConnectionInfo,
  type PlanTier,
  type RelayCloseCodeType,
} from "../../../src/relay/types.js";

// ---------------------------------------------------------------------------
// getRateLimits
// ---------------------------------------------------------------------------

describe("getRateLimits — free tier", () => {
  it("returns callsPerMin: 10 for free plan", () => {
    // Arrange / Act
    const limits = getRateLimits("free");

    // Assert
    expect(limits.callsPerMin).toBe(10);
  });

  it("returns callsPerDay: 100 for free plan", () => {
    // Arrange / Act
    const limits = getRateLimits("free");

    // Assert
    expect(limits.callsPerDay).toBe(100);
  });

  it("returns maxConnections: 1 for free plan", () => {
    // Arrange / Act
    const limits = getRateLimits("free");

    // Assert
    expect(limits.maxConnections).toBe(1);
  });
});

describe("getRateLimits — pro tier", () => {
  it("returns callsPerMin: 60 for pro plan", () => {
    // Arrange / Act
    const limits = getRateLimits("pro");

    // Assert
    expect(limits.callsPerMin).toBe(60);
  });

  it("returns callsPerDay: 5000 for pro plan", () => {
    // Arrange / Act
    const limits = getRateLimits("pro");

    // Assert
    expect(limits.callsPerDay).toBe(5000);
  });

  it("returns maxConnections: 5 for pro plan", () => {
    // Arrange / Act
    const limits = getRateLimits("pro");

    // Assert
    expect(limits.maxConnections).toBe(5);
  });
});

describe("getRateLimits — enterprise tier", () => {
  it("returns callsPerMin: 300 for enterprise plan", () => {
    // Arrange / Act
    const limits = getRateLimits("enterprise");

    // Assert
    expect(limits.callsPerMin).toBe(300);
  });

  it("returns callsPerDay: 50000 for enterprise plan", () => {
    // Arrange / Act
    const limits = getRateLimits("enterprise");

    // Assert
    expect(limits.callsPerDay).toBe(50000);
  });

  it("returns maxConnections: 20 for enterprise plan", () => {
    // Arrange / Act
    const limits = getRateLimits("enterprise");

    // Assert
    expect(limits.maxConnections).toBe(20);
  });
});

describe("getRateLimits — unknown / fallback", () => {
  it("falls back to free limits for an unknown plan string", () => {
    // Arrange / Act
    const limits = getRateLimits("unknown_plan");

    // Assert — should match free tier exactly
    expect(limits).toEqual(RATE_LIMITS.free);
  });

  it("falls back to free limits for an empty string", () => {
    // Arrange / Act
    const limits = getRateLimits("");

    // Assert
    expect(limits).toEqual(RATE_LIMITS.free);
  });

  it("falls back to free limits for a numeric-looking string", () => {
    // Arrange / Act
    const limits = getRateLimits("9999");

    // Assert
    expect(limits).toEqual(RATE_LIMITS.free);
  });
});

// ---------------------------------------------------------------------------
// RelayCloseCode
// ---------------------------------------------------------------------------

describe("RelayCloseCode — values", () => {
  it("AUTH_FAILED is 4001", () => {
    expect(RelayCloseCode.AUTH_FAILED).toBe(4001);
  });

  it("RATE_LIMITED is 4002", () => {
    expect(RelayCloseCode.RATE_LIMITED).toBe(4002);
  });

  it("INVALID_MESSAGE is 4003", () => {
    expect(RelayCloseCode.INVALID_MESSAGE).toBe(4003);
  });

  it("INTERNAL_ERROR is 4004", () => {
    expect(RelayCloseCode.INTERNAL_ERROR).toBe(4004);
  });

  it("CONNECTION_LIMIT is 4005", () => {
    expect(RelayCloseCode.CONNECTION_LIMIT).toBe(4005);
  });

  it("all close codes are in the 4xxx range", () => {
    // Arrange
    const codes = Object.values(RelayCloseCode);

    // Act / Assert
    for (const code of codes) {
      expect(code).toBeGreaterThanOrEqual(4000);
      expect(code).toBeLessThan(5000);
    }
  });

  it("all close code values are distinct", () => {
    // Arrange
    const codes = Object.values(RelayCloseCode);

    // Act
    const unique = new Set(codes);

    // Assert — no duplicates
    expect(unique.size).toBe(codes.length);
  });
});

// ---------------------------------------------------------------------------
// RATE_LIMITS constant — direct shape verification
// ---------------------------------------------------------------------------

describe("RATE_LIMITS constant", () => {
  it("has free, pro, and enterprise keys", () => {
    expect("free" in RATE_LIMITS).toBe(true);
    expect("pro" in RATE_LIMITS).toBe(true);
    expect("enterprise" in RATE_LIMITS).toBe(true);
  });

  it("pro limits are strictly greater than free limits", () => {
    expect(RATE_LIMITS.pro.callsPerMin).toBeGreaterThan(RATE_LIMITS.free.callsPerMin);
    expect(RATE_LIMITS.pro.callsPerDay).toBeGreaterThan(RATE_LIMITS.free.callsPerDay);
    expect(RATE_LIMITS.pro.maxConnections).toBeGreaterThan(RATE_LIMITS.free.maxConnections);
  });

  it("enterprise limits are strictly greater than pro limits", () => {
    expect(RATE_LIMITS.enterprise.callsPerMin).toBeGreaterThan(RATE_LIMITS.pro.callsPerMin);
    expect(RATE_LIMITS.enterprise.callsPerDay).toBeGreaterThan(RATE_LIMITS.pro.callsPerDay);
    expect(RATE_LIMITS.enterprise.maxConnections).toBeGreaterThan(RATE_LIMITS.pro.maxConnections);
  });
});

// ---------------------------------------------------------------------------
// Type shape validation (compile-time; runtime shape smoke tests)
// ---------------------------------------------------------------------------

describe("exported type shapes — runtime smoke tests", () => {
  it("RelayMessage type accepts valid shape", () => {
    // Arrange — should type-check and construct cleanly
    const msg: RelayMessage = {
      target: "krn_inst_abc123",
      payload: { jsonrpc: "2.0", method: "tools/list", id: 1 },
      request_id: "req-001",
    };

    // Assert
    expect(msg.target).toBe("krn_inst_abc123");
    expect(msg.request_id).toBe("req-001");
  });

  it("RelayMessage request_id is optional", () => {
    // Arrange
    const msg: RelayMessage = {
      target: "krn_inst_abc123",
      payload: { jsonrpc: "2.0", method: "tools/list", id: 1 },
    };

    // Assert
    expect(msg.request_id).toBeUndefined();
  });

  it("RelayResponse type accepts valid shape", () => {
    // Arrange
    const resp: RelayResponse = {
      source: "krn_inst_sender",
      payload: { result: [] },
      request_id: "req-001",
    };

    // Assert
    expect(resp.source).toBe("krn_inst_sender");
  });

  it("RelayError type accepts valid shape", () => {
    // Arrange
    const err: RelayError = {
      error: { code: "RATE_LIMITED", message: "Too many requests" },
      request_id: "req-001",
    };

    // Assert
    expect(err.error.code).toBe("RATE_LIMITED");
    expect(err.error.message).toBe("Too many requests");
  });

  it("ConnectionInfo type accepts valid shape", () => {
    // Arrange
    const info: ConnectionInfo = {
      instanceId: "krn_inst_test001",
      userId: "krn_usr_user001",
      plan: "pro",
      connectedAt: new Date(),
    };

    // Assert
    expect(info.instanceId).toBe("krn_inst_test001");
    expect(info.connectedAt).toBeInstanceOf(Date);
  });
});
