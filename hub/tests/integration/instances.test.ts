// instances.test.ts — Integration tests for the /instances routes
//
// Strategy: same db-mock pattern as auth.test.ts. The db module is intercepted
// by mock.module() before any static import resolves it, so no real Postgres
// connection is required. JWT keys are initialised in ephemeral mode inside
// beforeAll(). Real JWTs are signed with signAccessToken() so the requireAuth
// middleware accepts them.
//
// IMPORTANT: process.env vars and mock.module() calls must appear BEFORE any
// static import that transitively loads hub/src/db/index.ts or getConfig().

// ---------------------------------------------------------------------------
// 1. Set required env vars — must be first
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

// ---------------------------------------------------------------------------
// 2. Mock the db module — intercept before static imports resolve
//
//    Exposes the full Drizzle fluent builder surface used by instances.ts:
//      db.select().from().where().limit()
//      db.insert().values().returning()
//      db.update().set().where()
//      db.delete().where().returning()
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

type MockRow = Record<string, unknown>;

let _selectReturns: MockRow[][] = [];
let _selectCallIndex = 0;
let _insertReturn: MockRow[] = [];
let _updateCalled = false;
let _deleteReturn: MockRow[] = [];

// SELECT chain: db.select().from().where().limit()
// Some queries use .limit(), others don't (e.g. count queries).
// .where() and .limit() both resolve the current _selectReturns entry.
// Using then() makes the builder thenable so await works on .where() directly.
const createSelectBuilder = (): Record<string, unknown> => {
  const builder: Record<string, unknown> = {
    from: () => builder,
    where: () => builder,
    limit: () => {
      const result = _selectReturns[_selectCallIndex] ?? [];
      _selectCallIndex++;
      return Promise.resolve(result);
    },
    then: (resolve: (v: MockRow[]) => void, reject?: (e: unknown) => void) => {
      const result = _selectReturns[_selectCallIndex] ?? [];
      _selectCallIndex++;
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return builder;
};
const mockSelectBuilder = createSelectBuilder();

// INSERT chain: db.insert().values().returning()
const mockInsertBuilder = {
  values: () => mockInsertBuilder,
  returning: () => Promise.resolve(_insertReturn),
};

// UPDATE chain: db.update().set().where()
const mockUpdateBuilder = {
  set: () => mockUpdateBuilder,
  where: () => {
    _updateCalled = true;
    return Promise.resolve([]);
  },
};

// DELETE chain: db.delete().where().returning()
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

mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  sql: {},
}));

// Mock Redis for rate limiting
mock.module("../../src/lib/redis.js", () => ({
  getRedis: () => ({ incr: () => Promise.resolve(1), expire: () => Promise.resolve(1), get: () => Promise.resolve(null), set: () => Promise.resolve("OK"), setex: () => Promise.resolve("OK"), del: () => Promise.resolve(1), pipeline: () => ({ incr: () => ({}), expire: () => ({}), incrby: () => ({}), exec: () => Promise.resolve([]) }), status: "ready" }),
  closeRedis: () => Promise.resolve(),
  isRedisReady: () => true,
}));

// ---------------------------------------------------------------------------
// 3. Static imports — safe after env + mocks are in place
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { app } from "../../src/index.js";
import { initializeKeys, signAccessToken } from "../../src/auth/jwt.js";
import * as jose from "jose";

// ---------------------------------------------------------------------------
// 4. Fixtures and helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = "krn_usr_testuser0001";
const TEST_INSTANCE_ID = "krn_inst_testinst001";

function makeInstance(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: TEST_INSTANCE_ID,
    user_id: TEST_USER_ID,
    status: "active",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Signs a plain user access token (no instance_id claim).
 * Used for /register and /heartbeat-rejection tests.
 */
async function makeUserToken(userId = TEST_USER_ID): Promise<string> {
  return signAccessToken({
    sub: userId,
    plan: "free",
    capabilities: ["apps:install"],
    app_access: [],
    scopes: ["read"],
  });
}

/**
 * Signs an instance-scoped access token (includes instance_id claim).
 * Used for /heartbeat happy-path tests.
 */
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

/** Build a JSON POST Request. */
function jsonPost(path: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

/** Build a DELETE Request. */
function deleteRequest(path: string, token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request(`http://localhost${path}`, {
    method: "DELETE",
    headers,
  });
}

// ---------------------------------------------------------------------------
// 5. Helpers that control mock return values
// ---------------------------------------------------------------------------

function mockInsertReturns(rows: MockRow[]): void {
  _insertReturn = rows;
}

function mockDeleteReturns(rows: MockRow[]): void {
  _deleteReturn = rows;
}

function mockSelectSequence(...results: MockRow[][]): void {
  _selectReturns = results;
  _selectCallIndex = 0;
}

// Convenience: set up register path mocks (user lookup + instance count)
function mockRegisterSelects(userPlan = "free", instanceCount = 0): void {
  mockSelectSequence(
    [{ id: TEST_USER_ID, plan: userPlan }],     // user lookup
    [{ count: instanceCount }],                  // instance count
  );
}

// ---------------------------------------------------------------------------
// 6. Global setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Use ephemeral keys for the entire test run — consistent with auth.test.ts
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();
});

