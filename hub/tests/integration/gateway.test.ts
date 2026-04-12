// gateway.test.ts — Integration tests for the MCP Gateway (/mcp/:slug)
//
// Strategy: same mock pattern as auth.test.ts.
//   - process.env set first
//   - mock.module for db/index.js and lib/redis.js
//   - a real Bun dev-server is started in beforeAll() to act as the upstream
//     developer MCP server; its URL is fed through the db mock so the gateway
//     proxy.ts will actually fetch() it
//   - app imported after mocks so Bun module cache sees the mock
//   - initializeKeys() called in beforeAll() for ephemeral JWT keys

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

// selectQueue allows different tests to enqueue multiple sequential responses
// (e.g. app lookup → subscription lookup).
let _selectQueue: MockRow[][] = [];
let _insertReturn: MockRow[] = [];
let _updateReturn: MockRow[] = [];

function nextSelectReturn(): Promise<MockRow[]> {
  if (_selectQueue.length === 0) return Promise.resolve([]);
  return Promise.resolve(_selectQueue.shift()!);
}

const mockSelectBuilder = {
  from: () => mockSelectBuilder,
  where: () => mockSelectBuilder,
  limit: () => nextSelectReturn(),
  orderBy: () => mockSelectBuilder,
};

const mockInsertBuilder = {
  values: () => mockInsertBuilder,
  returning: () => Promise.resolve(_insertReturn),
};

const mockUpdateBuilder = {
  set: () => mockUpdateBuilder,
  where: () => mockUpdateBuilder,
  returning: () => Promise.resolve(_updateReturn),
};

const mockDb = {
  select: (_fields?: unknown) => mockSelectBuilder,
  insert: (_table?: unknown) => mockInsertBuilder,
  update: (_table?: unknown) => mockUpdateBuilder,
};

mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  sql: {},
}));

// --- Redis mock state ---

// Calls to getRedis() in auth-middleware and rate-limit use these mocks.
// _redisStore lets individual tests pre-populate cache values.

let _redisStore: Map<string, string> = new Map();
let _incrValue = 1; // value returned by incr() — override to trigger rate-limit

const fakeRedis = {
  get: (key: string) => Promise.resolve(_redisStore.get(key) ?? null),
  set: (key: string, val: string) => {
    _redisStore.set(key, val);
    return Promise.resolve("OK");
  },
  setex: (key: string, _ttl: number, val: string) => {
    _redisStore.set(key, val);
    return Promise.resolve("OK");
  },
  incr: (_key: string) => Promise.resolve(_incrValue),
  expire: (_key: string, _ttl: number) => Promise.resolve(1),
  del: (..._keys: string[]) => Promise.resolve(1),
  pipeline: () => ({
    incr: () => undefined,
    expire: () => undefined,
    incrby: () => undefined,
    exec: () => Promise.resolve([]),
  }),
};

mock.module("../../src/lib/redis.js", () => ({
  getRedis: () => fakeRedis,
  closeRedis: () => Promise.resolve(),
  isRedisReady: () => true,
}));

// ---------------------------------------------------------------------------
// 3. Static imports (after mocks)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "bun:test";
import type { Server } from "bun";
import { app } from "../../src/index.js";
import { initializeKeys, signAccessToken } from "../../src/auth/jwt.js";

// ---------------------------------------------------------------------------
// 4. Mock developer MCP server
//
//    Bun.serve({ port: 0 }) binds to a random free port.
//    We track headers received from the gateway so per-test assertions can
//    inspect X-Kronus-User / X-Kronus-Plan / X-Kronus-Request-Id.
// ---------------------------------------------------------------------------

let mockDevServer: Server;
let lastDevServerRequest: { headers: Record<string, string>; method: string } | null =
  null;

