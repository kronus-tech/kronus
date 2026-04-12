// admin.test.ts — Integration tests for the Admin API routes
//
// Strategy: use Hono's app.request() test helper with the real app instance.
// The db module is mocked via Bun's mock.module() so no real Postgres connection
// is required. The config module is also mocked so the ADMIN_API_KEY can be
// toggled between tests (the real getConfig() is a frozen singleton).
//
// The metrics route makes 7 sequential db.select() calls (users, instances,
// apps × 4 statuses, usage_events). A FIFO _selectQueue is used for those
// tests; single-call tests use a simpler _selectReturn.
//
// developer.ts exports validateManifest and checkMcpCompliance which admin.ts
// re-uses for approval. Both are mocked via mock.module so approval tests can
// simulate pass and fail without touching real MCP servers or running manifest
// validation.
//
// IMPORTANT: process.env vars and mock.module() calls must precede all static
// imports. Bun resolves static imports after top-level module code runs.

// ---------------------------------------------------------------------------
// 1. Set required env vars — must be first
// ---------------------------------------------------------------------------

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";
process.env["ADMIN_API_KEY"] = "test-admin-key-12345";

// ---------------------------------------------------------------------------
// 2. Mock the config module so ADMIN_API_KEY can be toggled per-test
// ---------------------------------------------------------------------------

import { mock } from "bun:test";

// Mutable config that can be overridden per test
const _mockConfigState = {
  ADMIN_API_KEY: "test-admin-key-12345" as string | undefined,
};

mock.module("../../src/lib/config.js", () => ({
  getConfig: () => ({
    PORT: 3100,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://user:pass@localhost:5432/kronus_test",
    REDIS_URL: "redis://localhost:6379",
    HUB_URL: "http://localhost:3100",
    RELAY_URL: "ws://localhost:3100",
    JWT_PRIVATE_KEY: undefined,
    JWT_PUBLIC_KEY: undefined,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    ADMIN_API_KEY: _mockConfigState.ADMIN_API_KEY,
  }),
  loadConfig: () => ({
    PORT: 3100,
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: "postgres://user:pass@localhost:5432/kronus_test",
    REDIS_URL: "redis://localhost:6379",
    HUB_URL: "http://localhost:3100",
    RELAY_URL: "ws://localhost:3100",
    JWT_PRIVATE_KEY: undefined,
    JWT_PUBLIC_KEY: undefined,
    STRIPE_SECRET_KEY: undefined,
    STRIPE_WEBHOOK_SECRET: undefined,
    ADMIN_API_KEY: _mockConfigState.ADMIN_API_KEY,
  }),
  config: {
    get: () => ({
      ADMIN_API_KEY: _mockConfigState.ADMIN_API_KEY,
    }),
  },
}));

// ---------------------------------------------------------------------------
// 3. Mock the db module — no real Postgres connection needed
// ---------------------------------------------------------------------------

type MockRow = Record<string, unknown>;

// Single-return for simple tests (single db.select chain)
let _selectReturn: MockRow[] = [];

// FIFO queue for routes that make multiple sequential select calls (metrics: 7)
let _selectQueue: MockRow[][] = [];

// Update stub — admin routes do db.update().set().where() with no return used
const mockUpdateBuilder = {
  set: () => mockUpdateBuilder,
  where: () => Promise.resolve(),
};

// Fluent builder stubs for SELECT
// If _selectQueue is non-empty, shift the next batch; otherwise fall back to
// _selectReturn. This lets simple tests ignore the queue entirely.
function nextSelect(): Promise<MockRow[]> {
  if (_selectQueue.length > 0) {
    return Promise.resolve(_selectQueue.shift()!);
  }
  return Promise.resolve(_selectReturn);
}

const mockSelectBuilder: Record<string, unknown> = {
  from: () => mockSelectBuilder,
  where: () => mockSelectBuilder,
  limit: () => nextSelect(),
  then: (resolve: (v: MockRow[]) => void, reject?: (e: unknown) => void) => {
    return nextSelect().then(resolve, reject);
  },
};

