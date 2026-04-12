// developer.test.ts — Integration tests for the Developer API (/developer)
//
// Strategy: matches apps.test.ts mock pattern.
//   - process.env set first
//   - mock.module for db/index.js and redis (no real connections)
//   - globalThis.fetch intercepted per-test for MCP compliance probing
//   - app imported after mocks
//   - initializeKeys() called in beforeAll()
//
// The db mock uses a FIFO _selectQueue so sequential calls within a single
// route handler (e.g. ownership check → version uniqueness check) return
// different rows. _insertReturn and _updateReturn cover insert/update paths.

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

let _selectQueue: MockRow[][] = [];
let _insertReturn: MockRow[] = [];
let _updateReturn: MockRow[] = [];
// execute() is used for raw SQL analytics aggregation
let _executeReturn: MockRow[] = [];

function nextSelectReturn(): Promise<MockRow[]> {
  if (_selectQueue.length === 0) return Promise.resolve([]);
  return Promise.resolve(_selectQueue.shift()!);
}

const mockSelectBuilder: Record<string, unknown> = {
  from: () => mockSelectBuilder,
  where: () => mockSelectBuilder,
  limit: () => nextSelectReturn(),
  orderBy: () => mockSelectBuilder,
  then: (resolve: (v: MockRow[]) => void, reject?: (e: unknown) => void) => {
    return nextSelectReturn().then(resolve, reject);
  },
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
  execute: (_query?: unknown) => Promise.resolve(_executeReturn),
};

mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  // sql tag needed by analytics route (sql.join / sql``) — stub enough to not throw
  sql: new Proxy(
    Object.assign(
      (..._args: unknown[]) => ({ toSQL: () => ({ sql: "", params: [] }) }),
      {
        join: (..._args: unknown[]) => ({ toSQL: () => ({ sql: "", params: [] }) }),
      }
    ),
    {
      get: (target, prop) => {
        if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
        return () => ({ toSQL: () => ({ sql: "", params: [] }) });
      },
    }
  ),
}));

// --- Redis mock state ---

const _redisStore = new Map<string, string>();

const mockRedis = {
  get: (key: string) => Promise.resolve(_redisStore.get(key) ?? null),
  set: (key: string, value: string) => { _redisStore.set(key, value); return Promise.resolve("OK"); },
  setex: (key: string, _ttl: number, value: string) => { _redisStore.set(key, value); return Promise.resolve("OK"); },
  incr: (key: string) => {
    const cur = Number(_redisStore.get(key) ?? "0") + 1;
    _redisStore.set(key, String(cur));
    return Promise.resolve(cur);
  },
  expire: (_key: string, _ttl: number) => Promise.resolve(1),
  del: (key: string) => { _redisStore.delete(key); return Promise.resolve(1); },
  pipeline: () => {
    const ops: Array<() => void> = [];
    const pipe = {
      incr: (_key: string) => { ops.push(() => {}); return pipe; },
      expire: (_key: string, _ttl: number) => { ops.push(() => {}); return pipe; },
      exec: () => Promise.resolve([[null, 1], [null, 1]]),
    };
    return pipe;
  },
};

mock.module("../../src/lib/redis.js", () => ({
  getRedis: () => mockRedis,
  closeRedis: () => Promise.resolve(),
}));

// ---------------------------------------------------------------------------
// 3. Static imports (after mocks)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { app } from "../../src/index.js";
import { initializeKeys, signAccessToken } from "../../src/auth/jwt.js";

// ---------------------------------------------------------------------------
// 4. Global setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();
});

// Reset all mock state before each test so tests are fully isolated
beforeEach(() => {
  _selectQueue = [];
  _insertReturn = [];
  _updateReturn = [];
  _executeReturn = [];
  _redisStore.clear();
  globalThis.fetch = _originalFetch;
});

afterEach(() => {
  globalThis.fetch = _originalFetch;
});

// ---------------------------------------------------------------------------
// 5. Fetch interceptor helpers
// ---------------------------------------------------------------------------

// Save original fetch so we can restore it after each test
const _originalFetch = globalThis.fetch;

/** Replace globalThis.fetch for one test; restored in afterEach/beforeEach. */
function mockFetch(impl: typeof globalThis.fetch): void {
  globalThis.fetch = impl;
}

