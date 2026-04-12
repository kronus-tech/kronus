/**
 * Unit tests for connect/src/heartbeat.ts
 *
 * Strategy:
 * - Mock identity, token-manager, and app-manager modules via mock.module
 *   before any imports so heartbeat.ts receives the mocked dependencies
 * - Mock globalThis.fetch for all HTTP calls
 * - Use fake timers (Bun's mock.timers is not available, so we pass a very
 *   short intervalMs and await a real tick) to trigger the interval callback
 * - Always stopHeartbeat() in afterEach to prevent interval leakage between tests
 *
 * NOTE: VERSION is imported from ../../src/index.js inside heartbeat.ts, but
 * that re-export chain (index → heartbeat) could cause a circular import.
 * heartbeat.ts imports VERSION directly from "./index.js" — we do NOT mock
 * that module so the real VERSION string ("5.3.0-dev") is used in assertions
 * where the heartbeat body is checked.
 */

process.env["DATABASE_URL"] = process.env["DATABASE_URL"] ?? "x";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "x";

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// ── Shared mock state ─────────────────────────────────────────────────────────

let _mockIdentity: Record<string, unknown> | null = {
  hub_url: "http://hub.test",
  instance_id: "krn_inst_test",
};
let _mockToken = "test-token";
let _mockInstalledApps: Array<{ slug: string }> = [];

// mock.module declarations must come before the await import below so the
// module system substitutes the mocks when heartbeat.ts is evaluated.
mock.module("../../src/identity.js", () => ({
  loadIdentity: () => Promise.resolve(_mockIdentity),
  saveIdentity: () => Promise.resolve(),
  deleteIdentity: () => Promise.resolve(),
  generateIdentityKeypair: () => Promise.resolve({ publicKey: "{}", privateKey: "{}" }),
  getMachineFingerprint: () => "test-machine",
  getKronusDir: () => "/tmp/kronus-test-hb",
  getIdentityPath: () => "/tmp/kronus-test-hb/identity.json",
}));

mock.module("../../src/token-manager.js", () => ({
  getAccessToken: () => Promise.resolve(_mockToken),
  refreshAccessToken: () => Promise.resolve(_mockToken),
  onTokenRefreshed: () => {},
}));

mock.module("../../src/app-manager.js", () => ({
  listInstalledApps: () => Promise.resolve(_mockInstalledApps),
  installApp: mock(),
  uninstallApp: mock(),
  updateApps: mock(),
}));

mock.module("../../src/relay-client.js", () => ({
  RelayClient: class {},
}));

