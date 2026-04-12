// connections.test.ts
//
// Unit tests for hub/src/relay/connections.ts
// No real WebSocket needed — ServerWebSocket is mocked as a plain object
// with send() and close() methods.

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

import { describe, it, expect, beforeEach, mock } from "bun:test";
import {
  registerConnection,
  unregisterConnection,
  getConnection,
  getConnectionCount,
  getConnectionsByUserId,
  clearConnections,
} from "../../../src/relay/connections.js";
import type { ConnectionInfo } from "../../../src/relay/types.js";

// ---------------------------------------------------------------------------
// Mock ServerWebSocket factory
// A minimal stand-in — only send() and close() are exercised by the module.
// ---------------------------------------------------------------------------

function makeMockWs(overrides?: Partial<{ send: () => void; close: () => void }>) {
  return {
    send: mock(() => {}),
    close: mock(() => {}),
    data: {} as ConnectionInfo,
    // Bun's ServerWebSocket surface we never call in connections.ts:
    subscribe: mock(() => {}),
    unsubscribe: mock(() => {}),
    publish: mock(() => {}),
    ping: mock(() => {}),
    pong: mock(() => {}),
    readyState: 1,
    binaryType: "nodebuffer",
    remoteAddress: "127.0.0.1",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const USER_A = "krn_usr_alpha0001";
const USER_B = "krn_usr_bravo0002";

function makeInfo(
  instanceId: string,
  userId: string,
  plan: "free" | "pro" | "enterprise" = "free"
): ConnectionInfo {
  return { instanceId, userId, plan, connectedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Reset registry before every test
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearConnections();
});

// ---------------------------------------------------------------------------
// registerConnection / getConnection
// ---------------------------------------------------------------------------

describe("registerConnection", () => {
  it("returns true when connection is successfully registered", () => {
    // Arrange
    const ws = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A, "free");

    // Act
    const result = registerConnection("krn_inst_001", ws as never, info);

    // Assert
    expect(result).toBe(true);
  });

  it("getConnection returns the registered connection", () => {
    // Arrange
    const ws = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A, "free");
    registerConnection("krn_inst_001", ws as never, info);

    // Act
    const conn = getConnection("krn_inst_001");

    // Assert
    expect(conn).toBeDefined();
    expect(conn!.info.instanceId).toBe("krn_inst_001");
    expect(conn!.info.userId).toBe(USER_A);
  });

  it("stores the ws reference in the returned connection", () => {
    // Arrange
    const ws = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A);
    registerConnection("krn_inst_001", ws as never, info);

    // Act
    const conn = getConnection("krn_inst_001");

    // Assert
    expect(conn!.ws).toBe(ws);
  });

  it("increments getConnectionCount after registration", () => {
    // Arrange
    const ws = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A);

    // Act
    registerConnection("krn_inst_001", ws as never, info);

    // Assert
    expect(getConnectionCount()).toBe(1);
  });

  it("replaces an existing connection for the same instanceId", () => {
    // Arrange
    const oldWs = makeMockWs();
    const newWs = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A);

    registerConnection("krn_inst_001", oldWs as never, info);

    // Act — re-register same instanceId
    registerConnection("krn_inst_001", newWs as never, info);

    // Assert — registry now has the new ws
    const conn = getConnection("krn_inst_001");
    expect(conn!.ws).toBe(newWs);
  });

  it("calls close() on the old WebSocket when replacing a connection", () => {
    // Arrange
    const oldWs = makeMockWs();
    const newWs = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A);

    registerConnection("krn_inst_001", oldWs as never, info);

    // Act
    registerConnection("krn_inst_001", newWs as never, info);

    // Assert — old socket should have been closed
    expect(oldWs.close).toHaveBeenCalledTimes(1);
  });

  it("does not close the new WebSocket when replacing", () => {
    // Arrange
    const oldWs = makeMockWs();
    const newWs = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A);

    registerConnection("krn_inst_001", oldWs as never, info);

    // Act
    registerConnection("krn_inst_001", newWs as never, info);

    // Assert
    expect(newWs.close).not.toHaveBeenCalled();
  });

  it("connection count does not grow when replacing (still 1)", () => {
    // Arrange
    const oldWs = makeMockWs();
    const newWs = makeMockWs();
    const info = makeInfo("krn_inst_001", USER_A);

    registerConnection("krn_inst_001", oldWs as never, info);

    // Act
    registerConnection("krn_inst_001", newWs as never, info);

    // Assert
    expect(getConnectionCount()).toBe(1);
  });

  it("returns false when user exceeds free plan connection limit (max 1)", () => {
    // Arrange — free plan allows 1 connection
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    const info1 = makeInfo("krn_inst_001", USER_A, "free");
    const info2 = makeInfo("krn_inst_002", USER_A, "free"); // same user, different instance

    registerConnection("krn_inst_001", ws1 as never, info1);

    // Act — second connection for same user should be rejected
    const result = registerConnection("krn_inst_002", ws2 as never, info2);

    // Assert
    expect(result).toBe(false);
  });

  it("does not add the connection to the registry when limit is exceeded", () => {
    // Arrange
    const ws1 = makeMockWs();
    const ws2 = makeMockWs();
    registerConnection("krn_inst_001", ws1 as never, makeInfo("krn_inst_001", USER_A, "free"));

    // Act
    registerConnection("krn_inst_002", ws2 as never, makeInfo("krn_inst_002", USER_A, "free"));

    // Assert — count stays at 1
    expect(getConnectionCount()).toBe(1);
    expect(getConnection("krn_inst_002")).toBeUndefined();
  });

  it("allows pro user to register up to 5 connections", () => {
    // Arrange — pro plan allows 5 connections
    const results: boolean[] = [];

    for (let i = 1; i <= 5; i++) {
      const ws = makeMockWs();
      const result = registerConnection(
        `krn_inst_p0${i}`,
        ws as never,
        makeInfo(`krn_inst_p0${i}`, USER_A, "pro")
      );
      results.push(result);
    }

    // Assert — all 5 succeed
    expect(results.every((r) => r === true)).toBe(true);
    expect(getConnectionCount()).toBe(5);
  });

  it("blocks a 6th connection for a pro user", () => {
    // Arrange
    for (let i = 1; i <= 5; i++) {
      registerConnection(
        `krn_inst_p0${i}`,
        makeMockWs() as never,
        makeInfo(`krn_inst_p0${i}`, USER_A, "pro")
      );
    }

    // Act
    const result = registerConnection(
      "krn_inst_p06",
      makeMockWs() as never,
      makeInfo("krn_inst_p06", USER_A, "pro")
    );

    // Assert
    expect(result).toBe(false);
  });

  it("allows different users to each hold a connection on free plan", () => {
    // Arrange
    const wsA = makeMockWs();
    const wsB = makeMockWs();

    // Act
    const resultA = registerConnection("krn_inst_001", wsA as never, makeInfo("krn_inst_001", USER_A, "free"));
    const resultB = registerConnection("krn_inst_002", wsB as never, makeInfo("krn_inst_002", USER_B, "free"));

    // Assert — separate users are independent
    expect(resultA).toBe(true);
    expect(resultB).toBe(true);
    expect(getConnectionCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// unregisterConnection
// ---------------------------------------------------------------------------

describe("unregisterConnection", () => {
  it("removes the connection from the registry", () => {
    // Arrange
    const ws = makeMockWs();
    registerConnection("krn_inst_001", ws as never, makeInfo("krn_inst_001", USER_A));

    // Act
    unregisterConnection("krn_inst_001");

    // Assert
    expect(getConnection("krn_inst_001")).toBeUndefined();
  });

  it("decrements getConnectionCount after removal", () => {
    // Arrange
    const ws = makeMockWs();
    registerConnection("krn_inst_001", ws as never, makeInfo("krn_inst_001", USER_A));

    // Act
    unregisterConnection("krn_inst_001");

    // Assert
    expect(getConnectionCount()).toBe(0);
  });

  it("is a no-op for an instanceId that was never registered", () => {
    // Arrange — registry is empty (cleared in beforeEach)

    // Act — should not throw
    expect(() => unregisterConnection("krn_inst_nonexistent")).not.toThrow();
  });

  it("does not affect other connections when removing one", () => {
    // Arrange
    registerConnection("krn_inst_001", makeMockWs() as never, makeInfo("krn_inst_001", USER_A));
    registerConnection("krn_inst_002", makeMockWs() as never, makeInfo("krn_inst_002", USER_B));

    // Act
    unregisterConnection("krn_inst_001");

    // Assert
    expect(getConnection("krn_inst_002")).toBeDefined();
    expect(getConnectionCount()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getConnection
// ---------------------------------------------------------------------------

describe("getConnection", () => {
  it("returns undefined for an unknown instanceId", () => {
    // Act
    const conn = getConnection("krn_inst_does_not_exist");

    // Assert
    expect(conn).toBeUndefined();
  });

  it("returns undefined after the connection has been unregistered", () => {
    // Arrange
    registerConnection("krn_inst_001", makeMockWs() as never, makeInfo("krn_inst_001", USER_A));
    unregisterConnection("krn_inst_001");

    // Act
    const conn = getConnection("krn_inst_001");

    // Assert
    expect(conn).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getConnectionCount
// ---------------------------------------------------------------------------

describe("getConnectionCount", () => {
  it("returns 0 when registry is empty", () => {
    // Act / Assert
    expect(getConnectionCount()).toBe(0);
  });

  it("returns correct count as connections are added", () => {
    // Act / Assert
    registerConnection("krn_inst_001", makeMockWs() as never, makeInfo("krn_inst_001", USER_A, "pro"));
    expect(getConnectionCount()).toBe(1);

    registerConnection("krn_inst_002", makeMockWs() as never, makeInfo("krn_inst_002", USER_B, "pro"));
    expect(getConnectionCount()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// getConnectionsByUserId
// ---------------------------------------------------------------------------

describe("getConnectionsByUserId", () => {
  it("returns empty array when no connections exist for the user", () => {
    // Act
    const conns = getConnectionsByUserId(USER_A);

    // Assert
    expect(conns).toEqual([]);
  });

  it("returns all connections belonging to the given user", () => {
    // Arrange — user A has 2 connections (pro), user B has 1
    registerConnection("krn_inst_a1", makeMockWs() as never, makeInfo("krn_inst_a1", USER_A, "pro"));
    registerConnection("krn_inst_a2", makeMockWs() as never, makeInfo("krn_inst_a2", USER_A, "pro"));
    registerConnection("krn_inst_b1", makeMockWs() as never, makeInfo("krn_inst_b1", USER_B, "free"));

    // Act
    const conns = getConnectionsByUserId(USER_A);

    // Assert
    expect(conns.length).toBe(2);
    expect(conns.every((c) => c.info.userId === USER_A)).toBe(true);
  });

  it("does not include connections for other users", () => {
    // Arrange
    registerConnection("krn_inst_a1", makeMockWs() as never, makeInfo("krn_inst_a1", USER_A, "pro"));
    registerConnection("krn_inst_b1", makeMockWs() as never, makeInfo("krn_inst_b1", USER_B, "free"));

    // Act
    const conns = getConnectionsByUserId(USER_A);

    // Assert
    expect(conns.some((c) => c.info.userId === USER_B)).toBe(false);
  });

  it("returns empty array after the user's connection is unregistered", () => {
    // Arrange
    registerConnection("krn_inst_001", makeMockWs() as never, makeInfo("krn_inst_001", USER_A, "free"));
    unregisterConnection("krn_inst_001");

    // Act
    const conns = getConnectionsByUserId(USER_A);

    // Assert
    expect(conns).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// clearConnections
// ---------------------------------------------------------------------------

describe("clearConnections", () => {
  it("empties the registry", () => {
    // Arrange
    registerConnection("krn_inst_001", makeMockWs() as never, makeInfo("krn_inst_001", USER_A, "pro"));
    registerConnection("krn_inst_002", makeMockWs() as never, makeInfo("krn_inst_002", USER_B, "pro"));

    // Act
    clearConnections();

    // Assert
    expect(getConnectionCount()).toBe(0);
  });

  it("makes getConnection return undefined for all previously registered instances", () => {
    // Arrange
    registerConnection("krn_inst_001", makeMockWs() as never, makeInfo("krn_inst_001", USER_A));

    // Act
    clearConnections();

    // Assert
    expect(getConnection("krn_inst_001")).toBeUndefined();
  });

  it("is safe to call on an already-empty registry", () => {
    // Act / Assert — should not throw
    expect(() => clearConnections()).not.toThrow();
  });

  it("allows new registrations after clearing", () => {
    // Arrange
    registerConnection("krn_inst_001", makeMockWs() as never, makeInfo("krn_inst_001", USER_A, "free"));
    clearConnections();

    // Act — re-register same instanceId after clear
    const result = registerConnection(
      "krn_inst_001",
      makeMockWs() as never,
      makeInfo("krn_inst_001", USER_A, "free")
    );

    // Assert
    expect(result).toBe(true);
    expect(getConnectionCount()).toBe(1);
  });
});
