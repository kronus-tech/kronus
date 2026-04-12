/**
 * Unit tests for connect/src/relay-client.ts
 *
 * Strategy:
 * - Spin up a real Bun WebSocket server on a random port in beforeAll
 * - The mock server echoes messages back with their request_id so sendRequest resolves
 * - RelayClient uses the `ws` npm package which connects to any WS server
 * - hubUrl is set to http://localhost:<port> — RelayClient internally rewrites to
 *   ws://localhost:<port>/relay/connect?token=... and the mock server upgrades any path
 * - Each test gets a fresh RelayClient instance
 */

import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import type { ServerWebSocket } from "bun";
import { RelayClient } from "../../src/relay-client.js";

// ── Mock WS server ────────────────────────────────────────────────────────────

let mockServerPort: number;
let mockServer: ReturnType<typeof Bun.serve>;
let lastReceivedMessage: string | null = null;
let serverConnections: ServerWebSocket<unknown>[] = [];

// Allows individual tests to override message handling
let messageOverride:
  | ((ws: ServerWebSocket<unknown>, msg: string) => void)
  | null = null;

beforeAll(() => {
  mockServer = Bun.serve({
    port: 0, // random available port
    fetch(req, server) {
      if (server.upgrade(req, { data: {} })) {
        return undefined as unknown as Response;
      }
      return new Response("Not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        serverConnections.push(ws);
      },
      message(ws, msg) {
        const text = msg.toString();
        lastReceivedMessage = text;

        if (messageOverride) {
          messageOverride(ws, text);
          return;
        }

        // Default: echo back as RelayResponse with matching request_id
        try {
          const parsed = JSON.parse(text) as {
            target: string;
            payload: unknown;
            request_id?: string;
          };
          ws.send(
            JSON.stringify({
              source: "krn_inst_mock",
              payload: { echo: true, ...(parsed.payload as object) },
              request_id: parsed.request_id,
            })
          );
        } catch {
          // Ignore unparseable messages in mock
        }
      },
      close(ws) {
        serverConnections = serverConnections.filter((c) => c !== ws);
      },
    },
  });

  mockServerPort = mockServer.port;
});

afterAll(() => {
  mockServer.stop();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function hubUrl(): string {
  return `http://localhost:${mockServerPort}`;
}

/** Wait for client to reach a specific state, with a timeout. */
async function waitForState(
  client: RelayClient,
  state: string,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  while (client.getState() !== state) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for state "${state}", current: "${client.getState()}"`
      );
    }
    await Bun.sleep(20);
  }
}

/** Wait for an event to fire once on the client. */
function waitForEvent<K extends "connected" | "disconnected" | "message" | "error" | "reconnecting">(
  client: RelayClient,
  event: K,
  timeoutMs = 2000
): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for event "${event}"`));
    }, timeoutMs);

    const handler = (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args);
    };

    // @ts-expect-error — variadic callback
    client.on(event, handler);
  });
}

// ── Per-test setup ────────────────────────────────────────────────────────────

let client: RelayClient;

beforeEach(() => {
  client = new RelayClient();
  lastReceivedMessage = null;
  messageOverride = null;
});

afterEach(async () => {
  // Ensure clean disconnect even if the test failed mid-way
  if (client.getState() !== "disconnected") {
    client.disconnect();
    await Bun.sleep(50);
  }
});

// ── State tests ───────────────────────────────────────────────────────────────

describe("initial state", () => {
  test("starts in disconnected state", () => {
    expect(client.getState()).toBe("disconnected");
  });
});

describe("connect()", () => {
  test("transitions to connected state after successful handshake", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");
    expect(client.getState()).toBe("connected");
  });

  test("emits connected event when handshake completes", async () => {
    const eventPromise = waitForEvent(client, "connected");
    client.connect(hubUrl(), "test_token");
    await eventPromise;
    expect(client.getState()).toBe("connected");
  });

  test("getState() returns connecting transiently before connected", async () => {
    // State should be connecting immediately after connect() call,
    // before the async handshake resolves
    client.connect(hubUrl(), "test_token");
    // At this exact moment the WebSocket is being established
    expect(client.getState()).toBe("connecting");
    await waitForState(client, "connected");
  });
});

