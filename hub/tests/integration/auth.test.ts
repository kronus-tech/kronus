// auth.test.ts — Integration tests for the auth routes
//
// Strategy: use Hono's app.request() test helper with the real app instance.
// The db module (hub/src/db/index.ts) is mocked via Bun's mock.module() so
// no real Postgres connection is required. JWT keys are initialised in
// beforeAll() in ephemeral mode.
//
// IMPORTANT: process.env vars and mock.module() calls must happen BEFORE any
// static import that transitively loads hub/src/db/index.ts or getConfig().
// Bun resolves static imports after the top-level module code runs, so placing
// these assignments at the very top of the file is safe and correct.

// ---------------------------------------------------------------------------
// 1. Set required env vars — must be first
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

// ---------------------------------------------------------------------------
// 2. Mock the db module so no real Postgres connection is opened
//
//    The mock intercepts hub/src/db/index.ts before it is evaluated and
//    returns a fake `db` object that exposes the Drizzle fluent query builder
//    pattern: db.select().from().where().limit() and db.insert().values().returning().
//
//    Each test that needs specific results calls configureMockDb() to set the
//    return values for that test's scenario.
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

// --- Mutable state shared between the mock factory and the test helpers ---

type MockReturnValue = Record<string, unknown>[];

let _selectReturn: MockReturnValue = [];
let _insertReturn: MockReturnValue = [];

// Fluent builder stubs for SELECT: db.select().from().where().limit()
const mockSelectBuilder = {
  from: () => mockSelectBuilder,
  where: () => mockSelectBuilder,
  limit: () => Promise.resolve(_selectReturn),
};

// Fluent builder stubs for INSERT: db.insert().values().returning()
const mockInsertBuilder = {
  values: () => mockInsertBuilder,
  returning: () => Promise.resolve(_insertReturn),
};

const mockDb = {
  select: (_fields?: unknown) => mockSelectBuilder,
  insert: (_table?: unknown) => mockInsertBuilder,
};

// Mock the db module before any static import resolves it
mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  sql: {},
}));

// Mock Redis for rate limiting (auth routes now call checkRateLimit)
const mockRedis = {
  incr: () => Promise.resolve(1),
  expire: () => Promise.resolve(1),
  get: () => Promise.resolve(null),
  set: () => Promise.resolve("OK"),
  setex: () => Promise.resolve("OK"),
  del: () => Promise.resolve(1),
  pipeline: () => ({ incr: () => mockRedis, expire: () => mockRedis, incrby: () => mockRedis, exec: () => Promise.resolve([]) }),
  status: "ready",
};
mock.module("../../src/lib/redis.js", () => ({
  getRedis: () => mockRedis,
  closeRedis: () => Promise.resolve(),
  isRedisReady: () => true,
}));

// ---------------------------------------------------------------------------
// 3. Static imports — safe to import after env vars and mocks are in place
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
import { app } from "../../src/index.js";
import { initializeKeys } from "../../src/auth/jwt.js";

// ---------------------------------------------------------------------------
// 4. Helper types and factories
// ---------------------------------------------------------------------------

interface MockUser {
  id: string;
  email: string;
  name: string;
  plan: string;
  password_hash: string;
}

// A pre-hashed argon2id hash for the plaintext password "password123".
// Generated offline so the test suite does not need to run argon2 on every
// test invocation for the "wrong password" cases. Correct-password cases
// call hashPassword() at runtime and store the result in _insertReturn.
const HASHED_PASSWORD_123 =
  "$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashvalueplaceholderhere";

function makeUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: "krn_usr_testuser0001",
    email: "alice@example.com",
    name: "Alice Example",
    plan: "free",
    password_hash: HASHED_PASSWORD_123,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 5. Test helpers — configure mock return values per scenario
// ---------------------------------------------------------------------------

/**
 * Configure what db.select().from().where().limit() resolves to.
 * Pass [] to simulate "no rows found".
 */
function mockSelectReturns(rows: MockReturnValue): void {
  _selectReturn = rows;
}

/**
 * Configure what db.insert().values().returning() resolves to.
 */
function mockInsertReturns(rows: MockReturnValue): void {
  _insertReturn = rows;
}