const mockDb = {
  select: (_fields?: unknown) => mockSelectBuilder,
  update: (_table?: unknown) => mockUpdateBuilder,
};

mock.module("../../src/db/index.js", () => ({
  db: mockDb,
}));

// ---------------------------------------------------------------------------
// 4. Mock developer.ts exports used by admin approve route
// ---------------------------------------------------------------------------

// Mutable state controlling whether validation/compliance passes or fails
const _mockDeveloper = {
  validateManifestShouldThrow: false,
  validateManifestError: "Invalid manifest",
  checkMcpComplianceShouldThrow: false,
  checkMcpComplianceError: "MCP server did not respond to tools/list",
};

mock.module("../../src/routes/developer.js", () => ({
  validateManifest: (raw: unknown) => {
    if (_mockDeveloper.validateManifestShouldThrow) {
      throw new Error(_mockDeveloper.validateManifestError);
    }
    // Return the manifest as-is for happy-path tests
    return raw;
  },
  checkMcpCompliance: async (_url: string): Promise<void> => {
    if (_mockDeveloper.checkMcpComplianceShouldThrow) {
      throw new Error(_mockDeveloper.checkMcpComplianceError);
    }
  },
}));

// ---------------------------------------------------------------------------
// 5. Mock redis — required by relay/metering and other transitive imports
// ---------------------------------------------------------------------------

mock.module("../../src/lib/redis.js", () => ({
  getRedis: () => ({
    get: () => Promise.resolve(null),
    set: () => Promise.resolve("OK"),
    setex: () => Promise.resolve("OK"),
    incr: () => Promise.resolve(1),
    expire: () => Promise.resolve(1),
    del: () => Promise.resolve(1),
    pipeline: () => ({
      incr: () => ({}),
      expire: () => ({}),
      exec: () => Promise.resolve([]),
    }),
  }),
  closeRedis: () => Promise.resolve(),
}));

// ---------------------------------------------------------------------------
// 6. Static imports — safe after env vars and mocks are in place
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { app } from "../../src/index.js";
import { initializeKeys } from "../../src/auth/jwt.js";

// ---------------------------------------------------------------------------
// 7. Helper factories and fixtures
// ---------------------------------------------------------------------------