/** Returns a fetch mock that always responds with the given status. */
function fetchReturnsStatus(status: number): typeof globalThis.fetch {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ jsonrpc: "2.0", result: {}, id: 1 }), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
}

/** Returns a fetch mock that rejects (simulates network timeout/error). */
function fetchThrows(err: Error = new Error("ETIMEDOUT")): typeof globalThis.fetch {
  return () => Promise.reject(err);
}

// ---------------------------------------------------------------------------
// 6. Factories
// ---------------------------------------------------------------------------

async function makeToken(
  overrides: {
    sub?: string;
    plan?: string;
    app_access?: string[];
  } = {}
): Promise<string> {
  return signAccessToken({
    sub: overrides.sub ?? "krn_usr_dev0000001",
    plan: overrides.plan ?? "free",
    capabilities: ["apps:install"],
    app_access: overrides.app_access ?? [],
    scopes: ["read"],
  });
}

type MockApp = MockRow & {
  id: string;
  slug: string;
  developer_id: string;
  type: string;
  status: string;
};

function makeApp(overrides: Partial<MockApp> = {}): MockApp {
  return {
    id: "krn_app_testapp0001",
    slug: "my-mcp-tool",
    name: "My MCP Tool",
    description: "A developer MCP app for testing",
    type: "developer_mcp",
    developer_id: "krn_usr_dev0000001",
    developer_mcp_url: "https://mcp.example.com/mcp",
    pricing_model: "free",
    price_cents: 0,
    status: "review",
    manifest_json: {},
    download_url: null,
    icon_url: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeInsertedApp(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "krn_app_testapp0001",
    slug: "my-mcp-tool",
    status: "review",
    ...overrides,
  };
}

function makeInsertedVersion(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "krn_ver_testver0001",
    version: "1.0.0",
    published_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

/** Enqueue rows for multiple sequential db.select() calls within one request. */
function enqueueSelect(...rows: MockRow[][]): void {
  _selectQueue.push(...rows);
}

function authRequest(
  method: "GET" | "POST" | "PUT",
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
// Minimal valid manifests
// ---------------------------------------------------------------------------

function developerMcpManifest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: "my-mcp-tool",
    display_name: "My MCP Tool",
    version: "1.0.0",
    description: "A developer-hosted MCP server for testing purposes in Kronus.",
    type: "developer_mcp",
    mcp_url: "https://mcp.example.com/mcp",
    mcp: { tools: [{ name: "search", description: "Search the web" }] },
    ...overrides,
  };
}

function localSkillManifest(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    name: "my-local-skill",
    display_name: "My Local Skill",
    version: "1.0.0",
    description: "A local skill bundle deployed to the Kronus instance filesystem.",
    type: "local_skill",
    files: [{ src: "dist/skill.md", dest: ".claude/skills/skill.md" }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// POST /developer/apps — Submit new app
// ---------------------------------------------------------------------------

describe("POST /developer/apps — happy path", () => {
  it("returns 201 when a valid developer_mcp manifest is submitted", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(200));
    enqueueSelect([]); // slug uniqueness: not taken
    _insertReturn = [makeInsertedApp()];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );

    // Assert
    expect(res.status).toBe(201);
  });

  it("returns app with status 'review' after submission", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(200));
    enqueueSelect([]);
    _insertReturn = [makeInsertedApp({ status: "review" })];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );
    const body = await res.json() as { app: Record<string, unknown> };

    // Assert
    expect(body.app["status"]).toBe("review");
  });

  it("returns the app id and slug in the response", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(200));
    enqueueSelect([]);
    _insertReturn = [makeInsertedApp()];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );
    const body = await res.json() as { app: Record<string, unknown> };

    // Assert
    expect(typeof body.app["id"]).toBe("string");
    expect(body.app["slug"]).toBe("my-mcp-tool");
  });

  it("returns 201 for a valid local_skill manifest (no MCP probe)", async () => {
    // Arrange — local_skill type skips MCP compliance check
    const token = await makeToken();
    enqueueSelect([]);
    _insertReturn = [makeInsertedApp({ slug: "my-local-skill", type: "local_skill" })];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, localSkillManifest())
    );

    // Assert
    expect(res.status).toBe(201);
  });

  it("includes a 'Submitted for review' message in the response", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(200));
    enqueueSelect([]);
    _insertReturn = [makeInsertedApp()];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );
    const body = await res.json() as { message: string };

    // Assert
    expect(body.message).toContain("review");
  });
});

