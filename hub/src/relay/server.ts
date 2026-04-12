import type { ServerWebSocket } from "bun";
import type { ConnectionInfo, RelayMessage, RelayResponse, RelayError } from "./types.js";
import { RelayCloseCode } from "./types.js";
import { registerConnection, unregisterConnection, getConnection } from "./connections.js";
import { meterCall } from "./metering.js";
import { checkRelayRateLimit } from "../lib/rate-limit.js";
import { verifyToken } from "../auth/jwt.js";
import { getRedis } from "../lib/redis.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("relay");

// HUB-26: Per-plan message size limits (bytes)
const MAX_MESSAGE_BYTES: Record<string, number> = {
  free: 64 * 1024,       // 64 KB
  pro: 512 * 1024,       // 512 KB
  enterprise: 2 * 1024 * 1024, // 2 MB
};

// ---------------------------------------------------------------------------
// Bun WebSocket handler object
// ---------------------------------------------------------------------------

export const relayWebSocket = {
  open(ws: ServerWebSocket<ConnectionInfo>): void {
    const info = ws.data;
    const registered = registerConnection(info.instanceId, ws, info);

    if (!registered) {
      ws.close(RelayCloseCode.CONNECTION_LIMIT, "Connection limit reached for your plan");
      return;
    }

    logger.info("Relay connection opened", {
      instanceId: info.instanceId,
      userId: info.userId,
      plan: info.plan,
    });
  },

  async message(ws: ServerWebSocket<ConnectionInfo>, raw: string | Buffer): Promise<void> {
    const info = ws.data;
    const rawLength = typeof raw === "string" ? raw.length : raw.byteLength;

    // HUB-26: Reject oversized messages
    const maxBytes = MAX_MESSAGE_BYTES[info.plan] ?? MAX_MESSAGE_BYTES["free"]!;
    if (rawLength > maxBytes) {
      sendError(ws, "MESSAGE_TOO_LARGE", `Message exceeds ${maxBytes} byte limit for ${info.plan} plan`);
      return;
    }

    // Parse message
    let msg: RelayMessage;
    try {
      const text = typeof raw === "string" ? raw : raw.toString();
      msg = JSON.parse(text) as RelayMessage;
    } catch {
      sendError(ws, "INVALID_JSON", "Failed to parse message as JSON");
      return;
    }

    // Validate required fields
    if (!msg.target || typeof msg.target !== "string") {
      sendError(ws, "INVALID_MESSAGE", "Missing or invalid 'target' field", msg.request_id);
      return;
    }

    if (msg.payload === undefined) {
      sendError(ws, "INVALID_MESSAGE", "Missing 'payload' field", msg.request_id);
      return;
    }

    // Rate limit check
    const rateLimitResult = await checkRelayRateLimit(info.userId, info.plan);
    if (!rateLimitResult.allowed) {
      sendError(
        ws,
        "RATE_LIMITED",
        `Rate limit exceeded — resets at ${new Date(rateLimitResult.resetAt * 1000).toISOString()}`,
        msg.request_id
      );
      return;
    }

    // Find target connection
    const targetConn = getConnection(msg.target);
    if (!targetConn) {
      sendError(ws, "TARGET_OFFLINE", `Target ${msg.target} is not connected`, msg.request_id);
      return;
    }

    // Forward message to target
    const response: RelayResponse = {
      source: info.instanceId,
      payload: msg.payload,
      request_id: msg.request_id,
    };

    targetConn.ws.send(JSON.stringify(response));

    // Meter the call — fire-and-forget, never block the relay path
    meterCall(info.userId, info.instanceId, msg.target, rawLength).catch((err: unknown) => {
      logger.error("Metering failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    });

    logger.debug("Message relayed", {
      from: info.instanceId,
      to: msg.target,
      bytes: payloadBytes,
      request_id: msg.request_id,
    });
  },

  close(ws: ServerWebSocket<ConnectionInfo>, code: number, reason: string): void {
    const info = ws.data;
    unregisterConnection(info.instanceId);
    logger.info("Relay connection closed", {
      instanceId: info.instanceId,
      userId: info.userId,
      code,
      reason,
    });
  },

  // Bun handles ping/pong at the transport level — we echo pong explicitly for
  // clients that send application-level pings.
  ping(ws: ServerWebSocket<ConnectionInfo>): void {
    ws.pong();
  },
};

// ---------------------------------------------------------------------------
// Upgrade handler — called from the fetch handler before Hono
// ---------------------------------------------------------------------------

// Return semantics:
//   null      — not a relay path, let Hono handle it
//   Response  — auth error, return directly to client
//   undefined — upgrade succeeded, Bun takes ownership (return nothing to fetch)
export async function handleRelayUpgrade(
  req: Request,
  server: ReturnType<typeof Bun.serve>
): Promise<Response | null | undefined> {
  const url = new URL(req.url);

  if (url.pathname !== "/relay/connect") {
    return null;
  }

  // HUB-22: Prefer one-time ticket over raw token in URL
  const ticket = url.searchParams.get("ticket");
  const token = req.headers.get("Authorization")?.replace("Bearer ", "")
    ?? url.searchParams.get("token"); // fallback for backward compat

  let payload: Awaited<ReturnType<typeof verifyToken>>;

  if (ticket) {
    // Exchange ticket for connection info from Redis
    const redis = getRedis();
    const ticketData = await redis.get(`relay:ticket:${ticket}`);
    if (!ticketData) {
      return new Response("Invalid or expired ticket", { status: 401 });
    }
    // Delete ticket immediately (one-time use)
    await redis.del(`relay:ticket:${ticket}`);
    try {
      payload = JSON.parse(ticketData) as Awaited<ReturnType<typeof verifyToken>>;
    } catch {
      return new Response("Corrupt ticket data", { status: 500 });
    }
  } else if (token) {
    // Direct JWT verification (Authorization header or legacy ?token=)
    try {
      payload = await verifyToken(token);
    } catch {
      return new Response("Invalid or expired token", { status: 401 });
    }
  } else {
    return new Response("Missing authentication — use ticket or Authorization header", { status: 401 });
  }

  // HUB-24: Reject refresh tokens — only access tokens can open relay connections
  if (payload["type"] === "refresh") {
    return new Response("Refresh tokens cannot be used for relay auth", { status: 401 });
  }

  const instanceId = payload["instance_id"] as string | undefined;
  if (!instanceId) {
    return new Response(
      "Token must include instance_id — use an instance-scoped token",
      { status: 401 }
    );
  }

  const userId = payload.sub;
  if (!userId) {
    return new Response("Token must include sub claim", { status: 401 });
  }

  const plan = typeof payload["plan"] === "string" ? payload["plan"] : "free";

  const connectionInfo: ConnectionInfo = {
    instanceId,
    userId,
    plan,
    connectedAt: new Date(),
  };

  // server.upgrade returns true on success, false if headers don't request an upgrade
  const upgraded = server.upgrade(req, { data: connectionInfo });

  if (!upgraded) {
    return new Response("WebSocket upgrade failed — client must send Upgrade: websocket header", {
      status: 426,
    });
  }

  // Successful upgrade: Bun owns the socket from here, no HTTP response needed
  return undefined;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sendError(
  ws: ServerWebSocket<ConnectionInfo>,
  code: string,
  message: string,
  requestId?: string
): void {
  const error: RelayError = {
    error: { code, message },
    request_id: requestId,
  };
  ws.send(JSON.stringify(error));
}