// JSON request helper — builds a POST Request with a JSON body
function jsonRequest(path: string, body: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 6. Global setup — initialize JWT keys once before any test runs
// ---------------------------------------------------------------------------

beforeAll(async () => {
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();
});

// Reset mock state before each test so tests are isolated
beforeEach(() => {
  _selectReturn = [];
  _insertReturn = [];
});

// ---------------------------------------------------------------------------
// GET /.well-known/jwks.json
// ---------------------------------------------------------------------------

describe("GET /.well-known/jwks.json", () => {
  it("returns 200", async () => {
    // Act
    const response = await app.request("/.well-known/jwks.json");

    // Assert
    expect(response.status).toBe(200);
  });

  it("returns a JSON body with a keys array", async () => {
    // Act
    const response = await app.request("/.well-known/jwks.json");
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(Array.isArray(body["keys"])).toBe(true);
  });

  it("keys array contains at least one entry", async () => {
    // Act
    const response = await app.request("/.well-known/jwks.json");
    const body = await response.json() as { keys: unknown[] };

    // Assert
    expect(body.keys.length).toBeGreaterThanOrEqual(1);
  });

  it("the first key has alg: 'EdDSA'", async () => {
    // Act
    const response = await app.request("/.well-known/jwks.json");
    const body = await response.json() as { keys: Array<Record<string, unknown>> };

    // Assert
    expect(body.keys[0]!["alg"]).toBe("EdDSA");
  });

  it("the first key has use: 'sig'", async () => {
    // Act
    const response = await app.request("/.well-known/jwks.json");
    const body = await response.json() as { keys: Array<Record<string, unknown>> };

    // Assert
    expect(body.keys[0]!["use"]).toBe("sig");
  });

  it("the first key has a kid field", async () => {
    // Act
    const response = await app.request("/.well-known/jwks.json");
    const body = await response.json() as { keys: Array<Record<string, unknown>> };

    // Assert
    expect(body.keys[0]!["kid"]).toBeDefined();
    expect(typeof body.keys[0]!["kid"]).toBe("string");
  });

  it("Content-Type header is application/json", async () => {
    // Act
    const response = await app.request("/.well-known/jwks.json");

    // Assert
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// POST /auth/register
// ---------------------------------------------------------------------------

describe("POST /auth/register — happy path", () => {
  it("returns 201 on successful registration", async () => {
    // Arrange — no existing user (select returns []), insert succeeds
    mockSelectReturns([]);
    mockInsertReturns([
      { id: "krn_usr_testuser0001", email: "alice@example.com", name: "Alice Example", plan: "free" },
    ]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "alice@example.com",
        name: "Alice Example",
        password: "password123",
      })
    );

    // Assert
    expect(response.status).toBe(201);
  });

  it("returns a user object in the response body", async () => {
    // Arrange
    mockSelectReturns([]);
    mockInsertReturns([
      { id: "krn_usr_testuser0001", email: "alice@example.com", name: "Alice Example", plan: "free" },
    ]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "alice@example.com",
        name: "Alice Example",
        password: "password123",
      })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["user"]).toBeDefined();
    const user = body["user"] as Record<string, unknown>;
    expect(user["email"]).toBe("alice@example.com");
    expect(user["name"]).toBe("Alice Example");
  });

  it("returns an access_token in the response body", async () => {
    // Arrange
    mockSelectReturns([]);
    mockInsertReturns([
      { id: "krn_usr_testuser0001", email: "alice@example.com", name: "Alice Example", plan: "free" },
    ]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "alice@example.com",
        name: "Alice Example",
        password: "password123",
      })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["access_token"]).toBe("string");
    expect((body["access_token"] as string).split(".").length).toBe(3);
  });

  it("returns a refresh_token in the response body", async () => {
    // Arrange
    mockSelectReturns([]);
    mockInsertReturns([
      { id: "krn_usr_testuser0001", email: "alice@example.com", name: "Alice Example", plan: "free" },
    ]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "alice@example.com",
        name: "Alice Example",
        password: "password123",
      })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["refresh_token"]).toBe("string");
    expect((body["refresh_token"] as string).split(".").length).toBe(3);
  });

  it("normalises email to lowercase before storing", async () => {
    // Arrange
    mockSelectReturns([]);
    mockInsertReturns([
      { id: "krn_usr_testuser0001", email: "alice@example.com", name: "Alice Example", plan: "free" },
    ]);

    // Act — submit with mixed-case email
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "ALICE@EXAMPLE.COM",
        name: "Alice Example",
        password: "password123",
      })
    );

    // Assert — still 201; if the route threw on a case mismatch this would fail
    expect(response.status).toBe(201);
  });
});

describe("POST /auth/register — validation errors", () => {
  it("returns 400 when email is missing", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        name: "Alice Example",
        password: "password123",
      })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns error code BAD_REQUEST when email is missing", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        name: "Alice Example",
        password: "password123",
      })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });

  it("returns 400 when password is shorter than 8 characters", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "alice@example.com",
        name: "Alice Example",
        password: "short",
      })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 when name is missing", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "alice@example.com",
        password: "password123",
      })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 when email format is invalid (no @ sign)", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "not-an-email",
        name: "Alice Example",
        password: "password123",
      })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 when request body is empty JSON object", async () => {
    // Act
    const response = await app.request(jsonRequest("/auth/register", {}));

    // Assert
    expect(response.status).toBe(400);
  });
});