describe("POST /developer/apps — validation errors", () => {
  it("returns 400 when name is missing", async () => {
    // Arrange
    const token = await makeToken();
    const { name: _n, ...noName } = developerMcpManifest();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, noName)
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when display_name is missing", async () => {
    // Arrange
    const token = await makeToken();
    const { display_name: _d, ...noDisplay } = developerMcpManifest();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, noDisplay)
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when version is not semver format", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest({ version: "v1.0" }))
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns BAD_REQUEST error code for semver validation failure", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest({ version: "not-semver" }))
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });

  it("returns 400 when description is shorter than 20 characters", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest({ description: "Too short" }))
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 for an invalid type value", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, {
        name: "my-tool",
        display_name: "My Tool",
        version: "1.0.0",
        description: "A tool with an invalid type string for the manifest.",
        type: "not_a_valid_type",
      })
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when developer_mcp type is missing mcp_url", async () => {
    // Arrange
    const token = await makeToken();
    const { mcp_url: _u, ...noUrl } = developerMcpManifest();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, noUrl)
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns error mentioning mcp_url when it is absent for developer_mcp", async () => {
    // Arrange
    const token = await makeToken();
    const { mcp_url: _u, ...noUrl } = developerMcpManifest();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, noUrl)
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect((body.error["message"] as string).toLowerCase()).toContain("mcp_url");
  });

  it("returns 400 when developer_mcp type has mcp.tools as empty array", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest({ mcp: { tools: [] } }))
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when local_skill type is missing files array", async () => {
    // Arrange
    const token = await makeToken();
    const { files: _f, ...noFiles } = localSkillManifest();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, noFiles)
    );

    // Assert
    expect(res.status).toBe(400);
  });
});

describe("POST /developer/apps — SSRF protection", () => {
  it("returns 400 when mcp_url targets localhost", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token,
        developerMcpManifest({ mcp_url: "https://localhost/mcp" })
      )
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when mcp_url is an HTTP (non-HTTPS) URL", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token,
        developerMcpManifest({ mcp_url: "http://example.com/mcp" })
      )
    );

    // Assert — HTTP mcp_url fails the URL protocol check in validateManifest before SSRF check
    expect(res.status).toBe(400);
  });

  it("returns 400 when mcp_url targets a private IPv4 address (127.x range)", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token,
        developerMcpManifest({ mcp_url: "https://127.0.0.1/mcp" })
      )
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when mcp_url targets a 10.x private IPv4 address", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token,
        developerMcpManifest({ mcp_url: "https://10.0.0.1/mcp" })
      )
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when mcp_url targets a 192.168.x.x private address", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token,
        developerMcpManifest({ mcp_url: "https://192.168.1.1/mcp" })
      )
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns BAD_REQUEST error code for SSRF rejection", async () => {
    // Arrange
    const token = await makeToken();

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token,
        developerMcpManifest({ mcp_url: "https://127.0.0.1/mcp" })
      )
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });
});

describe("POST /developer/apps — conflict", () => {
  it("returns 409 when the app slug is already taken", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(200));
    enqueueSelect([{ id: "krn_app_existing001" }]); // slug already exists

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );

    // Assert
    expect(res.status).toBe(409);
  });

  it("returns CONFLICT error code when slug is taken", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(200));
    enqueueSelect([{ id: "krn_app_existing001" }]);

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("CONFLICT");
  });
});

describe("POST /developer/apps — authentication", () => {
  it("returns 401 when no Authorization header is present", async () => {
    // Act
    const res = await app.request(
      new Request("http://localhost/developer/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(developerMcpManifest()),
      })
    );

    // Assert
    expect(res.status).toBe(401);
  });

  it("returns UNAUTHORIZED error code when token is absent", async () => {
    // Act
    const res = await app.request(
      new Request("http://localhost/developer/apps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(developerMcpManifest()),
      })
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("UNAUTHORIZED");
  });

  it("returns 401 when Bearer token is malformed", async () => {
    // Act
    const res = await app.request(
      new Request("http://localhost/developer/apps", {
        method: "POST",
        headers: {
          Authorization: "Bearer not.a.valid.jwt",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(developerMcpManifest()),
      })
    );

    // Assert
    expect(res.status).toBe(401);
  });
});

