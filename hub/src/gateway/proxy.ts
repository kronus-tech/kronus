import { Hono } from "hono";
import type { GatewayVariables } from "./auth-middleware.js";
import { gatewayAuth } from "./auth-middleware.js";
import { meterCall } from "../relay/metering.js";
import { AppError } from "../lib/errors.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("gateway:proxy");

// ---------------------------------------------------------------------------
// Timeout for upstream developer servers (ms)
// ---------------------------------------------------------------------------

const UPSTREAM_TIMEOUT_MS = 30_000;
const MAX_SSE_STREAM_MS = 3_600_000; // HUB-53: 1 hour max SSE stream duration

// HUB-45: Allowlist for upstream Content-Type values
const SAFE_CONTENT_TYPES = [
  "application/json",
  "text/event-stream",
  "application/octet-stream",
  "application/x-ndjson",
];

function sanitizeContentType(raw: string | null, fallback: string): string {
  if (!raw) return fallback;
  const safe = SAFE_CONTENT_TYPES.find((ct) => raw.startsWith(ct));
  return safe ?? fallback;
}

// ---------------------------------------------------------------------------
// Route group — all /mcp/:slug routes share gatewayAuth
// ---------------------------------------------------------------------------

const gatewayRoutes = new Hono<{ Variables: GatewayVariables }>();

gatewayRoutes.use("/:slug/*", gatewayAuth);
gatewayRoutes.use("/:slug", gatewayAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildUpstreamHeaders(
  originalContentType: string | undefined,
  userId: string,
  plan: string,
  requestId: string
): HeadersInit {
  return {
    "Content-Type": originalContentType ?? "application/json",
    "X-Kronus-User": userId,
    "X-Kronus-Plan": plan,
    "X-Kronus-Request-Id": requestId,
  };
}

function handleAbortOrUpstreamError(err: unknown, slug: string): never {
  if (err instanceof Error && err.name === "AbortError") {
    logger.warn("Developer server timeout", { slug, timeout_ms: UPSTREAM_TIMEOUT_MS });
    throw new AppError(
      503,
      "APP_TIMEOUT",
      "Developer server did not respond within 30 seconds"
    );
  }

  logger.error("Developer server unreachable", {
    slug,
    message: err instanceof Error ? err.message : String(err),
  });
  throw new AppError(502, "APP_ERROR", "Developer server error");
}

// ---------------------------------------------------------------------------
// POST /mcp/:slug — JSON-RPC request forwarding
// ---------------------------------------------------------------------------

gatewayRoutes.post("/:slug", async (c) => {
  const app = c.get("gatewayApp");
  const user = c.get("gatewayUser");

  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let devResponse: Response;

  try {
    const body = await c.req.text();

    devResponse = await fetch(app.developer_mcp_url, {
      method: "POST",
      headers: buildUpstreamHeaders(
        c.req.header("Content-Type"),
        user.sub,
        user.plan,
        requestId
      ),
      body,
      signal: controller.signal,
      redirect: "error", // HUB-42: prevent SSRF via redirect
    });

    clearTimeout(timeout);

    // Meter the call — fire-and-forget, never block the response
    const payloadBytes = new TextEncoder().encode(body).byteLength;
    meterCall(user.sub, user.sub, app.slug, payloadBytes).catch((err: unknown) => {
      logger.warn("Metering failed (fire-and-forget)", {
        slug: app.slug,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    handleAbortOrUpstreamError(err, app.slug);
  }

  // Non-2xx from developer: surface as 502 with upstream detail
  if (!devResponse.ok) {
    const errorBody = await devResponse.text().catch(() => "");
    logger.warn("Developer server returned non-2xx", {
      slug: app.slug,
      status: devResponse.status,
    });
    throw new AppError(
      502,
      "APP_UPSTREAM_ERROR",
      `Developer server returned ${devResponse.status}`,
      { upstream_status: devResponse.status, upstream_body: errorBody.slice(0, 256) }
    );
  }

  return new Response(devResponse.body, {
    status: devResponse.status,
    headers: {
      "Content-Type": sanitizeContentType(
        devResponse.headers.get("Content-Type"),
        "application/json"
      ),
      "X-Content-Type-Options": "nosniff",
    },
  });
});

// ---------------------------------------------------------------------------
// GET /mcp/:slug — SSE stream forwarding (no buffering)
// ---------------------------------------------------------------------------

gatewayRoutes.get("/:slug", async (c) => {
  const app = c.get("gatewayApp");
  const user = c.get("gatewayUser");

  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let devResponse: Response;

  try {
    devResponse = await fetch(app.developer_mcp_url, {
      method: "GET",
      headers: buildUpstreamHeaders(
        c.req.header("Accept"),
        user.sub,
        user.plan,
        requestId
      ),
      signal: controller.signal,
      redirect: "error", // HUB-42: prevent SSRF via redirect
    });

    clearTimeout(timeout);

    // HUB-53: Set max stream duration timeout (1h) — initial fetch timeout is cleared,
    // this ensures the SSE stream can't run indefinitely
    const streamTimeout = setTimeout(() => controller.abort(), MAX_SSE_STREAM_MS);

    // Meter the GET as 0 payload bytes (no request body)
    meterCall(user.sub, user.sub, app.slug, 0).catch((err: unknown) => {
      logger.warn("Metering failed (fire-and-forget)", {
        slug: app.slug,
        message: err instanceof Error ? err.message : String(err),
      });
    });
  } catch (err: unknown) {
    clearTimeout(timeout);
    handleAbortOrUpstreamError(err, app.slug);
  }

  if (!devResponse.ok) {
    logger.warn("Developer server returned non-2xx on GET/SSE", {
      slug: app.slug,
      status: devResponse.status,
    });
    throw new AppError(
      502,
      "APP_UPSTREAM_ERROR",
      `Developer server returned ${devResponse.status}`
    );
  }

  // Pipe the body directly — no buffering so SSE events flow through as they arrive
  return new Response(devResponse.body, {
    status: devResponse.status,
    headers: {
      "Content-Type": sanitizeContentType(
        devResponse.headers.get("Content-Type"),
        "text/event-stream"
      ),
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
});

export { gatewayRoutes };