/** Build a Request with the admin key header pre-set */
function adminRequest(method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = { "X-Admin-Key": "test-admin-key-12345" };
  if (body) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Build a Request without an admin key header */
function unauthRequest(method: string, path: string, body?: unknown): Request {
  const headers: Record<string, string> = {};
  if (body) headers["Content-Type"] = "application/json";
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

interface MockApp {
  id: string;
  slug: string;
  name: string;
  type: string;
  developer_id: string;
  status: string;
  developer_mcp_url: string | null;
  manifest_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function makeApp(overrides: Partial<MockApp> = {}): MockApp {
  return {
    id: "krn_app_test000001",
    slug: "test-app",
    name: "Test App",
    type: "local_skill",
    developer_id: "krn_usr_dev0000001",
    status: "review",
    developer_mcp_url: null,
    manifest_json: {
      name: "test-app",
      display_name: "Test App",
      version: "1.0.0",
      description: "A test application",
      type: "local_skill",
    },
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Helper: configure what the next db.select().from().where().limit() call returns */
function mockSelectReturns(rows: MockRow[]): void {
  _selectReturn = rows;
}

/** Helper: enqueue multiple return batches for routes with sequential selects */
function mockSelectQueue(batches: MockRow[][]): void {
  _selectQueue = batches;
}

// ---------------------------------------------------------------------------
// 8. Global setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();
});

beforeEach(() => {
  // Reset all mock state to clean defaults
  _selectReturn = [];
  _selectQueue = [];
  _mockConfigState.ADMIN_API_KEY = "test-admin-key-12345";
  _mockDeveloper.validateManifestShouldThrow = false;
  _mockDeveloper.validateManifestError = "Invalid manifest";
  _mockDeveloper.checkMcpComplianceShouldThrow = false;
  _mockDeveloper.checkMcpComplianceError = "MCP server did not respond to tools/list";
});

afterEach(() => {
  // Restore the admin key after any test that removes it
  _mockConfigState.ADMIN_API_KEY = "test-admin-key-12345";
});

// ---------------------------------------------------------------------------
// requireAdmin middleware
// ---------------------------------------------------------------------------

describe("requireAdmin middleware", () => {
  it("returns 401 when X-Admin-Key header is missing", async () => {
    // Arrange — GET /admin/metrics with no auth header
    const req = unauthRequest("GET", "/admin/metrics");

    // Act
    const response = await app.request(req);

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns error code ADMIN_UNAUTHORIZED when X-Admin-Key is missing", async () => {
    // Arrange
    const req = unauthRequest("GET", "/admin/metrics");

    // Act
    const response = await app.request(req);
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("ADMIN_UNAUTHORIZED");
  });

  it("returns 401 when X-Admin-Key has the wrong value", async () => {
    // Arrange
    const req = new Request("http://localhost/admin/metrics", {
      method: "GET",
      headers: { "X-Admin-Key": "wrong-key-000000" },
    });

    // Act
    const response = await app.request(req);

    // Assert
    expect(response.status).toBe(401);
  });

  it("returns error code ADMIN_UNAUTHORIZED when X-Admin-Key is wrong", async () => {
    // Arrange
    const req = new Request("http://localhost/admin/metrics", {
      method: "GET",
      headers: { "X-Admin-Key": "wrong-key-000000" },
    });

    // Act
    const response = await app.request(req);
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("ADMIN_UNAUTHORIZED");
  });

  it("returns 200 on GET /admin/metrics when the correct X-Admin-Key is provided", async () => {
    // Arrange — 7 sequential select calls for metrics, each returning count 0
    const zeroCount = [{ count: 0 }];
    mockSelectQueue([
      zeroCount, // users
      zeroCount, // instances
      zeroCount, // apps published
      zeroCount, // apps review
      zeroCount, // apps degraded
      zeroCount, // apps offline
      zeroCount, // usage_events
    ]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));

    // Assert — correct key should pass the middleware and reach the route handler
    expect(response.status).toBe(200);
  });

  it("returns 503 when ADMIN_API_KEY is not configured in environment", async () => {
    // Arrange — remove the admin key from the mock config
    _mockConfigState.ADMIN_API_KEY = undefined;

    // Act — even a correct key must fail when the server has no key configured
    const response = await app.request(adminRequest("GET", "/admin/metrics"));

    // Assert
    expect(response.status).toBe(503);
  });

  it("returns error code ADMIN_DISABLED when ADMIN_API_KEY is not set", async () => {
    // Arrange
    _mockConfigState.ADMIN_API_KEY = undefined;

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("ADMIN_DISABLED");
  });
});

// ---------------------------------------------------------------------------
// GET /admin/apps/review
// ---------------------------------------------------------------------------

describe("GET /admin/apps/review", () => {
  it("returns 200 with apps array containing apps in review status", async () => {
    // Arrange — two apps pending review
    const app1 = makeApp({ id: "krn_app_review00001", slug: "app-one", status: "review" });
    const app2 = makeApp({ id: "krn_app_review00002", slug: "app-two", status: "review" });
    mockSelectReturns([app1, app2]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/apps/review"));
    const body = await response.json() as { apps: MockApp[] };

    // Assert
    expect(response.status).toBe(200);
    expect(Array.isArray(body.apps)).toBe(true);
    expect(body.apps.length).toBe(2);
  });

  it("returns the correct app IDs and slugs for apps in review", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_review00003", slug: "my-review-app" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/apps/review"));
    const body = await response.json() as { apps: MockApp[] };

    // Assert
    expect(body.apps[0]!["id"]).toBe("krn_app_review00003");
    expect(body.apps[0]!["slug"]).toBe("my-review-app");
  });

  it("returns an empty apps array when no apps are in review", async () => {
    // Arrange — no pending apps
    mockSelectReturns([]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/apps/review"));
    const body = await response.json() as { apps: MockApp[] };

    // Assert
    expect(response.status).toBe(200);
    expect(body.apps).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /admin/apps/:id/approve
// ---------------------------------------------------------------------------

describe("POST /admin/apps/:id/approve — happy path", () => {
  it("returns 200 with approved: true for an app in review", async () => {
    // Arrange — app is in review, manifest and MCP checks pass (mocks default to pass)
    const testApp = makeApp({ id: "krn_app_approve0001", slug: "approve-me", status: "review" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0001/approve"));

    // Assert
    expect(response.status).toBe(200);
  });

  it("returns approved: true in response body", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_approve0002", slug: "approve-me-2", status: "review" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0002/approve"));
    const body = await response.json() as { approved: boolean; app: MockApp };

    // Assert
    expect(body.approved).toBe(true);
  });

  it("returns app with status 'published' after approval", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_approve0003", slug: "approve-me-3", status: "review" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0003/approve"));
    const body = await response.json() as { approved: boolean; app: MockApp };

    // Assert
    expect(body.app["status"]).toBe("published");
  });

  it("includes the app id and slug in the response", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_approve0004", slug: "approve-me-4", status: "review" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0004/approve"));
    const body = await response.json() as { approved: boolean; app: MockApp };

    // Assert
    expect(body.app["id"]).toBe("krn_app_approve0004");
    expect(body.app["slug"]).toBe("approve-me-4");
  });
});