beforeAll(async () => {
  // Generate ephemeral JWT keys — no JWT_PRIVATE_KEY / JWT_PUBLIC_KEY in env
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();

  mockDevServer = Bun.serve({
    port: 0, // OS picks a free port
    fetch(req) {
      // Capture request metadata for per-test assertions
      lastDevServerRequest = {
        method: req.method,
        headers: Object.fromEntries(req.headers.entries()),
      };

      if (req.method === "GET") {
        // Simulate SSE stream
        return new Response("data: {}\n\n", {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
      }

      // POST — return a minimal JSON-RPC response
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    },
  });
});

afterAll(() => {
  mockDevServer?.stop(true);
});

// ---------------------------------------------------------------------------
// 5. Helpers
// ---------------------------------------------------------------------------

/**
 * Build a signed access token for a user.
 */
async function makeToken(
  overrides: {
    sub?: string;
    plan?: string;
    app_access?: string[];
  } = {}
): Promise<string> {
  return signAccessToken({
    sub: overrides.sub ?? "krn_usr_testuser0001",
    plan: overrides.plan ?? "free",
    capabilities: ["apps:install"],
    app_access: overrides.app_access ?? [],
    scopes: ["read"],
  });
}

/**
 * Return the URL of the mock developer server (https:// required for SSRF
 * guard; we use a mock URL with an HTTPS-looking scheme in the DB so the
 * SSRF check passes — the actual fetch still hits the mock Bun server but
 * for testing we override the app lookup to return an http:// localhost URL
 * and rely on a separate SSRF test to verify the guard).
 *
 * Because proxy.ts calls isPrivateOrLocalUrl() which rejects localhost, we
 * need to bypass the SSRF guard for happy-path tests. We do this by storing
 * a non-localhost URL in the db mock but pointing fetch() at the real local
 * server via a custom global fetch interceptor in the approach below.
 *
 * APPROACH CHOSEN: Store the real Bun server URL in the db mock. The SSRF
 * guard checks for localhost / 127.x / private-IP hostnames. Since
 * mockDevServer binds on 0.0.0.0:PORT and we point to "127.0.0.1", the SSRF
 * guard would block it. Instead we set developer_mcp_url to a fake HTTPS
 * domain and patch globalThis.fetch for gateway tests so it redirects to
 * our local server. This is isolated to the gateway describe block via
 * beforeEach / afterEach save/restore.
 */
const FAKE_DEV_URL = "https://dev.example.com/mcp";

let _originalFetch: typeof globalThis.fetch;

function installFetchInterceptor(): void {
  _originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === FAKE_DEV_URL) {
      // Redirect to local mock dev server
      const localUrl = `http://127.0.0.1:${mockDevServer.port}`;
      return _originalFetch(localUrl, init);
    }
    return _originalFetch(input, init);
  };
}

function removeFetchInterceptor(): void {
  if (_originalFetch) {
    globalThis.fetch = _originalFetch;
  }
}

/** Configure what the next db.select().…limit() call returns (FIFO queue). */
function enqueueSelect(...rows: MockRow[][]): void {
  _selectQueue.push(...rows);
}

/** Build a published free app row pointing to FAKE_DEV_URL. */
function makeApp(overrides: Partial<{
  id: string;
  slug: string;
  developer_mcp_url: string;
  pricing_model: string;
  status: string;
}> = {}): MockRow {
  return {
    id: overrides.id ?? "krn_app_testapp0001",
    slug: overrides.slug ?? "test-app",
    developer_mcp_url: overrides.developer_mcp_url ?? FAKE_DEV_URL,
    pricing_model: overrides.pricing_model ?? "free",
    status: overrides.status ?? "published",
  };
}

function makeAuthRequest(
  method: "POST" | "GET",
  path: string,
  token: string,
  body?: unknown
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// 6. Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  _selectQueue = [];
  _insertReturn = [];
  _updateReturn = [];
  _redisStore = new Map();
  _incrValue = 1; // allow one call before rate-limit triggers
  lastDevServerRequest = null;
});

// ---------------------------------------------------------------------------
// POST /mcp/:slug — JSON-RPC forwarding
// ---------------------------------------------------------------------------

