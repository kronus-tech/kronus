// apps.test.ts — Integration tests for the App Registry API (/apps)
//
// Strategy: matches auth.test.ts mock pattern.
//   - process.env set first
//   - mock.module for db/index.js (no real Postgres connection)
//   - app imported after mocks
//   - initializeKeys() called in beforeAll()
//
// The db mock uses a FIFO _selectQueue so sequential calls within a single
// route handler return different rows (e.g. app lookup → version lookup →
// rating lookup → subscription lookup). Each test enqueues exactly the rows
// it needs via enqueueSelect().

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

function nextSelectReturn(): Promise<MockRow[]> {
  if (_selectQueue.length === 0) return Promise.resolve([]);
  return Promise.resolve(_selectQueue.shift()!);
}

// Rating queries use avg()/count() aggregates — the fluent builder needs
// orderBy() and where() stubs too.
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
};

mock.module("../../src/db/index.js", () => ({
  db: mockDb,
  sql: {},
}));

mock.module("../../src/lib/redis.js", () => ({
  getRedis: () => ({ incr: () => Promise.resolve(1), expire: () => Promise.resolve(1), get: () => Promise.resolve(null), set: () => Promise.resolve("OK"), setex: () => Promise.resolve("OK"), del: () => Promise.resolve(1), pipeline: () => ({ incr: () => ({}), expire: () => ({}), incrby: () => ({}), exec: () => Promise.resolve([]) }), status: "ready" }),
  closeRedis: () => Promise.resolve(),
  isRedisReady: () => true,
}));

// ---------------------------------------------------------------------------
// 3. Static imports (after mocks)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeAll, beforeEach } from "bun:test";
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

// Reset mock state before each test
beforeEach(() => {
  _selectQueue = [];
  _insertReturn = [];
  _updateReturn = [];
});

// ---------------------------------------------------------------------------
// 5. Factories
// ---------------------------------------------------------------------------

