import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { getConfig } from "./lib/config.js";
import { createLogger } from "./lib/logger.js";
import { initializeKeys } from "./auth/jwt.js";
import { jwksApp } from "./auth/jwks.js";
import { authRoutes } from "./routes/auth.js";
import { instanceRoutes } from "./routes/instances.js";
import { appRoutes } from "./routes/apps.js";
import { errorHandler } from "./lib/errors.js";
import { relayWebSocket, handleRelayUpgrade } from "./relay/server.js";
import { startMeteringFlush, stopMeteringFlush } from "./relay/metering.js";
import { startHealthCheck, stopHealthCheck } from "./gateway/health-check.js";
import { closeRedis } from "./lib/redis.js";
import { gatewayRoutes } from "./gateway/proxy.js";
import { developerRoutes } from "./routes/developer.js";
import { webhookRoutes } from "./billing/webhooks.js";
import { billingRoutes } from "./routes/billing.js";
import { adminRoutes } from "./routes/admin.js";

const config = getConfig();
const logger = createLogger("hub");

const app = new Hono();

app.use("*", secureHeaders());
app.use("*", cors({
  origin: config.NODE_ENV === "production" ? config.HUB_URL : "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Admin-Key"],
  maxAge: 86400,
}));
app.use("/auth/*", bodyLimit({ maxSize: 64 * 1024 }));
app.use("/instances/*", bodyLimit({ maxSize: 16 * 1024 }));
app.use("/apps/*", bodyLimit({ maxSize: 32 * 1024 }));
app.use("/mcp/*", bodyLimit({ maxSize: 256 * 1024 })); // HUB-48: 256KB for MCP JSON-RPC
app.use("/developer/*", bodyLimit({ maxSize: 128 * 1024 })); // 128KB for manifests
app.use("/admin/*", bodyLimit({ maxSize: 16 * 1024 }));
// /billing/webhooks is intentionally excluded from bodyLimit — Stripe sends the raw body
// and the signature covers its exact byte sequence.  Mount the webhook handler first so
// the path-specific bodyLimit below never intercepts it.
app.route("/billing", webhookRoutes);
app.use("/billing/*", bodyLimit({ maxSize: 16 * 1024 }));

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info("request", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: duration,
  });
});

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    version: "5.3.0",
    timestamp: new Date().toISOString(),
  });
});

app.route("/", jwksApp);
app.route("/auth", authRoutes);
app.route("/instances", instanceRoutes);
app.route("/apps", appRoutes);
app.route("/mcp", gatewayRoutes);
app.route("/developer", developerRoutes);
app.route("/billing", billingRoutes);
app.route("/admin", adminRoutes);

app.onError(errorHandler);

if (import.meta.main) {
  await initializeKeys();

  const server = Bun.serve({
    port: config.PORT,
    async fetch(req, server) {
      // WebSocket upgrade requests must be intercepted before Hono sees them.
      // handleRelayUpgrade returns:
      //   null      — not /relay/connect, fall through to Hono
      //   Response  — auth/protocol error, return directly
      //   undefined — upgrade succeeded, Bun owns the socket (return nothing)
      const upgradeResult = await handleRelayUpgrade(req, server);

      if (upgradeResult === null) {
        // Not a relay path — let Hono handle it
        return app.fetch(req);
      }

      if (upgradeResult === undefined) {
        // Upgrade accepted — Bun expects no Response from the fetch handler.
        // TypeScript requires a return value; cast through unknown to satisfy it.
        return undefined as unknown as Response;
      }

      // Auth error or upgrade failure — return the error Response directly
      return upgradeResult;
    },
    websocket: {
      ...relayWebSocket,
      maxPayloadLength: 2 * 1024 * 1024, // 2 MB transport-level cap (app-level per-plan in server.ts)
    },
  });

  // Background flush writes accumulated metering data to Postgres every minute
  startMeteringFlush();

  // Background health checker probes developer MCP servers every 5 minutes
  startHealthCheck();

  logger.info("Kronus Hub started", {
    port: server.port,
    env: config.NODE_ENV,
    relay: "enabled",
  });

  // Graceful shutdown — drain metering, close Redis, then stop the HTTP/WS server
  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down", { signal });
    stopHealthCheck();
    stopMeteringFlush();
    await closeRedis();
    server.stop();
  };

  process.on("SIGTERM", () => { shutdown("SIGTERM").catch(() => process.exit(1)); });
  process.on("SIGINT",  () => { shutdown("SIGINT").catch(() => process.exit(1)); });
}

export { app };