// ── send() ────────────────────────────────────────────────────────────────────

describe("send()", () => {
  test("delivers message to server", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    client.send("krn_inst_target", { hello: "world" });

    // Give the server a moment to receive
    await Bun.sleep(50);

    expect(lastReceivedMessage).not.toBeNull();
    const parsed = JSON.parse(lastReceivedMessage!);
    expect(parsed.target).toBe("krn_inst_target");
    expect(parsed.payload).toEqual({ hello: "world" });
  });

  test("includes a custom requestId when provided", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    client.send("krn_inst_target", { foo: "bar" }, "custom-req-id");

    await Bun.sleep(50);

    const parsed = JSON.parse(lastReceivedMessage!);
    expect(parsed.request_id).toBe("custom-req-id");
  });

  test("throws when not connected", () => {
    expect(() => client.send("krn_inst_target", {})).toThrow(
      "Not connected to relay"
    );
  });
});

// ── sendRequest() ─────────────────────────────────────────────────────────────

describe("sendRequest()", () => {
  test("resolves with response when server echoes back matching request_id", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    const response = await client.sendRequest("krn_inst_target", {
      action: "ping",
    });

    expect(response.source).toBe("krn_inst_mock");
    expect((response.payload as { echo: boolean }).echo).toBe(true);
  });

  test("resolves with correct payload from echo", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    const response = await client.sendRequest("krn_inst_target", {
      key: "value",
    });

    expect((response.payload as { key: string }).key).toBe("value");
  });

  test("rejects after timeout when server does not respond", async () => {
    // Override server to swallow the message without responding
    messageOverride = () => {
      // silence — do not echo
    };

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    await expect(
      client.sendRequest("krn_inst_target", {}, 100 /* 100ms timeout */)
    ).rejects.toThrow("Request timed out after 100ms");
  });

  test("rejects immediately if not connected", async () => {
    await expect(
      client.sendRequest("krn_inst_target", {})
    ).rejects.toThrow("Not connected to relay");
  });

  test("handles relay error frame — rejects pending request", async () => {
    // Override server to send back an error frame
    messageOverride = (ws, msg) => {
      const parsed = JSON.parse(msg) as { request_id?: string };
      ws.send(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: "Target not registered" },
          request_id: parsed.request_id,
        })
      );
    };

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    await expect(
      client.sendRequest("krn_inst_target", {}, 2000)
    ).rejects.toThrow("Relay error: NOT_FOUND — Target not registered");
  });
});

// ── disconnect() ──────────────────────────────────────────────────────────────

describe("disconnect()", () => {
  test("transitions to disconnected state", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    client.disconnect();

    expect(client.getState()).toBe("disconnected");
  });

  test("emits disconnected event", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    const eventPromise = waitForEvent(client, "disconnected");
    client.disconnect();

    await eventPromise;
    expect(client.getState()).toBe("disconnected");
  });

  test("rejects all pending sendRequest calls with Client disconnected", async () => {
    // Override server to swallow messages so requests stay pending
    messageOverride = () => {};

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    const request1 = client.sendRequest("krn_inst_target", {}, 5000);
    const request2 = client.sendRequest("krn_inst_target", {}, 5000);

    // Disconnect while requests are pending
    client.disconnect();

    await expect(request1).rejects.toThrow("Client disconnected");
    await expect(request2).rejects.toThrow("Client disconnected");
  });

  test("send() throws after disconnect", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    client.disconnect();

    expect(() => client.send("krn_inst_target", {})).toThrow(
      "Not connected to relay"
    );
  });
});

// ── Unsolicited messages ──────────────────────────────────────────────────────