describe("POST /admin/apps/:id/approve — rejection cases", () => {
  it("returns 400 when app exists but is not in review status", async () => {
    // Arrange — app is published, not in review
    const testApp = makeApp({ id: "krn_app_approve0005", slug: "already-published", status: "published" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0005/approve"));

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns error code BAD_REQUEST when app is not in review", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_approve0006", slug: "bad-status", status: "draft" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0006/approve"));
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });

  it("returns 404 when app does not exist", async () => {
    // Arrange — db returns no rows
    mockSelectReturns([]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_nonexistent/approve"));

    // Assert
    expect(response.status).toBe(404);
  });

  it("returns error code NOT_FOUND when app does not exist", async () => {
    // Arrange
    mockSelectReturns([]);

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_nonexistent/approve"));
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });

  it("returns 422 with approved: false when MCP compliance check fails for developer_mcp app", async () => {
    // Arrange — developer_mcp app in review, but MCP compliance check throws
    const testApp = makeApp({
      id: "krn_app_approve0007",
      slug: "bad-mcp-app",
      status: "review",
      type: "developer_mcp",
      developer_mcp_url: "https://mcp.example.com/server",
    });
    mockSelectReturns([testApp]);
    _mockDeveloper.checkMcpComplianceShouldThrow = true;
    _mockDeveloper.checkMcpComplianceError = "MCP server did not respond to tools/list";

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0007/approve"));
    const body = await response.json() as { approved: boolean; reason: string };

    // Assert
    expect(response.status).toBe(422);
    expect(body.approved).toBe(false);
  });

  it("returns a reason string when MCP compliance check fails", async () => {
    // Arrange
    const testApp = makeApp({
      id: "krn_app_approve0008",
      slug: "bad-mcp-app-2",
      status: "review",
      type: "developer_mcp",
      developer_mcp_url: "https://mcp.example.com/server2",
    });
    mockSelectReturns([testApp]);
    _mockDeveloper.checkMcpComplianceShouldThrow = true;
    _mockDeveloper.checkMcpComplianceError = "Connection refused";

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0008/approve"));
    const body = await response.json() as { approved: boolean; reason: string };

    // Assert
    expect(typeof body.reason).toBe("string");
    expect(body.reason).toContain("Connection refused");
  });

  it("returns 422 with approved: false when manifest validation fails", async () => {
    // Arrange — any app type in review, but manifest validation throws
    const testApp = makeApp({
      id: "krn_app_approve0009",
      slug: "bad-manifest-app",
      status: "review",
    });
    mockSelectReturns([testApp]);
    _mockDeveloper.validateManifestShouldThrow = true;
    _mockDeveloper.validateManifestError = "name is required";

    // Act
    const response = await app.request(adminRequest("POST", "/admin/apps/krn_app_approve0009/approve"));
    const body = await response.json() as { approved: boolean; reason: string };

    // Assert
    expect(response.status).toBe(422);
    expect(body.approved).toBe(false);
    expect(body.reason).toContain("name is required");
  });
});

// ---------------------------------------------------------------------------
// POST /admin/apps/:id/reject
// ---------------------------------------------------------------------------

describe("POST /admin/apps/:id/reject — happy path", () => {
  it("returns 200 with app status set to 'draft'", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_reject00001", slug: "reject-me", status: "review" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_reject00001/reject", { reason: "Violates ToS" })
    );
    const body = await response.json() as { app: MockApp; feedback: string };

    // Assert
    expect(response.status).toBe(200);
    expect(body.app["status"]).toBe("draft");
  });

  it("returns the app id and slug in the response body", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_reject00002", slug: "reject-me-2", status: "review" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_reject00002/reject", { reason: "Missing docs" })
    );
    const body = await response.json() as { app: MockApp; feedback: string };

    // Assert
    expect(body.app["id"]).toBe("krn_app_reject00002");
    expect(body.app["slug"]).toBe("reject-me-2");
  });

  it("returns the provided rejection reason as feedback", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_reject00003", slug: "reject-me-3" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_reject00003/reject", { reason: "Security vulnerabilities found" })
    );
    const body = await response.json() as { app: MockApp; feedback: string };

    // Assert
    expect(body.feedback).toBe("Security vulnerabilities found");
  });

  it("uses a default feedback message when no reason is provided", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_reject00004", slug: "reject-me-4" });
    mockSelectReturns([testApp]);

    // Act — send an empty body (no reason field)
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_reject00004/reject", {})
    );
    const body = await response.json() as { app: MockApp; feedback: string };

    // Assert — route falls back to "No reason provided"
    expect(typeof body.feedback).toBe("string");
    expect(body.feedback.length).toBeGreaterThan(0);
  });

  it("can reject an app regardless of its current status", async () => {
    // Arrange — app is in published status (not just review)
    const testApp = makeApp({ id: "krn_app_reject00005", slug: "reject-published", status: "published" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_reject00005/reject", { reason: "Policy change" })
    );

    // Assert — reject route has no status guard, any app can be rejected
    expect(response.status).toBe(200);
  });
});