beforeEach(() => {
  // Reset all mock state between tests so tests are fully isolated
  _selectReturns = [];
  _selectCallIndex = 0;
  _insertReturn = [];
  _updateCalled = false;
  _deleteReturn = [];
});

// ---------------------------------------------------------------------------
// POST /instances/register
// ---------------------------------------------------------------------------

describe("POST /instances/register — happy path", () => {
  it("returns 201 with instance and access_token when authenticated", async () => {
    // Arrange
    const token = await makeUserToken();
    mockRegisterSelects();
    mockInsertReturns([makeInstance()]);

    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-public-key"}' },
        token
      )
    );

    // Assert
    expect(response.status).toBe(201);
    const body = await response.json() as Record<string, unknown>;
    expect(body["instance"]).toBeDefined();
    expect(typeof body["access_token"]).toBe("string");
  });

  it("response body contains a 3-part JWT access_token", async () => {
    // Arrange
    const token = await makeUserToken();
    mockRegisterSelects();
    mockInsertReturns([makeInstance()]);

    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-key"}' },
        token
      )
    );
    const body = await response.json() as { access_token: string };

    // Assert — JWTs have exactly three dot-separated segments
    expect(body.access_token.split(".").length).toBe(3);
  });

  it("the returned access_token payload contains the registered instance_id", async () => {
    // Arrange
    const token = await makeUserToken();
    mockRegisterSelects();
    mockInsertReturns([makeInstance({ id: "krn_inst_specific001" })]);

    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-key"}' },
        token
      )
    );
    const body = await response.json() as { access_token: string; instance: Record<string, unknown> };

    // Assert — decode without verifying so we can inspect the payload
    const decoded = jose.decodeJwt(body.access_token);
    expect(decoded["instance_id"]).toBe("krn_inst_specific001");
    expect(decoded["instance_id"]).toBe(body.instance["id"]);
  });

  it("the returned access_token sub claim matches the authenticated user", async () => {
    // Arrange
    const token = await makeUserToken(TEST_USER_ID);
    mockRegisterSelects();
    mockInsertReturns([makeInstance()]);

    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-key"}' },
        token
      )
    );
    const body = await response.json() as { access_token: string };

    // Assert
    const decoded = jose.decodeJwt(body.access_token);
    expect(decoded.sub).toBe(TEST_USER_ID);
  });

  it("instance object in response contains id, user_id, status, and created_at", async () => {
    // Arrange
    const token = await makeUserToken();
    mockRegisterSelects();
    mockInsertReturns([makeInstance()]);

    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-key"}' },
        token
      )
    );
    const body = await response.json() as { instance: Record<string, unknown> };

    // Assert
    expect(body.instance["id"]).toBeDefined();
    expect(body.instance["user_id"]).toBe(TEST_USER_ID);
    expect(body.instance["status"]).toBe("active");
    expect(body.instance["created_at"]).toBeDefined();
  });

  it("accepts optional fields: machine_fingerprint, kronus_version, os", async () => {
    // Arrange
    const token = await makeUserToken();
    mockRegisterSelects();
    mockInsertReturns([makeInstance()]);

    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        {
          public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-key"}',
          machine_fingerprint: "mymachine-darwin",
          kronus_version: "5.3.0",
          os: "darwin",
        },
        token
      )
    );

    // Assert — route accepts the extra fields without error
    expect(response.status).toBe(201);
  });
});

describe("POST /instances/register — auth failures", () => {
  it("returns 401 when Authorization header is absent", async () => {
    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-key"}' }
        // no token
      )
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns 401 when Bearer token is invalid", async () => {
    // Act
    const response = await app.request(
      jsonPost(
        "/instances/register",
        { public_key: '{"kty":"OKP","crv":"Ed25519","x":"test-key"}' },
        "not.a.valid.jwt"
      )
    );

    // Assert
    expect(response.status).toBe(401);
  });
});

describe("POST /instances/register — validation errors", () => {
  it("returns 400 when public_key is missing", async () => {
    // Arrange
    const token = await makeUserToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/register", {}, token)
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 when public_key is an empty string", async () => {
    // Arrange
    const token = await makeUserToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "" }, token)
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 when public_key is whitespace only", async () => {
    // Arrange
    const token = await makeUserToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "   " }, token)
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns error code BAD_REQUEST when public_key is missing", async () => {
    // Arrange
    const token = await makeUserToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/register", { kronus_version: "5.3.0" }, token)
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });
});

// ---------------------------------------------------------------------------
// POST /instances/heartbeat
// ---------------------------------------------------------------------------