describe("POST /developer/apps — MCP compliance check", () => {
  it("returns 422 when the MCP server returns a 500 status", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(500)); // MCP server is broken

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );

    // Assert
    expect(res.status).toBe(422);
  });

  it("returns MCP_COMPLIANCE_FAILED error code on server error", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(503));

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("MCP_COMPLIANCE_FAILED");
  });

  it("returns 422 when the MCP server fetch throws (network timeout)", async () => {
    // Arrange
    const token = await makeToken();
    mockFetch(fetchThrows(new Error("AbortError")));

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps", token, developerMcpManifest())
    );

    // Assert
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// PUT /developer/apps/:id — Update metadata
// ---------------------------------------------------------------------------

describe("PUT /developer/apps/:id — happy path", () => {
  it("returns 200 when updating own app description", async () => {
    // Arrange — ownership check returns the app owned by this user
    const token = await makeToken();
    enqueueSelect([makeApp()]); // requireAppOwnership lookup
    _updateReturn = [makeApp({ description: "An updated description that is long enough to pass validation." })];

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {
        description: "An updated description that is long enough to pass validation.",
      })
    );

    // Assert
    expect(res.status).toBe(200);
  });

  it("returns the updated app in the response body", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()]);
    _updateReturn = [makeApp({ description: "An updated description that is long enough to pass validation." })];

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {
        description: "An updated description that is long enough to pass validation.",
      })
    );
    const body = await res.json() as { app: Record<string, unknown> };

    // Assert
    expect(body.app).toBeDefined();
    expect(body.app["id"]).toBe("krn_app_testapp0001");
  });

  it("returns 200 when updating icon_url with a valid HTTPS URL", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()]);
    _updateReturn = [makeApp({ icon_url: "https://cdn.example.com/icon.png" })];

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {
        icon_url: "https://cdn.example.com/icon.png",
      })
    );

    // Assert
    expect(res.status).toBe(200);
  });
});

describe("PUT /developer/apps/:id — authorization failures", () => {
  it("returns 403 when trying to update an app owned by another developer", async () => {
    // Arrange — the app's developer_id does NOT match the token's sub
    const token = await makeToken({ sub: "krn_usr_attacker00001" });
    enqueueSelect([makeApp({ developer_id: "krn_usr_dev0000001" })]); // different owner

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {
        description: "Attempting to hijack this app description for testing.",
      })
    );

    // Assert
    expect(res.status).toBe(403);
  });

  it("returns FORBIDDEN error code when app is owned by another user", async () => {
    // Arrange
    const token = await makeToken({ sub: "krn_usr_attacker00001" });
    enqueueSelect([makeApp({ developer_id: "krn_usr_dev0000001" })]);

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {
        description: "Attempting to hijack this app description for testing.",
      })
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("FORBIDDEN");
  });

  it("returns 404 when the app does not exist", async () => {
    // Arrange — ownership lookup returns empty (app not found)
    const token = await makeToken();
    enqueueSelect([]); // app not found

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_nonexistent", token, {
        description: "Trying to update a nonexistent app in the registry.",
      })
    );

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns NOT_FOUND error code for a nonexistent app id", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([]);

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_nonexistent", token, {
        description: "Trying to update a nonexistent app in the registry.",
      })
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });
});

describe("PUT /developer/apps/:id — input validation", () => {
  it("returns 400 when no updatable fields are provided", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {})
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when icon_url is not HTTPS", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {
        icon_url: "http://cdn.example.com/icon.png",
      })
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when description is shorter than 20 characters", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      authRequest("PUT", "/developer/apps/krn_app_testapp0001", token, {
        description: "Too short",
      })
    );

    // Assert
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /developer/apps/:id/versions — Publish new version
// ---------------------------------------------------------------------------