describe("POST /mcp/:slug — auth guard", () => {
  it("returns 401 when Authorization header is absent", async () => {
    // Arrange
    const req = new Request("http://localhost/mcp/test-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 1 }),
    });

    // Act
    const res = await app.request(req);

    // Assert
    expect(res.status).toBe(401);
  });

  it("returns error code UNAUTHORIZED when header is absent", async () => {
    // Arrange
    const req = new Request("http://localhost/mcp/test-app", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    // Act
    const res = await app.request(req);
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("UNAUTHORIZED");
  });

  it("returns 401 when Bearer token is invalid", async () => {
    // Arrange
    const req = new Request("http://localhost/mcp/test-app", {
      method: "POST",
      headers: {
        Authorization: "Bearer not.a.valid.token",
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    // Act
    const res = await app.request(req);

    // Assert
    expect(res.status).toBe(401);
  });
});

describe("POST /mcp/:slug — app resolution", () => {
  it("returns 404 when app slug does not exist in db (cache miss + db miss)", async () => {
    // Arrange — Redis cache miss, db returns []
    const token = await makeToken();
    enqueueSelect([]); // db.select() for app lookup returns empty

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/nonexistent-app", token, {}));

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns error code NOT_FOUND when app does not exist", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/ghost-app", token, {}));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });

  it("returns 404 for an app with status 'draft'", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ status: "draft" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/draft-app", token, {}));

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns 404 for an app with status 'suspended'", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ status: "suspended" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/suspended-app", token, {}));

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns 503 for an app with status 'degraded'", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ status: "degraded" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/degraded-app", token, {}));

    // Assert
    expect(res.status).toBe(503);
  });

  it("returns 503 for an app with status 'offline'", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ status: "offline" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/offline-app", token, {}));

    // Assert
    expect(res.status).toBe(503);
  });
});

describe("POST /mcp/:slug — SSRF protection", () => {
  it("returns 502 APP_CONFIG_ERROR when developer_mcp_url is http:// (not https)", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ developer_mcp_url: "http://attacker.com/mcp" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/test-app", token, {}));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(502);
    expect(body.error["code"]).toBe("APP_CONFIG_ERROR");
  });

  it("returns 502 APP_CONFIG_ERROR when developer_mcp_url points to localhost", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ developer_mcp_url: "https://localhost/mcp" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/test-app", token, {}));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(502);
    expect(body.error["code"]).toBe("APP_CONFIG_ERROR");
  });

  it("returns 502 APP_CONFIG_ERROR when developer_mcp_url points to 192.168.x.x", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ developer_mcp_url: "https://192.168.1.100/mcp" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/test-app", token, {}));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(502);
    expect(body.error["code"]).toBe("APP_CONFIG_ERROR");
  });

  it("returns 502 APP_CONFIG_ERROR when developer_mcp_url points to 10.x.x.x", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ developer_mcp_url: "https://10.0.0.1/mcp" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/test-app", token, {}));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(502);
    expect(body.error["code"]).toBe("APP_CONFIG_ERROR");
  });

  it("returns 502 APP_CONFIG_ERROR when developer_mcp_url is a .local hostname", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ developer_mcp_url: "https://myserver.local/mcp" })]);

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/test-app", token, {}));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(502);
    expect(body.error["code"]).toBe("APP_CONFIG_ERROR");
  });
});