function makeApp(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "krn_app_testapp0001",
    slug: "test-scraper",
    name: "Test Scraper",
    description: "A web scraper MCP app",
    type: "developer_mcp",
    developer_id: "krn_usr_dev0000001",
    developer_mcp_url: "https://dev.example.com/mcp",
    pricing_model: "free",
    price_cents: 0,
    status: "published",
    manifest_json: {},
    download_url: null,
    icon_url: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    updated_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeAppListItem(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "krn_app_testapp0001",
    slug: "test-scraper",
    name: "Test Scraper",
    description: "A web scraper MCP app",
    type: "developer_mcp",
    pricing_model: "free",
    price_cents: 0,
    icon_url: null,
    created_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeVersion(overrides: Partial<MockRow> = {}): MockRow {
  return {
    version: "1.0.0",
    changelog: "Initial release",
    published_at: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeRating(overrides: Partial<MockRow> = {}): MockRow {
  return {
    average: "4.5",
    count: "12",
    ...overrides,
  };
}

function makeSub(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: "krn_sub_testsub0001",
    status: "active",
    app_id: "krn_app_testapp0001",
    ...overrides,
  };
}

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

/** Enqueue rows for multiple sequential db.select() calls within one request. */
function enqueueSelect(...rows: MockRow[][]): void {
  _selectQueue.push(...rows);
}

function getRequest(path: string): Request {
  return new Request(`http://localhost${path}`, { method: "GET" });
}

function authRequest(
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
// GET /apps — list marketplace apps
// ---------------------------------------------------------------------------

describe("GET /apps — list", () => {
  it("returns 200 with an apps array", async () => {
    // Arrange
    enqueueSelect([makeAppListItem(), makeAppListItem({ id: "krn_app_testapp0002", slug: "test-agent" })]);

    // Act
    const res = await app.request(getRequest("/apps"));
    const body = await res.json() as { apps: unknown[] };

    // Assert
    expect(res.status).toBe(200);
    expect(Array.isArray(body.apps)).toBe(true);
  });

  it("returns the expected number of app objects", async () => {
    // Arrange
    enqueueSelect([
      makeAppListItem({ id: "krn_app_001", slug: "app-one" }),
      makeAppListItem({ id: "krn_app_002", slug: "app-two" }),
    ]);

    // Act
    const res = await app.request(getRequest("/apps"));
    const body = await res.json() as { apps: unknown[] };

    // Assert
    expect(body.apps.length).toBe(2);
  });

  it("returns empty apps array and null next_cursor when no apps exist", async () => {
    // Arrange
    enqueueSelect([]);

    // Act
    const res = await app.request(getRequest("/apps"));
    const body = await res.json() as { apps: unknown[]; next_cursor: unknown };

    // Assert
    expect(body.apps.length).toBe(0);
    expect(body.next_cursor).toBeNull();
  });

  it("returns next_cursor when result set exceeds the requested limit", async () => {
    // Arrange — limit=2, return 3 rows (limit+1); route should detect next page
    enqueueSelect([
      makeAppListItem({ id: "krn_app_001", slug: "app-one" }),
      makeAppListItem({ id: "krn_app_002", slug: "app-two" }),
      makeAppListItem({ id: "krn_app_003", slug: "app-three" }),
    ]);

    // Act
    const res = await app.request(getRequest("/apps?limit=2"));
    const body = await res.json() as { apps: unknown[]; next_cursor: unknown };

    // Assert — only 2 items returned, cursor set to last id
    expect(body.apps.length).toBe(2);
    expect(body.next_cursor).toBe("krn_app_002");
  });

  it("returns null next_cursor when result set is exactly the limit", async () => {
    // Arrange — limit=2, return exactly 2 rows (no next page)
    enqueueSelect([
      makeAppListItem({ id: "krn_app_001", slug: "app-one" }),
      makeAppListItem({ id: "krn_app_002", slug: "app-two" }),
    ]);

    // Act
    const res = await app.request(getRequest("/apps?limit=2"));
    const body = await res.json() as { apps: unknown[]; next_cursor: unknown };

    // Assert
    expect(body.apps.length).toBe(2);
    expect(body.next_cursor).toBeNull();
  });

  it("accepts ?q= search parameter without error", async () => {
    // Arrange — filtered search; mock returns relevant results
    enqueueSelect([makeAppListItem({ name: "Web Scraper" })]);

    // Act
    const res = await app.request(getRequest("/apps?q=scraper"));

    // Assert — route accepts the param and returns 200
    expect(res.status).toBe(200);
  });

  it("returns empty list when search matches nothing", async () => {
    // Arrange
    enqueueSelect([]);

    // Act
    const res = await app.request(getRequest("/apps?q=zzznomatch"));
    const body = await res.json() as { apps: unknown[] };

    // Assert
    expect(res.status).toBe(200);
    expect(body.apps.length).toBe(0);
  });

  it("accepts pagination cursor parameter without error", async () => {
    // Arrange — second page starting after some cursor
    enqueueSelect([makeAppListItem({ id: "krn_app_after_cursor", slug: "page-two-app" })]);

    // Act
    const res = await app.request(getRequest("/apps?cursor=krn_app_testapp0001"));

    // Assert
    expect(res.status).toBe(200);
  });

  it("enforces maximum limit of 100", async () => {
    // Arrange — request limit=500; route clamps to 100 and fetches 101 rows to detect next page
    const rows = Array.from({ length: 100 }, (_, i) =>
      makeAppListItem({ id: `krn_app_${String(i).padStart(3, "0")}`, slug: `app-${i}` })
    );
    enqueueSelect(rows);

    // Act
    const res = await app.request(getRequest("/apps?limit=500"));
    const body = await res.json() as { apps: unknown[] };

    // Assert — max 100 returned
    expect(body.apps.length).toBeLessThanOrEqual(100);
  });

  it("accepts ?sort=new without error", async () => {
    // Arrange
    enqueueSelect([makeAppListItem()]);

    // Act
    const res = await app.request(getRequest("/apps?sort=new"));

    // Assert
    expect(res.status).toBe(200);
  });

  it("accepts ?sort=name without error", async () => {
    // Arrange
    enqueueSelect([makeAppListItem()]);

    // Act
    const res = await app.request(getRequest("/apps?sort=name"));

    // Assert
    expect(res.status).toBe(200);
  });

  it("accepts ?type= filter without error", async () => {
    // Arrange
    enqueueSelect([makeAppListItem({ type: "developer_mcp" })]);

    // Act
    const res = await app.request(getRequest("/apps?type=developer_mcp"));

    // Assert
    expect(res.status).toBe(200);
  });

  it("accepts ?pricing= filter without error", async () => {
    // Arrange
    enqueueSelect([makeAppListItem({ pricing_model: "paid" })]);

    // Act
    const res = await app.request(getRequest("/apps?pricing=paid"));

    // Assert
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /apps/:slug — app detail
// ---------------------------------------------------------------------------

describe("GET /apps/:slug — app detail", () => {
  it("returns 200 for a published app", async () => {
    // Arrange — app lookup, version lookup, rating lookup
    enqueueSelect(
      [makeApp()],         // app lookup
      [makeVersion()],     // latest version
      [makeRating()]       // rating aggregate
    );

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));

    // Assert
    expect(res.status).toBe(200);
  });

  it("returns app detail with expected fields", async () => {
    // Arrange
    enqueueSelect([makeApp()], [makeVersion()], [makeRating()]);

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));
    const body = await res.json() as {
      app: Record<string, unknown>;
      latest_version: Record<string, unknown> | null;
      rating: Record<string, unknown>;
    };

    // Assert — shape check
    expect(body.app).toBeDefined();
    expect(body.latest_version).toBeDefined();
    expect(body.rating).toBeDefined();
    expect(body.app["slug"]).toBe("test-scraper");
    expect(body.app["name"]).toBe("Test Scraper");
  });

  it("includes latest_version in response when version exists", async () => {
    // Arrange
    enqueueSelect([makeApp()], [makeVersion()], [makeRating()]);

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));
    const body = await res.json() as { latest_version: Record<string, unknown> | null };

    // Assert
    expect(body.latest_version).not.toBeNull();
    expect(body.latest_version!["version"]).toBe("1.0.0");
  });

  it("returns null latest_version when no versions exist for the app", async () => {
    // Arrange — version lookup returns empty
    enqueueSelect([makeApp()], [], [makeRating()]);

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));
    const body = await res.json() as { latest_version: null };

    // Assert
    expect(body.latest_version).toBeNull();
  });

  it("returns rating average and count in response", async () => {
    // Arrange
    enqueueSelect([makeApp()], [makeVersion()], [makeRating({ average: "4.8", count: "25" })]);

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));
    const body = await res.json() as { rating: Record<string, unknown> };

    // Assert
    expect(body.rating["average"]).toBe(4.8);
    expect(body.rating["count"]).toBe(25);
  });

  it("returns rating average null and count 0 when no reviews exist", async () => {
    // Arrange — rating row has null average
    enqueueSelect([makeApp()], [makeVersion()], [makeRating({ average: null, count: "0" })]);

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));
    const body = await res.json() as { rating: { average: unknown; count: number } };

    // Assert
    expect(body.rating.average).toBeNull();
    expect(body.rating.count).toBe(0);
  });

  it("returns 404 for a slug that does not exist", async () => {
    // Arrange — app lookup returns empty
    enqueueSelect([]);

    // Act
    const res = await app.request(getRequest("/apps/nonexistent-app"));

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns error code NOT_FOUND for a missing app", async () => {
    // Arrange
    enqueueSelect([]);

    // Act
    const res = await app.request(getRequest("/apps/nonexistent-app"));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("NOT_FOUND");
  });

  it("does not expose developer_mcp_url in public response (HUB-57)", async () => {
    // Arrange
    enqueueSelect(
      [makeApp({ developer_mcp_url: "https://secret.dev/mcp" })],
      [makeVersion()],
      [makeRating()]
    );

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));
    const body = await res.json() as { app: Record<string, unknown> };

    // Assert — field must not be in public response
    expect(res.status).toBe(200);
    expect(body.app["developer_mcp_url"]).toBeUndefined();
  });

  it("returns 200 with content-type application/json", async () => {
    // Arrange
    enqueueSelect([makeApp()], [makeVersion()], [makeRating()]);

    // Act
    const res = await app.request(getRequest("/apps/test-scraper"));

    // Assert
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// POST /apps/:slug/install — install an app
// ---------------------------------------------------------------------------

describe("POST /apps/:slug/install — auth guard", () => {
  it("returns 401 when Authorization header is absent", async () => {
    // Arrange
    const req = new Request("http://localhost/apps/test-scraper/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // Act
    const res = await app.request(req);

    // Assert
    expect(res.status).toBe(401);
  });

  it("returns 401 when Bearer token is invalid", async () => {
    // Arrange
    const req = new Request("http://localhost/apps/test-scraper/install", {
      method: "POST",
      headers: {
        Authorization: "Bearer bad.token.value",
        "Content-Type": "application/json",
      },
    });

    // Act
    const res = await app.request(req);

    // Assert
    expect(res.status).toBe(401);
  });
});

describe("POST /apps/:slug/install — free app", () => {
  it("returns 200 for a free developer_mcp app", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ type: "developer_mcp", pricing_model: "free" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));

    // Assert
    expect(res.status).toBe(200);
  });

  it("returns install_type 'gateway' for a developer_mcp app", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ type: "developer_mcp", pricing_model: "free" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    // Assert
    expect(body["install_type"]).toBe("gateway");
  });

  it("returns gateway_url pointing to /mcp/:slug for developer_mcp apps", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ type: "developer_mcp", pricing_model: "free", slug: "test-scraper" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    // Assert
    expect(body["gateway_url"]).toBe("http://localhost:3100/mcp/test-scraper");
  });

  it("returns an access_token JWT in the install response", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ type: "developer_mcp", pricing_model: "free" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    // Assert
    expect(typeof body["access_token"]).toBe("string");
    expect((body["access_token"] as string).split(".").length).toBe(3);
  });

  it("access_token includes the app slug in app_access claim", async () => {
    // Arrange
    const token = await makeToken({ app_access: [] });
    enqueueSelect([makeApp({ type: "developer_mcp", pricing_model: "free", slug: "test-scraper" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    // Decode the JWT payload (middle segment, base64url)
    const accessToken = body["access_token"] as string;
    const payloadB64 = accessToken.split(".")[1]!;
    const payloadJson = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<string, unknown>;

    // Assert
    expect(Array.isArray(payloadJson["app_access"])).toBe(true);
    expect((payloadJson["app_access"] as string[]).includes("test-scraper")).toBe(true);
  });

  it("does not duplicate app slug in app_access when already present", async () => {
    // Arrange — token already has the slug in app_access
    const token = await makeToken({ app_access: ["test-scraper"] });
    enqueueSelect([makeApp({ type: "developer_mcp", pricing_model: "free", slug: "test-scraper" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    const accessToken = body["access_token"] as string;
    const payloadB64 = accessToken.split(".")[1]!;
    const payloadJson = JSON.parse(Buffer.from(payloadB64, "base64url").toString()) as Record<string, unknown>;
    const appAccess = payloadJson["app_access"] as string[];

    // Assert — slug appears exactly once
    expect(appAccess.filter((s) => s === "test-scraper").length).toBe(1);
  });

  it("returns install_type 'local' and download_url for a local_skill app", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([
      makeApp({
        type: "local_skill",
        pricing_model: "free",
        download_url: "https://cdn.example.com/app.zip",
        manifest_json: { files: ["skill.md"] },
      }),
    ]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    // Assert
    expect(body["install_type"]).toBe("local");
    expect(body["download_url"]).toBe("https://cdn.example.com/app.zip");
  });

  it("returns files array from manifest_json for local apps", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([
      makeApp({
        type: "local_agent",
        pricing_model: "free",
        manifest_json: { files: ["agent.md", "config.json"] },
      }),
    ]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    // Assert
    expect(body["files"]).toEqual(["agent.md", "config.json"]);
  });

  it("returns empty files array when manifest_json has no files key", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ type: "local_skill", pricing_model: "free", manifest_json: {} })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as Record<string, unknown>;

    // Assert
    expect(body["files"]).toEqual([]);
  });

  it("returns 404 when app slug does not exist", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/nonexistent/install", token));

    // Assert
    expect(res.status).toBe(404);
  });
});

describe("POST /apps/:slug/install — paid app", () => {
  it("returns 402 when app is paid and user has no active subscription", async () => {
    // Arrange — paid app, no active sub
    const token = await makeToken();
    enqueueSelect(
      [makeApp({ pricing_model: "paid" })],  // app lookup
      []                                     // subscription lookup → no active sub
    );

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));

    // Assert
    expect(res.status).toBe(402);
  });

  it("returns SUBSCRIPTION_REQUIRED code in 402 response", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ pricing_model: "paid" })], []);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("returns subscribe_url in 402 response body", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ pricing_model: "paid", slug: "test-scraper" })], []);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["subscribe_url"]).toBe("/apps/test-scraper/subscribe");
  });

  it("returns 200 when paid app has an active subscription", async () => {
    // Arrange — paid app + active sub row returned
    const token = await makeToken();
    enqueueSelect(
      [makeApp({ pricing_model: "paid" })],
      [makeSub({ status: "active" })]
    );

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/install", token));

    // Assert
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /apps/:slug/subscribe — subscribe to a paid app
// ---------------------------------------------------------------------------

describe("POST /apps/:slug/subscribe — auth guard", () => {
  it("returns 401 when Authorization header is absent", async () => {
    // Arrange
    const req = new Request("http://localhost/apps/test-scraper/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    // Act
    const res = await app.request(req);

    // Assert
    expect(res.status).toBe(401);
  });
});

describe("POST /apps/:slug/subscribe — paid app", () => {
  it("returns 201 when subscribing to a paid app for the first time", async () => {
    // Arrange — app lookup, no existing sub, insert succeeds
    const token = await makeToken();
    enqueueSelect(
      [makeApp({ pricing_model: "paid" })],  // app lookup
      []                                     // existing sub check → none
    );
    _insertReturn = [makeSub({ id: "krn_sub_new000001", status: "active" })];

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));

    // Assert
    expect(res.status).toBe(201);
  });

  it("returns subscription object in 201 response", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ pricing_model: "paid" })], []);
    _insertReturn = [makeSub({ id: "krn_sub_new000001", status: "active", app_id: "krn_app_testapp0001" })];

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));
    const body = await res.json() as { subscription: Record<string, unknown> };

    // Assert
    expect(body.subscription).toBeDefined();
    expect(body.subscription["id"]).toBe("krn_sub_new000001");
    expect(body.subscription["status"]).toBe("active");
    expect(body.subscription["app_slug"]).toBe("test-scraper");
  });

  it("returns 409 CONFLICT when an active subscription already exists", async () => {
    // Arrange — app lookup, existing sub check returns active sub
    const token = await makeToken();
    enqueueSelect(
      [makeApp({ pricing_model: "paid" })],
      [makeSub({ status: "active" })]
    );

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));

    // Assert
    expect(res.status).toBe(409);
  });

  it("returns error code CONFLICT on duplicate subscription", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ pricing_model: "paid" })], [makeSub({ status: "active" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("CONFLICT");
  });

  it("reactivates a cancelled subscription (returns 201, not 409)", async () => {
    // Arrange — existing sub has status "cancelled"; route should update it
    const token = await makeToken();
    enqueueSelect(
      [makeApp({ pricing_model: "paid" })],
      [makeSub({ status: "cancelled" })]   // existing but inactive sub
    );
    _updateReturn = [makeSub({ status: "active" })];

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));

    // Assert — route reactivates, not 409
    expect(res.status).toBe(201);
  });

  it("returns 400 BAD_REQUEST when attempting to subscribe to a free app", async () => {
    // Arrange — free app
    const token = await makeToken();
    enqueueSelect([makeApp({ pricing_model: "free" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));

    // Assert
    expect(res.status).toBe(400);
  });

  it("returns error code BAD_REQUEST for free-app subscription attempt", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ pricing_model: "free" })]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error["code"]).toBe("BAD_REQUEST");
  });

  it("returns 404 when subscribing to a non-existent app", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([]);

    // Act
    const res = await app.request(authRequest("POST", "/apps/ghost-app/subscribe", token));

    // Assert
    expect(res.status).toBe(404);
  });

  it("returns message field in 201 response body", async () => {
    // Arrange
    const token = await makeToken();
    enqueueSelect([makeApp({ pricing_model: "paid" })], []);
    _insertReturn = [makeSub({ id: "krn_sub_new000001", status: "active" })];

    // Act
    const res = await app.request(authRequest("POST", "/apps/test-scraper/subscribe", token));
    const body = await res.json() as Record<string, unknown>;

    // Assert — message hints that Stripe integration is pending
    expect(typeof body["message"]).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Error response shape — shared contracts
// ---------------------------------------------------------------------------

describe("error response shape", () => {
  it("404 response has error.code and error.message fields", async () => {
    // Arrange — trigger 404 by requesting non-existent app
    enqueueSelect([]);

    // Act
    const res = await app.request(getRequest("/apps/does-not-exist"));
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error).toBeDefined();
    expect(typeof body.error["code"]).toBe("string");
    expect(typeof body.error["message"]).toBe("string");
  });

  it("401 response has error.code and error.message fields", async () => {
    // Act — trigger 401 by hitting install without a token
    const req = new Request("http://localhost/apps/test-scraper/install", {
      method: "POST",
    });
    const res = await app.request(req);
    const body = await res.json() as { error: Record<string, unknown> };

    // Assert
    expect(body.error).toBeDefined();
    expect(typeof body.error["code"]).toBe("string");
    expect(typeof body.error["message"]).toBe("string");
  });
});