describe("POST /developer/apps/:id/versions — happy path", () => {
  it("returns 201 when publishing a new version for own app", async () => {
    // Arrange — ownership check, then version uniqueness check
    const token = await makeToken();
    enqueueSelect(
      [makeApp()],  // requireAppOwnership
      []            // version uniqueness: not taken
    );
    _insertReturn = [makeInsertedVersion({ version: "1.1.0" })];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        version: "1.1.0",
        changelog: "Bug fixes and performance improvements.",
      })
    );

    // Assert
    expect(res.status).toBe(201);
  });

  it("returns the version object in the response", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()], []);
    _insertReturn = [makeInsertedVersion({ version: "2.0.0" })];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        version: "2.0.0",
      })
    );
    const body = await res.json() as { version: Record<string, unknown> };

    // Assert
    expect(body.version).toBeDefined();
    expect(body.version["version"]).toBe("2.0.0");
  });

  it("returns 201 when publishing version with a new MCP URL (triggers compliance check)", async () => {
    // Arrange — developer_mcp app; new URL passes compliance
    const token = await makeToken();
    mockFetch(fetchReturnsStatus(200));
    enqueueSelect([makeApp({ type: "developer_mcp" })], []);
    _insertReturn = [makeInsertedVersion({ version: "1.1.0" })];
    _updateReturn = [makeApp({ developer_mcp_url: "https://new.mcp.example.com/mcp" })];

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        version: "1.1.0",
        developer_mcp_url: "https://new.mcp.example.com/mcp",
      })
    );

    // Assert
    expect(res.status).toBe(201);
  });
});

describe("POST /developer/apps/:id/versions — conflict", () => {
  it("returns 409 when the version already exists for this app", async () => {
    // Arrange — ownership check passes, but version uniqueness check finds a duplicate
    const token = await makeToken();
    enqueueSelect(
      [makeApp()],                    // ownership check
      [{ id: "krn_ver_existing01" }]  // version already exists
    );

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        version: "1.0.0", // already exists
      })
    );

    // Assert
    expect(res.status).toBe(409);
  });

  it("returns CONFLICT error code for a duplicate version", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()], [{ id: "krn_ver_existing01" }]);

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        version: "1.0.0",
      })
    );
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("CONFLICT");
  });
});

describe("POST /developer/apps/:id/versions — validation", () => {
  it("returns 400 when version string is not semver format", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        version: "v2.0-beta",
      })
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when version field is missing entirely", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp()]);

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        changelog: "Some notes",
      })
    );

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns 400 when developer_mcp_url is provided for a non-developer_mcp type app", async () => {
    // Arrange — local_skill app; developer_mcp_url field is not applicable
    const token = await makeToken();
    enqueueSelect(
      [makeApp({ type: "local_skill", developer_mcp_url: null })],
      [] // version uniqueness
    );

    // Act
    const res = await app.request(
      authRequest("POST", "/developer/apps/krn_app_testapp0001/versions", token, {
        version: "1.1.0",
        developer_mcp_url: "https://mcp.example.com/mcp",
      })
    );

    // Assert
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /developer/analytics — Usage stats
// ---------------------------------------------------------------------------