describe("POST /mcp/:slug — subscription check (paid apps)", () => {
  it("returns 403 SUBSCRIPTION_REQUIRED when app is paid and token has no app_access", async () => {
    // Arrange — paid app, no app_access claim, no sub in db
    const token = await makeToken({ app_access: [] });
    enqueueSelect(
      [makeApp({ pricing_model: "paid" })], // app lookup
      []                                     // subscription lookup → no sub
    );

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/test-app", token, {}));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(403);
    expect(body.error["code"]).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("returns 403 SUBSCRIPTION_REQUIRED when Redis subscription cache says '0'", async () => {
    // Arrange — subscription cached as "0" (no active sub)
    const token = await makeToken({ app_access: [] });
    enqueueSelect([makeApp({ pricing_model: "paid" })]);
    // Pre-populate Redis cache with "no subscription"
    _redisStore.set("sub:krn_usr_testuser0001:krn_app_testapp0001", "0");

    // Act
    const res = await app.request(makeAuthRequest("POST", "/mcp/test-app", token, {}));

    // Assert
    expect(res.status).toBe(403);
  });

  it("skips subscription check when app_access claim contains the slug", async () => {
    // Arrange — paid app, but token already carries app_access: ["test-app"]
    // The gateway must NOT call the subscription db/cache when the claim is present.
    // We verify by only enqueuing one select return (for app lookup) — if a second
    // select fires (sub lookup) it would return [] → 403, which would fail this test.
    installFetchInterceptor();
    const token = await makeToken({ app_access: ["test-app"] });
    enqueueSelect([makeApp({ pricing_model: "paid" })]);

    // Act
    const res = await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", method: "tools/list", id: 1 })
    );

    // Assert — should reach the upstream and return 200 (or 502 if upstream fails,
    // but NOT 403 which would indicate subscription check was triggered)
    expect(res.status).not.toBe(403);
    removeFetchInterceptor();
  });

  it("allows access when Redis subscription cache says '1'", async () => {
    // Arrange — paid app, no claim, but Redis says active sub
    installFetchInterceptor();
    const token = await makeToken({ app_access: [] });
    enqueueSelect([makeApp({ pricing_model: "paid" })]);
    _redisStore.set("sub:krn_usr_testuser0001:krn_app_testapp0001", "1");

    // Act
    const res = await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", method: "tools/list", id: 1 })
    );

    // Assert — not blocked by subscription check
    expect(res.status).not.toBe(403);
    removeFetchInterceptor();
  });

  it("allows access when db has an active subscription (no cache)", async () => {
    // Arrange — no Redis cache, db returns active sub row
    installFetchInterceptor();
    const token = await makeToken({ app_access: [] });
    enqueueSelect(
      [makeApp({ pricing_model: "paid" })],            // app lookup
      [{ status: "active" }]                           // subscription lookup
    );

    // Act
    const res = await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", method: "tools/list", id: 1 })
    );

    // Assert
    expect(res.status).not.toBe(403);
    removeFetchInterceptor();
  });
});

describe("POST /mcp/:slug — rate limiting", () => {
  it("returns 429 RATE_LIMIT_EXCEEDED when incr exceeds plan limit", async () => {
    // Arrange — free plan limit is 10 calls/min; simulate incr returning 11
    _incrValue = 11;
    const token = await makeToken({ plan: "free" });
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, {})
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(429);
    expect(body.error["code"]).toBe("RATE_LIMIT_EXCEEDED");
  });

  it("allows request when incr equals plan limit exactly", async () => {
    // Arrange — free plan: 10/min; incr = 10 (boundary, still allowed)
    installFetchInterceptor();
    _incrValue = 10;
    const token = await makeToken({ plan: "free" });
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", id: 1, method: "tools/list" })
    );

    // Assert — not rate-limited
    expect(res.status).not.toBe(429);
    removeFetchInterceptor();
  });
});