// Import after mocks are in place
const { startHeartbeat, stopHeartbeat, isHeartbeatRunning } = await import(
  "../../src/heartbeat.js"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Waits for the next microtask/macrotask cycle, giving the interval callback
 * a chance to fire when using a very short interval.
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let originalFetch: typeof globalThis.fetch;

// ── Per-test setup / teardown ─────────────────────────────────────────────────

beforeEach(() => {
  originalFetch = globalThis.fetch;
  _mockIdentity = { hub_url: "http://hub.test", instance_id: "krn_inst_test" };
  _mockToken = "test-token";
  _mockInstalledApps = [];

  // Ensure no interval is running before each test
  stopHeartbeat();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  // Always clean up any interval started during the test
  stopHeartbeat();
});

// ── isHeartbeatRunning ────────────────────────────────────────────────────────

describe("isHeartbeatRunning", () => {
  test("returns false when no heartbeat has been started", () => {
    // Arrange — stopHeartbeat() called in beforeEach

    // Act + Assert
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("returns true after startHeartbeat is called", () => {
    // Arrange
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );

    // Act
    startHeartbeat(60_000);

    // Assert
    expect(isHeartbeatRunning()).toBe(true);
  });

  test("returns false after stopHeartbeat is called", () => {
    // Arrange
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );
    startHeartbeat(60_000);
    expect(isHeartbeatRunning()).toBe(true);

    // Act
    stopHeartbeat();

    // Assert
    expect(isHeartbeatRunning()).toBe(false);
  });
});

// ── startHeartbeat ────────────────────────────────────────────────────────────

describe("startHeartbeat", () => {
  test("is idempotent — calling twice does not create two intervals", async () => {
    // Arrange — count fetch calls to detect double-fire
    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act — start twice with a very short interval
    startHeartbeat(30);
    startHeartbeat(30); // second call must be a no-op

    await wait(80); // enough time for 2 ticks if there were two intervals

    stopHeartbeat();

    // Assert — at most 2 ticks from a single interval (not 4 from two)
    expect(fetchCallCount).toBeLessThanOrEqual(2);
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("does not start a new interval when already running", () => {
    // Arrange
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );
    startHeartbeat(60_000);

    // Act — call again
    startHeartbeat(60_000);

    // Assert — still running (single interval), no error thrown
    expect(isHeartbeatRunning()).toBe(true);
  });
});

// ── stopHeartbeat ─────────────────────────────────────────────────────────────

describe("stopHeartbeat", () => {
  test("clears the interval so no more fetch calls are made", async () => {
    // Arrange
    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    startHeartbeat(20);
    await wait(25); // let at least one tick fire
    stopHeartbeat();
    const countAfterStop = fetchCallCount;

    // Wait another interval period and confirm no additional calls
    await wait(30);

    // Assert — no new calls after stop
    expect(fetchCallCount).toBe(countAfterStop);
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("is safe to call when no heartbeat is running", () => {
    // Arrange — already stopped in beforeEach

    // Act + Assert — should not throw
    expect(() => stopHeartbeat()).not.toThrow();
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("is safe to call multiple times in a row", () => {
    // Arrange
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );
    startHeartbeat(60_000);

    // Act
    stopHeartbeat();
    stopHeartbeat(); // second call should be a no-op

    // Assert
    expect(isHeartbeatRunning()).toBe(false);
  });
});

// ── sendHeartbeat (via interval tick) ────────────────────────────────────────

describe("sendHeartbeat (triggered by interval)", () => {
  test("calls POST /instances/heartbeat on the Hub URL", async () => {
    // Arrange
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = mock((input: string | Request | URL, init?: RequestInit) => {
      capturedUrl =
        typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : input.toString();
      capturedInit = init;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act — start with a very short interval and wait for one tick
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert
    expect(capturedUrl).toBe("http://hub.test/instances/heartbeat");
    expect(capturedInit?.method).toBe("POST");
  });

  test("sends Authorization header with Bearer token", async () => {
    // Arrange
    _mockToken = "hb-bearer-token";
    let capturedHeaders: Record<string, string> | undefined;

    globalThis.fetch = mock((_input: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert
    expect(capturedHeaders?.["Authorization"]).toBe("Bearer hb-bearer-token");
  });

  test("sends Content-Type application/json header", async () => {
    // Arrange
    let capturedHeaders: Record<string, string> | undefined;

    globalThis.fetch = mock((_input: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert
    expect(capturedHeaders?.["Content-Type"]).toBe("application/json");
  });

  test("sends installed_apps as array of slugs in request body", async () => {
    // Arrange
    _mockInstalledApps = [{ slug: "tool-alpha" }, { slug: "tool-beta" }];
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock((_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert
    expect(capturedBody?.["installed_apps"]).toEqual(["tool-alpha", "tool-beta"]);
  });

  test("sends kronus_version in request body", async () => {
    // Arrange
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock((_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert — kronus_version must be present and be a non-empty string
    expect(typeof capturedBody?.["kronus_version"]).toBe("string");
    expect((capturedBody?.["kronus_version"] as string).length).toBeGreaterThan(0);
  });

  test("sends empty installed_apps array when no apps are installed", async () => {
    // Arrange — _mockInstalledApps is [] by default from beforeEach
    let capturedBody: Record<string, unknown> | undefined;

    globalThis.fetch = mock((_input: unknown, init?: RequestInit) => {
      capturedBody = JSON.parse(init?.body as string) as Record<string, unknown>;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert
    expect(capturedBody?.["installed_apps"]).toEqual([]);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe("Heartbeat error handling", () => {
  test("gracefully handles fetch network errors without unhandled rejection", async () => {
    // Arrange — fetch rejects with a network error
    globalThis.fetch = mock(() =>
      Promise.reject(new Error("Network timeout"))
    );

    // Act — if the error is not caught, bun:test will fail with unhandled rejection
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert — reaching here means the error was swallowed gracefully
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("gracefully handles non-200 Hub response without unhandled rejection", async () => {
    // Arrange — Hub returns 503
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Service Unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        })
      )
    );

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert — interval completed cleanly
    expect(isHeartbeatRunning()).toBe(false);
  });

  test("gracefully handles 401 response without crashing", async () => {
    // Arrange
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
      )
    );

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert
    expect(isHeartbeatRunning()).toBe(false);
  });
});

// ── Identity guard ────────────────────────────────────────────────────────────

describe("Heartbeat identity guard", () => {
  test("skips fetch entirely when identity is null (not connected)", async () => {
    // Arrange
    _mockIdentity = null;
    let fetchCalled = false;
    globalThis.fetch = mock(() => {
      fetchCalled = true;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    // Act
    startHeartbeat(20);
    await wait(40);
    stopHeartbeat();

    // Assert — fetch was never called because identity check returns early
    expect(fetchCalled).toBe(false);
  });

  test("resumes fetching when identity becomes available on next tick", async () => {
    // Arrange — start with no identity
    _mockIdentity = null;
    let fetchCallCount = 0;
    globalThis.fetch = mock(() => {
      fetchCallCount++;
      return Promise.resolve(new Response(null, { status: 200 }));
    });

    startHeartbeat(30);
    await wait(20); // first tick fires with null identity — no fetch
    expect(fetchCallCount).toBe(0);

    // Identity becomes available
    _mockIdentity = { hub_url: "http://hub.test", instance_id: "krn_inst_test" };

    await wait(50); // second tick fires with identity — fetch should run

    stopHeartbeat();

    // Assert — at least one fetch happened after identity was set
    expect(fetchCallCount).toBeGreaterThanOrEqual(1);
  });
});