describe("POST /admin/apps/:id/reject — not found", () => {
  it("returns 404 when the app does not exist", async () => {
    // Arrange
    mockSelectReturns([]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_nonexistent/reject", { reason: "Fake" })
    );

    // Assert
    expect(response.status).toBe(404);
  });

  it("returns error code NOT_FOUND when app does not exist", async () => {
    // Arrange
    mockSelectReturns([]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_nonexistent/reject", { reason: "Fake" })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// POST /admin/apps/:id/suspend
// ---------------------------------------------------------------------------

describe("POST /admin/apps/:id/suspend — happy path", () => {
  it("returns 200 with app status 'suspended' for a published app", async () => {
    // Arrange — published app can be suspended
    const testApp = makeApp({ id: "krn_app_suspend0001", slug: "suspend-me", status: "published" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_suspend0001/suspend", { reason: "Terms violation" })
    );
    const body = await response.json() as { app: MockApp };

    // Assert
    expect(response.status).toBe(200);
    expect(body.app["status"]).toBe("suspended");
  });

  it("returns app id and slug in the response body", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_suspend0002", slug: "suspend-me-2", status: "published" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_suspend0002/suspend", { reason: "Spam" })
    );
    const body = await response.json() as { app: MockApp };

    // Assert
    expect(body.app["id"]).toBe("krn_app_suspend0002");
    expect(body.app["slug"]).toBe("suspend-me-2");
  });

  it("returns 200 with status 'suspended' for a degraded app", async () => {
    // Arrange — degraded apps can also be suspended
    const testApp = makeApp({ id: "krn_app_suspend0003", slug: "suspend-degraded", status: "degraded" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_suspend0003/suspend", { reason: "Repeated failures" })
    );
    const body = await response.json() as { app: MockApp };

    // Assert
    expect(response.status).toBe(200);
    expect(body.app["status"]).toBe("suspended");
  });

  it("accepts a suspend request without a reason body field", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_suspend0004", slug: "suspend-no-reason", status: "published" });
    mockSelectReturns([testApp]);

    // Act — body has no reason field; route treats reason as undefined
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_suspend0004/suspend", {})
    );

    // Assert
    expect(response.status).toBe(200);
  });
});

describe("POST /admin/apps/:id/suspend — rejection cases", () => {
  it("returns 400 when app is in draft status (not published or degraded)", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_suspend0005", slug: "cant-suspend-draft", status: "draft" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_suspend0005/suspend", { reason: "Testing" })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns 400 when app is in review status", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_suspend0006", slug: "cant-suspend-review", status: "review" });
    mockSelectReturns([testApp]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_suspend0006/suspend", { reason: "Testing" })
    );

    // Assert
    expect(response.status).toBe(400);
  });

  it("returns error code BAD_REQUEST when suspend is not permitted for the app status", async () => {
    // Arrange
    const testApp = makeApp({ id: "krn_app_suspend0007", slug: "bad-status-app", status: "suspended" });
    mockSelectReturns([testApp]);

    // Act — app is already suspended; status is not published or degraded
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_suspend0007/suspend", { reason: "Testing" })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });

  it("returns 404 when the app does not exist", async () => {
    // Arrange
    mockSelectReturns([]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_nonexistent/suspend", { reason: "Testing" })
    );

    // Assert
    expect(response.status).toBe(404);
  });

  it("returns error code NOT_FOUND when app does not exist", async () => {
    // Arrange
    mockSelectReturns([]);

    // Act
    const response = await app.request(
      adminRequest("POST", "/admin/apps/krn_app_nonexistent/suspend", { reason: "Testing" })
    );
    const body = await response.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// GET /admin/metrics
// ---------------------------------------------------------------------------

describe("GET /admin/metrics", () => {
  it("returns 200 with all metric fields", async () => {
    // Arrange — 7 sequential selects: users, instances, apps × 4, usage_events
    mockSelectQueue([
      [{ count: 42 }],  // total_users
      [{ count: 15 }],  // total_instances
      [{ count: 8 }],   // total_apps_published
      [{ count: 3 }],   // apps_pending_review
      [{ count: 1 }],   // apps_degraded
      [{ count: 0 }],   // apps_offline
      [{ count: 200 }], // total_mcp_calls
    ]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));

    // Assert
    expect(response.status).toBe(200);
  });

  it("returns total_users as a number", async () => {
    // Arrange
    mockSelectQueue([
      [{ count: 42 }],
      [{ count: 15 }],
      [{ count: 8 }],
      [{ count: 3 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ count: 200 }],
    ]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["total_users"]).toBe("number");
    expect(body["total_users"]).toBe(42);
  });

  it("returns total_instances as a number", async () => {
    // Arrange
    mockSelectQueue([
      [{ count: 42 }],
      [{ count: 15 }],
      [{ count: 8 }],
      [{ count: 3 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ count: 200 }],
    ]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["total_instances"]).toBe("number");
    expect(body["total_instances"]).toBe(15);
  });

  it("returns total_apps_published as a number", async () => {
    // Arrange
    mockSelectQueue([
      [{ count: 42 }],
      [{ count: 15 }],
      [{ count: 8 }],
      [{ count: 3 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ count: 200 }],
    ]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["total_apps_published"]).toBe("number");
    expect(body["total_apps_published"]).toBe(8);
  });

  it("returns apps_pending_review as a number", async () => {
    // Arrange
    mockSelectQueue([
      [{ count: 42 }],
      [{ count: 15 }],
      [{ count: 8 }],
      [{ count: 3 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ count: 200 }],
    ]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["apps_pending_review"]).toBe("number");
    expect(body["apps_pending_review"]).toBe(3);
  });

  it("returns apps_degraded, apps_offline, and total_mcp_calls as numbers", async () => {
    // Arrange
    mockSelectQueue([
      [{ count: 42 }],
      [{ count: 15 }],
      [{ count: 8 }],
      [{ count: 3 }],
      [{ count: 1 }],
      [{ count: 0 }],
      [{ count: 200 }],
    ]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));
    const body = await response.json() as Record<string, unknown>;

    // Assert — verify the remaining fields are all numbers
    expect(typeof body["apps_degraded"]).toBe("number");
    expect(typeof body["apps_offline"]).toBe("number");
    expect(typeof body["total_mcp_calls"]).toBe("number");
    expect(body["apps_degraded"]).toBe(1);
    expect(body["apps_offline"]).toBe(0);
    expect(body["total_mcp_calls"]).toBe(200);
  });

  it("returns 0 for all metrics when database has no rows", async () => {
    // Arrange — all counts come back as 0
    const zero = [{ count: 0 }];
    mockSelectQueue([zero, zero, zero, zero, zero, zero, zero]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/metrics"));
    const body = await response.json() as Record<string, number>;

    // Assert — 0 is a valid number; route should not error on empty database
    expect(response.status).toBe(200);
    expect(body["total_users"]).toBe(0);
    expect(body["total_mcp_calls"]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// GET /admin/health
// ---------------------------------------------------------------------------

describe("GET /admin/health", () => {
  it("returns 200 with an apps array", async () => {
    // Arrange — mix of non-draft apps
    const appList = [
      { slug: "alpha", status: "published", developer_mcp_url: null, last_updated: "2026-01-01T00:00:00Z" },
      { slug: "beta", status: "degraded", developer_mcp_url: "https://mcp.beta.dev/mcp", last_updated: "2026-01-02T00:00:00Z" },
    ];
    mockSelectReturns(appList);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/health"));

    // Assert
    expect(response.status).toBe(200);
  });

  it("returns an apps array containing all non-draft apps", async () => {
    // Arrange
    const appList = [
      { slug: "alpha", status: "published", developer_mcp_url: null, last_updated: "2026-01-01T00:00:00Z" },
      { slug: "beta", status: "review", developer_mcp_url: null, last_updated: "2026-01-02T00:00:00Z" },
      { slug: "gamma", status: "degraded", developer_mcp_url: "https://mcp.gamma.dev", last_updated: "2026-01-03T00:00:00Z" },
    ];
    mockSelectReturns(appList);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/health"));
    const body = await response.json() as { apps: typeof appList };

    // Assert
    expect(Array.isArray(body.apps)).toBe(true);
    expect(body.apps.length).toBe(3);
  });

  it("includes status field on each app in the response", async () => {
    // Arrange
    const appList = [
      { slug: "alpha", status: "published", developer_mcp_url: null, last_updated: "2026-01-01T00:00:00Z" },
    ];
    mockSelectReturns(appList);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/health"));
    const body = await response.json() as { apps: Array<Record<string, unknown>> };

    // Assert — each app must expose its status so the health dashboard can render it
    expect(body.apps[0]!["status"]).toBe("published");
  });

  it("includes developer_mcp_url field on each app in the response", async () => {
    // Arrange
    const appList = [
      { slug: "mcp-app", status: "published", developer_mcp_url: "https://mcp.example.com", last_updated: "2026-01-01T00:00:00Z" },
    ];
    mockSelectReturns(appList);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/health"));
    const body = await response.json() as { apps: Array<Record<string, unknown>> };

    // Assert
    expect(body.apps[0]!["developer_mcp_url"]).toBe("https://mcp.example.com");
  });

  it("returns an empty apps array when all apps are in draft status (filtered out)", async () => {
    // Arrange — query returns nothing (all apps were draft, excluded by WHERE clause)
    mockSelectReturns([]);

    // Act
    const response = await app.request(adminRequest("GET", "/admin/health"));
    const body = await response.json() as { apps: unknown[] };

    // Assert
    expect(response.status).toBe(200);
    expect(body.apps).toEqual([]);
  });
});