describe("POST /mcp/:slug — happy path (upstream forwarding)", () => {
  it("returns 200 and proxies the developer server response body", async () => {
    // Arrange
    installFetchInterceptor();
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      makeAuthRequest(
        "POST",
        "/mcp/test-app",
        token,
        { jsonrpc: "2.0", method: "tools/list", id: 1 }
      )
    );

    // Assert
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body["jsonrpc"]).toBe("2.0");
    removeFetchInterceptor();
  });

  it("forwards X-Kronus-User header to developer server", async () => {
    // Arrange
    installFetchInterceptor();
    const token = await makeToken({ sub: "krn_usr_testuser0001" });
    enqueueSelect([makeApp()]);

    // Act
    await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", id: 1, method: "ping" })
    );

    // Assert
    expect(lastDevServerRequest?.headers["x-kronus-user"]).toBe("krn_usr_testuser0001");
    removeFetchInterceptor();
  });

  it("forwards X-Kronus-Plan header to developer server", async () => {
    // Arrange
    installFetchInterceptor();
    const token = await makeToken({ plan: "pro" });
    enqueueSelect([makeApp()]);

    // Act
    await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", id: 1, method: "ping" })
    );

    // Assert
    expect(lastDevServerRequest?.headers["x-kronus-plan"]).toBe("pro");
    removeFetchInterceptor();
  });

  it("forwards X-Kronus-Request-Id header (a UUID) to developer server", async () => {
    // Arrange
    installFetchInterceptor();
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", id: 1, method: "ping" })
    );

    // Assert — header present and looks like a UUID
    const requestId = lastDevServerRequest?.headers["x-kronus-request-id"] ?? "";
    expect(requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    removeFetchInterceptor();
  });

  it("returns 502 APP_UPSTREAM_ERROR when developer server returns 500", async () => {
    // Arrange — intercept fetch and return a 500 from dev server
    _originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("Internal Server Error", { status: 500 });
    };
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, {})
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(502);
    expect(body.error["code"]).toBe("APP_UPSTREAM_ERROR");
    removeFetchInterceptor();
  });

  it("returns app lookup result from Redis cache when cached", async () => {
    // Arrange — pre-populate Redis cache so db.select() is never called
    installFetchInterceptor();
    const cachedApp = makeApp();
    _redisStore.set(`gateway:app:test-app`, JSON.stringify(cachedApp));
    // _selectQueue is empty — if db is called it would return [] → 404
    const token = await makeToken();

    // Act
    const res = await app.request(
      makeAuthRequest("POST", "/mcp/test-app", token, { jsonrpc: "2.0", id: 1, method: "tools/list" })
    );

    // Assert — served from cache, request succeeded
    expect(res.status).toBe(200);
    removeFetchInterceptor();
  });
});

// ---------------------------------------------------------------------------
// GET /mcp/:slug — SSE stream forwarding
// ---------------------------------------------------------------------------

describe("GET /mcp/:slug — SSE stream", () => {
  it("returns 401 when Authorization header is absent", async () => {
    // Arrange
    const req = new Request("http://localhost/mcp/test-app", { method: "GET" });

    // Act
    const res = await app.request(req);

    // Assert
    expect(res.status).toBe(401);
  });

  it("returns 200 and text/event-stream Content-Type for a valid GET", async () => {
    // Arrange
    installFetchInterceptor();
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      makeAuthRequest("GET", "/mcp/test-app", token)
    );

    // Assert
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    removeFetchInterceptor();
  });

  it("returns Cache-Control: no-cache for SSE responses", async () => {
    // Arrange
    installFetchInterceptor();
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      makeAuthRequest("GET", "/mcp/test-app", token)
    );

    // Assert
    expect(res.headers.get("cache-control")).toBe("no-cache");
    removeFetchInterceptor();
  });

  it("returns 404 for GET /mcp/nonexistent-app", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([]);

    // Act
    const res = await app.request(
      makeAuthRequest("GET", "/mcp/nonexistent-app", token)
    );

    // Assert
    expect(res.status).toBe(404);
  });

  it("forwards X-Kronus-User header on GET request to developer server", async () => {
    // Arrange
    installFetchInterceptor();
    const token = await makeToken({ sub: "krn_usr_ssetest0001" });
    enqueueSelect([makeApp()]);

    // Act
    await app.request(makeAuthRequest("GET", "/mcp/test-app", token));

    // Assert
    expect(lastDevServerRequest?.headers["x-kronus-user"]).toBe("krn_usr_ssetest0001");
    removeFetchInterceptor();
  });

  it("returns 502 APP_UPSTREAM_ERROR when developer server returns non-2xx on GET", async () => {
    // Arrange
    _originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input: RequestInfo | URL, _init?: RequestInit) => {
      return new Response("Service Unavailable", { status: 503 });
    };
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(makeAuthRequest("GET", "/mcp/test-app", token));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(res.status).toBe(502);
    expect(body.error["code"]).toBe("APP_UPSTREAM_ERROR");
    removeFetchInterceptor();
  });
});