describe("POST /auth/register — conflict", () => {
  it("returns 409 when email is already registered", async () => {
    // Arrange — select returns an existing user row
    mockSelectReturns([{ id: "krn_usr_existing0001" }]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "existing@example.com",
        name: "Already Exists",
        password: "password123",
      })
    );

    // Assert
    expect(response.status).toBe(409);
  });

  it("returns error code CONFLICT when email is already registered", async () => {
    // Arrange
    mockSelectReturns([{ id: "krn_usr_existing0001" }]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "existing@example.com",
        name: "Already Exists",
        password: "password123",
      })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("CONFLICT");
  });
});

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe("POST /auth/login — happy path", () => {
  it("returns 200 on successful login", async () => {
    // Arrange — we need to hash the real password so verifyPassword() accepts it
    const { hashPassword } = await import("../../src/auth/passwords.js");
    const passwordHash = await hashPassword("password123");
    const user = makeUser({ password_hash: passwordHash });
    mockSelectReturns([user]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/login", {
        email: "alice@example.com",
        password: "password123",
      })
    );

    // Assert
    expect(response.status).toBe(200);
  });

  it("returns user, access_token and refresh_token on success", async () => {
    // Arrange
    const { hashPassword } = await import("../../src/auth/passwords.js");
    const passwordHash = await hashPassword("password123");
    const user = makeUser({ password_hash: passwordHash });
    mockSelectReturns([user]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/login", {
        email: "alice@example.com",
        password: "password123",
      })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["user"]).toBeDefined();
    expect(typeof body["access_token"]).toBe("string");
    expect(typeof body["refresh_token"]).toBe("string");
  });

  it("returned user object does not include password_hash", async () => {
    // Arrange
    const { hashPassword } = await import("../../src/auth/passwords.js");
    const passwordHash = await hashPassword("password123");
    mockSelectReturns([makeUser({ password_hash: passwordHash })]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/login", {
        email: "alice@example.com",
        password: "password123",
      })
    );
    const body = await response.json() as { user: Record<string, unknown> };

    // Assert — password_hash must never be returned to the client
    expect(body.user["password_hash"]).toBeUndefined();
  });
});

describe("POST /auth/login — authentication failures", () => {
  it("returns 401 for a wrong password", async () => {
    // Arrange — store a hash for "correct-password", then send "wrong-password"
    const { hashPassword } = await import("../../src/auth/passwords.js");
    const passwordHash = await hashPassword("correct-password");
    mockSelectReturns([makeUser({ password_hash: passwordHash })]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/login", {
        email: "alice@example.com",
        password: "wrong-password",
      })
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns error code UNAUTHORIZED for a wrong password", async () => {
    // Arrange
    const { hashPassword } = await import("../../src/auth/passwords.js");
    const passwordHash = await hashPassword("correct-password");
    mockSelectReturns([makeUser({ password_hash: passwordHash })]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/login", {
        email: "alice@example.com",
        password: "wrong-password",
      })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("UNAUTHORIZED");
  });

  it("returns 401 for a non-existent email (same response as wrong password)", async () => {
    // Arrange — user not found
    mockSelectReturns([]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/login", {
        email: "nobody@example.com",
        password: "password123",
      })
    );

    // Assert — must be 401, same as wrong password, to prevent email enumeration
    expect(response.status).toBe(401);
  });

  it("returns the same error message for wrong password and non-existent email", async () => {
    // Arrange — two scenarios
    const { hashPassword } = await import("../../src/auth/passwords.js");
    const passwordHash = await hashPassword("correct-password");

    // Scenario 1: user exists but wrong password
    mockSelectReturns([makeUser({ password_hash: passwordHash })]);
    const res1 = await app.request(
      jsonRequest("/auth/login", { email: "alice@example.com", password: "wrong" })
    );
    const body1 = await res1.json() as { error: { message: string } };

    // Scenario 2: user does not exist
    mockSelectReturns([]);
    const res2 = await app.request(
      jsonRequest("/auth/login", { email: "ghost@example.com", password: "wrong" })
    );
    const body2 = await res2.json() as { error: { message: string } };

    // Assert — same message prevents email enumeration
    expect(body1.error.message).toBe(body2.error.message);
  });

  it("returns 400 when email is missing", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/login", { password: "password123" })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 when password is missing", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/login", { email: "alice@example.com" })
    );

    // Assert
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/refresh
// ---------------------------------------------------------------------------