describe("POST /instances/heartbeat — happy path", () => {
  it("returns 200 with status 'ok' when authenticated with instance-scoped token", async () => {
    // Arrange — instance-scoped token carries instance_id
    const token = await makeInstanceToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/heartbeat", {}, token)
    );

    // Assert
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
  });

  it("response body includes a timestamp ISO string", async () => {
    // Arrange
    const token = await makeInstanceToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/heartbeat", {}, token)
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert — timestamp should be a parseable ISO 8601 date string
    expect(typeof body["timestamp"]).toBe("string");
    const parsed = new Date(body["timestamp"] as string);
    expect(isNaN(parsed.getTime())).toBe(false);
  });

  it("accepts optional kronus_version field without error", async () => {
    // Arrange
    const token = await makeInstanceToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/heartbeat", { kronus_version: "5.3.1" }, token)
    );

    // Assert
    expect(response.status).toBe(200);
  });
});

describe("POST /instances/heartbeat — auth failures", () => {
  it("returns 401 without Authorization header", async () => {
    // Act
    const response = await app.request(
      jsonPost("/instances/heartbeat", {})
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns 400 when token has no instance_id claim", async () => {
    // Arrange — plain user token without instance_id
    const token = await makeUserToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/heartbeat", {}, token)
    );

    // Assert — route requires instance-scoped token
    expect(response.status).toBe(400);
  });

  it("returns error code BAD_REQUEST when token has no instance_id", async () => {
    // Arrange
    const token = await makeUserToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/heartbeat", {}, token)
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });
});

describe("POST /instances/heartbeat — validation errors", () => {
  it("returns 400 when kronus_version is not a string", async () => {
    // Arrange
    const token = await makeInstanceToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/heartbeat", { kronus_version: 530 }, token)
    );

    // Assert
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// DELETE /instances/:id
// ---------------------------------------------------------------------------

describe("DELETE /instances/:id — happy path", () => {
  it("returns 204 when the authenticated user deletes their own instance", async () => {
    // Arrange — delete returns the deleted row (ownership check passes)
    const token = await makeUserToken();
    mockDeleteReturns([{ id: TEST_INSTANCE_ID }]);

    // Act
    const response = await app.request(
      deleteRequest(`/instances/${TEST_INSTANCE_ID}`, token)
    );

    // Assert
    expect(response.status).toBe(204);
  });

  it("response body is empty on 204", async () => {
    // Arrange
    const token = await makeUserToken();
    mockDeleteReturns([{ id: TEST_INSTANCE_ID }]);

    // Act
    const response = await app.request(
      deleteRequest(`/instances/${TEST_INSTANCE_ID}`, token)
    );
    const text = await response.text();

    // Assert — 204 must have no body
    expect(text).toBe("");
  });
});

describe("DELETE /instances/:id — not found", () => {
  it("returns 404 when instance does not exist or belongs to another user", async () => {
    // Arrange — delete returns empty array (no rows matched WHERE id AND user_id)
    const token = await makeUserToken();
    mockDeleteReturns([]);

    // Act
    const response = await app.request(
      deleteRequest("/instances/krn_inst_nonexistent", token)
    );

    // Assert — route treats both "not found" and "wrong owner" as 404
    // to avoid revealing instance existence to other users
    expect(response.status).toBe(404);
  });

  it("returns error code NOT_FOUND when delete returns no rows", async () => {
    // Arrange
    const token = await makeUserToken();
    mockDeleteReturns([]);

    // Act
    const response = await app.request(
      deleteRequest("/instances/krn_inst_nonexistent", token)
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });
});

describe("DELETE /instances/:id — auth failures", () => {
  it("returns 401 without Authorization header", async () => {
    // Act
    const response = await app.request(
      deleteRequest(`/instances/${TEST_INSTANCE_ID}`)
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns 401 with an invalid token", async () => {
    // Act
    const response = await app.request(
      deleteRequest(`/instances/${TEST_INSTANCE_ID}`, "bad.token.here")
    );

    // Assert
    expect(response.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Error response shape — instances routes
// ---------------------------------------------------------------------------

describe("error response shape — instances routes", () => {
  it("400 response has error.code and error.message fields", async () => {
    // Arrange — trigger 400 by omitting public_key
    const token = await makeUserToken();

    // Act
    const response = await app.request(
      jsonPost("/instances/register", {}, token)
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error).toBeDefined();
    expect(typeof body.error["code"]).toBe("string");
    expect(typeof body.error["message"]).toBe("string");
  });

  it("401 response has error.code UNAUTHORIZED", async () => {
    // Act — no auth header
    const response = await app.request(
      jsonPost("/instances/register", { public_key: "key" })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("UNAUTHORIZED");
  });

  it("404 response has error.code NOT_FOUND", async () => {
    // Arrange
    const token = await makeUserToken();
    mockDeleteReturns([]);

    // Act
    const response = await app.request(
      deleteRequest("/instances/krn_inst_gone", token)
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });
});