describe("GET /developer/analytics", () => {
  it("returns 200 with an apps array", async () => {
    // Arrange — developer has two apps
    const token = await makeToken();
    enqueueSelect([
      { id: "krn_app_testapp0001", slug: "my-mcp-tool" },
      { id: "krn_app_testapp0002", slug: "my-agent" },
    ]);
    // execute() returns aggregated usage rows
    _executeReturn = [
      { app_id: "krn_app_testapp0001", total_calls: "42", total_bytes: "10240" },
    ];

    // Act
    const res = await app.request(
      authRequest("GET", "/developer/analytics", token)
    );

    // Assert
    expect(res.status).toBe(200);
  });

  it("response body contains an apps array", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([{ id: "krn_app_testapp0001", slug: "my-mcp-tool" }]);
    _executeReturn = [{ app_id: "krn_app_testapp0001", total_calls: "5", total_bytes: "512" }];

    // Act
    const res = await app.request(
      authRequest("GET", "/developer/analytics", token)
    );
    const body = await res.json() as { apps: unknown[] };

    // Assert
    expect(Array.isArray(body.apps)).toBe(true);
  });

  it("returns empty apps array when developer has no apps", async () => {
    // Arrange — no apps owned by this developer
    const token = await makeToken();
    enqueueSelect([]); // devApps query returns empty

    // Act
    const res = await app.request(
      authRequest("GET", "/developer/analytics", token)
    );
    const body = await res.json() as { apps: unknown[] };

    // Assert
    expect(body.apps).toHaveLength(0);
  });

  it("returns 401 when no auth token is provided", async () => {
    // Act
    const res = await app.request(
      new Request("http://localhost/developer/analytics", { method: "GET" })
    );

    // Assert
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// GET /developer/payouts — Payout history
// ---------------------------------------------------------------------------

describe("GET /developer/payouts", () => {
  it("returns 200 with payouts array and summary", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([
      {
        id: "krn_pay_pay0000001",
        developer_id: "krn_usr_dev0000001",
        amount_cents: 5000,
        commission_cents: 750,
        stripe_transfer_id: "tr_test_abc123",
        period_start: new Date("2026-01-01T00:00:00Z"),
        period_end: new Date("2026-01-31T23:59:59Z"),
        status: "paid",
        created_at: new Date("2026-02-01T00:00:00Z"),
      },
    ]);

    // Act
    const res = await app.request(
      authRequest("GET", "/developer/payouts", token)
    );

    // Assert
    expect(res.status).toBe(200);
  });

  it("response body contains payouts array and summary object", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([
      {
        id: "krn_pay_pay0000001",
        developer_id: "krn_usr_dev0000001",
        amount_cents: 5000,
        commission_cents: 750,
        stripe_transfer_id: null,
        period_start: new Date("2026-01-01T00:00:00Z"),
        period_end: new Date("2026-01-31T23:59:59Z"),
        status: "paid",
        created_at: new Date("2026-02-01T00:00:00Z"),
      },
    ]);

    // Act
    const res = await app.request(
      authRequest("GET", "/developer/payouts", token)
    );
    const body = await res.json() as {
      payouts: unknown[];
      summary: Record<string, unknown>;
    };

    // Assert
    expect(Array.isArray(body.payouts)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(typeof body.summary["total_earned_cents"]).toBe("number");
    expect(typeof body.summary["total_commission_cents"]).toBe("number");
  });

  it("summary totals correctly aggregate multiple payout rows", async () => {
    // Arrange — two payouts: 5000 + 3000 = 8000 earned, 750 + 450 = 1200 commission
    const token = await makeToken();
    enqueueSelect([
      {
        id: "krn_pay_pay0000001",
        developer_id: "krn_usr_dev0000001",
        amount_cents: 5000,
        commission_cents: 750,
        stripe_transfer_id: null,
        period_start: new Date("2026-01-01"),
        period_end: new Date("2026-01-31"),
        status: "paid",
        created_at: new Date("2026-02-01"),
      },
      {
        id: "krn_pay_pay0000002",
        developer_id: "krn_usr_dev0000001",
        amount_cents: 3000,
        commission_cents: 450,
        stripe_transfer_id: null,
        period_start: new Date("2026-02-01"),
        period_end: new Date("2026-02-28"),
        status: "paid",
        created_at: new Date("2026-03-01"),
      },
    ]);

    // Act
    const res = await app.request(
      authRequest("GET", "/developer/payouts", token)
    );
    const body = await res.json() as {
      summary: { total_earned_cents: number; total_commission_cents: number };
    };

    // Assert
    expect(body.summary.total_earned_cents).toBe(8000);
    expect(body.summary.total_commission_cents).toBe(1200);
  });

  it("returns empty payouts array and zero summary when developer has no payouts", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([]); // no payout rows

    // Act
    const res = await app.request(
      authRequest("GET", "/developer/payouts", token)
    );
    const body = await res.json() as {
      payouts: unknown[];
      summary: { total_earned_cents: number; total_commission_cents: number };
    };

    // Assert
    expect(body.payouts).toHaveLength(0);
    expect(body.summary.total_earned_cents).toBe(0);
    expect(body.summary.total_commission_cents).toBe(0);
  });

  it("returns 401 when no auth token is provided", async () => {
    // Act
    const res = await app.request(
      new Request("http://localhost/developer/payouts", { method: "GET" })
    );

    // Assert
    expect(res.status).toBe(401);
  });
});