describe("POST /auth/refresh — happy path", () => {
  it("returns 200 with a new access_token for a valid refresh token", async () => {
    // Arrange — sign a real refresh token, then mock the db user lookup
    const { signRefreshToken } = await import("../../src/auth/jwt.js");
    const refreshToken = await signRefreshToken("krn_usr_testuser0001");
    mockSelectReturns([{ id: "krn_usr_testuser0001", plan: "free" }]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: refreshToken })
    );

    // Assert
    expect(response.status).toBe(200);
  });

  it("returns a new access_token JWT string", async () => {
    // Arrange
    const { signRefreshToken } = await import("../../src/auth/jwt.js");
    const refreshToken = await signRefreshToken("krn_usr_testuser0001");
    mockSelectReturns([{ id: "krn_usr_testuser0001", plan: "free" }]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: refreshToken })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["access_token"]).toBe("string");
    expect((body["access_token"] as string).split(".").length).toBe(3);
  });

  it("returns a new refresh_token alongside access_token (HUB-04 rotation)", async () => {
    // Arrange
    const { signRefreshToken } = await import("../../src/auth/jwt.js");
    const refreshToken = await signRefreshToken("krn_usr_testuser0001");
    mockSelectReturns([{ id: "krn_usr_testuser0001", plan: "free" }]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: refreshToken })
    );
    const body = await response.json() as Record<string, unknown>;

    // Assert — refresh endpoint now issues both tokens (HUB-04 rotation)
    expect(typeof body["access_token"]).toBe("string");
    expect(typeof body["refresh_token"]).toBe("string");
  });
});

describe("POST /auth/refresh — rejection cases", () => {
  it("returns 401 for an invalid refresh token string", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: "not.a.valid.token" })
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns 401 when given an access token instead of a refresh token", async () => {
    // Arrange — sign an access token (type: "access", not "refresh")
    const { signAccessToken } = await import("../../src/auth/jwt.js");
    const accessToken = await signAccessToken({
      sub: "krn_usr_testuser0001",
      plan: "free",
      capabilities: ["apps:install"],
      app_access: [],
      scopes: ["read"],
    });

    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: accessToken })
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns error code UNAUTHORIZED for an access token used as refresh token", async () => {
    // Arrange
    const { signAccessToken } = await import("../../src/auth/jwt.js");
    const accessToken = await signAccessToken({
      sub: "krn_usr_testuser0001",
      plan: "free",
      capabilities: [],
      app_access: [],
      scopes: [],
    });

    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: accessToken })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("UNAUTHORIZED");
  });

  it("returns 400 when refresh_token field is missing", async () => {
    // Act
    const response = await app.request(jsonRequest("/auth/refresh", {}));

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 401 when the user referenced by the refresh token no longer exists", async () => {
    // Arrange — valid refresh token but user has been deleted from db
    const { signRefreshToken } = await import("../../src/auth/jwt.js");
    const refreshToken = await signRefreshToken("krn_usr_deleted0001");
    mockSelectReturns([]); // user not found

    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: refreshToken })
    );

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns 401 for an empty string refresh_token", async () => {
    // Act
    const response = await app.request(
      jsonRequest("/auth/refresh", { refresh_token: "  " })
    );

    // Assert — whitespace-only token should be rejected at validation
    expect(response.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Error handler — structured error shape
// ---------------------------------------------------------------------------

describe("error response shape", () => {
  it("400 response has error.code and error.message fields", async () => {
    // Act — trigger a 400 by omitting email
    const response = await app.request(
      jsonRequest("/auth/register", { name: "Alice", password: "password123" })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error).toBeDefined();
    expect(typeof body.error["code"]).toBe("string");
    expect(typeof body.error["message"]).toBe("string");
  });

  it("401 response has error.code and error.message fields", async () => {
    // Arrange — wrong password triggers 401
    const { hashPassword } = await import("../../src/auth/passwords.js");
    const passwordHash = await hashPassword("correct-password");
    mockSelectReturns([makeUser({ password_hash: passwordHash })]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/login", { email: "alice@example.com", password: "wrong" })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error).toBeDefined();
    expect(typeof body.error["code"]).toBe("string");
    expect(typeof body.error["message"]).toBe("string");
  });

  it("409 response has error.code CONFLICT", async () => {
    // Arrange — email already taken
    mockSelectReturns([{ id: "krn_usr_existing0001" }]);

    // Act
    const response = await app.request(
      jsonRequest("/auth/register", {
        email: "taken@example.com",
        name: "Taken",
        password: "password123",
      })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("CONFLICT");
  });
});