describe("incoming unsolicited messages", () => {
  test("emits message event for push messages (no request_id)", async () => {
    // Override server to push a message without a request_id
    let openedWs: ServerWebSocket<unknown> | null = null;
    messageOverride = (ws) => {
      openedWs = ws;
      // Don't echo — we'll push separately
    };

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    const messagePromise = waitForEvent(client, "message");

    // Trigger a send so the server handler fires and we capture the ws
    client.send("krn_inst_target", { setup: true });
    await Bun.sleep(30); // let messageOverride fire and capture ws

    // Push an unsolicited message from server
    openedWs!.send(
      JSON.stringify({
        source: "krn_inst_push",
        payload: { notification: "hello" },
        // no request_id — this is a push
      })
    );

    const [response] = await messagePromise;
    const msg = response as { source: string; payload: { notification: string } };
    expect(msg.source).toBe("krn_inst_push");
    expect(msg.payload.notification).toBe("hello");
  });

  test("emits error event for malformed JSON", async () => {
    // Capture the server connection so we can push raw data
    let serverWs: ServerWebSocket<unknown> | null = null;
    messageOverride = (ws) => {
      serverWs = ws;
    };

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    const errorPromise = waitForEvent(client, "error");

    // Send something so messageOverride fires and captures serverWs
    client.send("krn_inst_target", {});
    await Bun.sleep(30);

    // Push malformed JSON from server
    serverWs!.send("this is not json {{{");

    const [err] = await errorPromise;
    expect((err as Error).message).toContain("Failed to parse relay message");
  });
});

// ── Event subscription ────────────────────────────────────────────────────────

describe("on() / off() event subscription", () => {
  test("on() registers a listener that fires on the event", async () => {
    const received: string[] = [];

    client.on("connected", () => {
      received.push("connected");
    });

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    expect(received).toContain("connected");
  });

  test("off() removes a listener so it no longer fires", async () => {
    const received: string[] = [];
    const handler = () => {
      received.push("connected");
    };

    client.on("connected", handler);
    client.off("connected", handler);

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    expect(received).toHaveLength(0);
  });

  test("multiple listeners for the same event all fire", async () => {
    const received: string[] = [];

    client.on("connected", () => received.push("listener-1"));
    client.on("connected", () => received.push("listener-2"));

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    expect(received).toContain("listener-1");
    expect(received).toContain("listener-2");
  });
});

// ── Reconnect behaviour ───────────────────────────────────────────────────────

describe("auto-reconnect", () => {
  test("transitions to reconnecting state after server closes connection", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    // Force-close the server-side socket to simulate unexpected disconnection
    const conn = serverConnections.at(-1);
    expect(conn).toBeDefined();
    conn!.close(1001, "Going away");

    // Should transition through disconnected → reconnecting
    await waitForState(client, "reconnecting", 2000);
    expect(client.getState()).toBe("reconnecting");

    // Clean up: stop reconnect loop
    client.disconnect();
  });

  test("emits reconnecting event with attempt number 1 on first retry", async () => {
    const attempts: number[] = [];
    client.on("reconnecting", (attempt) => {
      attempts.push(attempt);
    });

    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    const conn = serverConnections.at(-1);
    conn!.close(1001, "Going away");

    await waitForState(client, "reconnecting", 2000);
    expect(attempts[0]).toBe(1);

    client.disconnect();
  });

  test("does not reconnect after explicit disconnect()", async () => {
    client.connect(hubUrl(), "test_token");
    await waitForState(client, "connected");

    client.disconnect();

    // Wait a bit — state must remain disconnected, not transition to reconnecting
    await Bun.sleep(150);
    expect(client.getState()).toBe("disconnected");
  });
});

// ── getState() transitions ────────────────────────────────────────────────────

describe("getState() lifecycle", () => {
  test("follows disconnected → connecting → connected → disconnected arc", async () => {
    const states: string[] = [];

    // Capture connecting via timing
    client.connect(hubUrl(), "test_token");
    states.push(client.getState()); // should be connecting

    await waitForState(client, "connected");
    states.push(client.getState()); // connected

    client.disconnect();
    states.push(client.getState()); // disconnected

    expect(states).toEqual(["connecting", "connected", "disconnected"]);
  });
});
