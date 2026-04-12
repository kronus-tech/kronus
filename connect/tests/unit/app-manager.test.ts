/**
 * Unit tests for connect/src/app-manager.ts
 *
 * Strategy:
 * - Mock identity and token-manager modules via mock.module before any imports
 * - Mock globalThis.fetch for all HTTP calls
 * - Use a real temp directory for installed-apps.json file I/O
 *   (getKronusDir() is mocked to return the temp path so actual ~/.kronus is never touched)
 * - The mcp.json helpers are exercised in a separate temp location via the same
 *   getKronusDir() override; they are an implementation detail tested indirectly
 *   through installApp()
 */

process.env["DATABASE_URL"] = process.env["DATABASE_URL"] ?? "x";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "x";

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, writeFile } from "fs/promises";

// ── Shared mock state ─────────────────────────────────────────────────────────

let _mockIdentity: Record<string, unknown> | null = {
  hub_url: "http://hub.test",
  instance_id: "krn_inst_test",
};
let _mockToken = "test-token";

// Temp dir is regenerated per test so file I/O tests are isolated
let _tempKronusDir = join(tmpdir(), `kronus-test-appmanager-${Date.now()}`);

// mock.module calls must precede the await import so the module loader
// substitutes the mocks when app-manager.ts is first evaluated.
mock.module("../../src/identity.js", () => ({
  loadIdentity: () => Promise.resolve(_mockIdentity),
  getKronusDir: () => _tempKronusDir,
}));

mock.module("../../src/token-manager.js", () => ({
  getAccessToken: () => Promise.resolve(_mockToken),
}));

// Import after mocks are in place
const { listInstalledApps, installApp, uninstallApp, updateApps } = await import(
  "../../src/app-manager.js"
);

import type { InstalledApp } from "../../src/types.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeHubInstallResponse(overrides: Partial<{
  install_type: string;
  gateway_url: string;
  access_token: string;
  app: { slug: string; name: string; type: string };
}> = {}): Record<string, unknown> {
  return {
    install_type: "registry",
    app: {
      slug: "my-app",
      name: "My App",
      type: "developer_mcp",
    },
    ...overrides,
  };
}

function makeResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let originalFetch: typeof globalThis.fetch;

// ── Per-test setup / teardown ─────────────────────────────────────────────────

beforeEach(async () => {
  originalFetch = globalThis.fetch;

  // Use a fresh temp dir so each test has an empty installed-apps.json
  _tempKronusDir = join(
    tmpdir(),
    `kronus-test-appmanager-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
  await mkdir(_tempKronusDir, { recursive: true });

  // Reset shared state to connected defaults
  _mockIdentity = { hub_url: "http://hub.test", instance_id: "krn_inst_test" };
  _mockToken = "test-token";
});

afterEach(async () => {
  globalThis.fetch = originalFetch;
  await rm(_tempKronusDir, { recursive: true, force: true });
});

// ── listInstalledApps ─────────────────────────────────────────────────────────

describe("listInstalledApps", () => {
  test("returns empty array when installed-apps.json does not exist", async () => {
    // Arrange — temp dir is empty (no installed-apps.json written)

    // Act
    const result = await listInstalledApps();

    // Assert
    expect(result).toEqual([]);
  });

  test("returns parsed apps when installed-apps.json exists", async () => {
    // Arrange
    const apps: InstalledApp[] = [
      {
        slug: "existing-app",
        name: "Existing App",
        type: "developer_mcp",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
    ];
    await writeFile(
      join(_tempKronusDir, "installed-apps.json"),
      JSON.stringify(apps, null, 2)
    );

    // Act
    const result = await listInstalledApps();

    // Assert
    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe("existing-app");
    expect(result[0]?.name).toBe("Existing App");
  });

  test("returns empty array when installed-apps.json contains malformed JSON", async () => {
    // Arrange — corrupt file
    await writeFile(join(_tempKronusDir, "installed-apps.json"), "not valid json");

    // Act
    const result = await listInstalledApps();

    // Assert — catch block returns []
    expect(result).toEqual([]);
  });
});

// ── installApp ────────────────────────────────────────────────────────────────

describe("installApp", () => {
  test("calls POST to Hub /apps/:slug/install with correct Authorization header", async () => {
    // Arrange
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;

    globalThis.fetch = mock((input: string | Request | URL, init?: RequestInit) => {
      capturedUrl =
        typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : input.toString();
      capturedInit = init;
      return Promise.resolve(makeResponse(makeHubInstallResponse({ app: { slug: "weather-tool", name: "Weather Tool", type: "developer_mcp" } })));
    });

    // Act
    await installApp("weather-tool");

    // Assert
    expect(capturedUrl).toBe("http://hub.test/apps/weather-tool/install");
    expect(capturedInit?.method).toBe("POST");
    expect((capturedInit?.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-token"
    );
  });

  test("returns InstalledApp with correct fields from Hub response", async () => {
    // Arrange
    const hubResponse = makeHubInstallResponse({
      install_type: "registry",
      app: { slug: "code-search", name: "Code Search", type: "local_skill" },
    });
    globalThis.fetch = mock(() => Promise.resolve(makeResponse(hubResponse)));

    // Act
    const result = await installApp("code-search");

    // Assert
    expect(result.slug).toBe("code-search");
    expect(result.name).toBe("Code Search");
    expect(result.type).toBe("local_skill");
    expect(result.version).toBe("latest");
    expect(typeof result.installed_at).toBe("string");
    // installed_at should be a valid ISO date close to now
    const installedAt = new Date(result.installed_at).getTime();
    expect(installedAt).toBeGreaterThan(Date.now() - 5000);
  });

  test("returns InstalledApp with gateway_url when Hub provides it", async () => {
    // Arrange — gateway install type includes gateway_url
    const hubResponse = makeHubInstallResponse({
      install_type: "gateway",
      gateway_url: "https://gateway.hub.test/apps/my-app",
      access_token: "gw-access-token",
      app: { slug: "my-app", name: "My App", type: "developer_mcp" },
    });
    globalThis.fetch = mock(() => Promise.resolve(makeResponse(hubResponse)));

    // Act
    const result = await installApp("my-app");

    // Assert
    expect(result.gateway_url).toBe("https://gateway.hub.test/apps/my-app");
  });

  test("persists installed app to registry after successful install", async () => {
    // Arrange
    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeResponse(
          makeHubInstallResponse({ app: { slug: "persist-test", name: "Persist Test", type: "local_agent" } })
        )
      )
    );

    // Act
    await installApp("persist-test");
    const registry = await listInstalledApps();

    // Assert
    expect(registry.some((a) => a.slug === "persist-test")).toBe(true);
  });

  test("replaces existing registry entry for the same slug", async () => {
    // Arrange — seed registry with a stale entry
    const stale: InstalledApp[] = [
      {
        slug: "my-app",
        name: "My App (old)",
        type: "developer_mcp",
        version: "0.9.0",
        installed_at: "2025-01-01T00:00:00Z",
      },
    ];
    await writeFile(
      join(_tempKronusDir, "installed-apps.json"),
      JSON.stringify(stale, null, 2)
    );

    globalThis.fetch = mock(() =>
      Promise.resolve(
        makeResponse(
          makeHubInstallResponse({ app: { slug: "my-app", name: "My App (new)", type: "developer_mcp" } })
        )
      )
    );

    // Act
    await installApp("my-app");
    const registry = await listInstalledApps();

    // Assert — only one entry with updated name
    const entries = registry.filter((a) => a.slug === "my-app");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe("My App (new)");
  });

  test("throws when not connected (identity is null)", async () => {
    // Arrange
    _mockIdentity = null;

    // Act + Assert
    await expect(installApp("any-app")).rejects.toThrow(
      "Not connected — run 'kronus connect' first"
    );
  });

  test("throws with Hub error message on non-200 response with JSON error body", async () => {
    // Arrange
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({ error: { message: "App not found in marketplace" } }),
          { status: 404, statusText: "Not Found", headers: { "Content-Type": "application/json" } }
        )
      )
    );

    // Act + Assert
    await expect(installApp("ghost-app")).rejects.toThrow(
      "App not found in marketplace"
    );
  });

  test("throws with statusText fallback on non-200 response with non-JSON body", async () => {
    // Arrange — server returns plain text, not JSON
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Service Unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        })
      )
    );

    // Act + Assert
    await expect(installApp("any-app")).rejects.toThrow(
      "Install failed: Service Unavailable"
    );
  });

  test("throws with statusText fallback on non-200 response with empty error object", async () => {
    // Arrange — JSON body but no error.message field
    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ error: {} }), {
          status: 400,
          statusText: "Bad Request",
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    // Act + Assert
    await expect(installApp("broken-app")).rejects.toThrow(
      "Install failed: Bad Request"
    );
  });

  test("propagates network error from fetch", async () => {
    // Arrange
    globalThis.fetch = mock(() => Promise.reject(new Error("Network unreachable")));

    // Act + Assert
    await expect(installApp("any-app")).rejects.toThrow("Network unreachable");
  });
});

// ── uninstallApp ──────────────────────────────────────────────────────────────

describe("uninstallApp", () => {
  test("removes the target app from the registry", async () => {
    // Arrange — pre-populate registry with two apps
    const apps: InstalledApp[] = [
      {
        slug: "app-alpha",
        name: "App Alpha",
        type: "developer_mcp",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
      {
        slug: "app-beta",
        name: "App Beta",
        type: "local_skill",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
    ];
    await writeFile(
      join(_tempKronusDir, "installed-apps.json"),
      JSON.stringify(apps, null, 2)
    );

    // Act
    await uninstallApp("app-alpha");
    const registry = await listInstalledApps();

    // Assert
    expect(registry.find((a) => a.slug === "app-alpha")).toBeUndefined();
    expect(registry.find((a) => a.slug === "app-beta")).toBeDefined();
  });

  test("does not throw when uninstalling a slug that is not in the registry", async () => {
    // Arrange — registry is empty

    // Act + Assert — should resolve cleanly
    await expect(uninstallApp("nonexistent-app")).resolves.toBeUndefined();
  });

  test("leaves registry intact after uninstalling a slug that is not present", async () => {
    // Arrange
    const apps: InstalledApp[] = [
      {
        slug: "keeper",
        name: "Keeper",
        type: "local_agent",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
    ];
    await writeFile(
      join(_tempKronusDir, "installed-apps.json"),
      JSON.stringify(apps, null, 2)
    );

    // Act
    await uninstallApp("missing-slug");
    const registry = await listInstalledApps();

    // Assert — keeper is still there
    expect(registry).toHaveLength(1);
    expect(registry[0]?.slug).toBe("keeper");
  });
});

// ── updateApps ────────────────────────────────────────────────────────────────

describe("updateApps", () => {
  test("reinstalls all apps in the registry and returns their slugs", async () => {
    // Arrange — registry has two apps
    const apps: InstalledApp[] = [
      {
        slug: "tool-one",
        name: "Tool One",
        type: "developer_mcp",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
      {
        slug: "tool-two",
        name: "Tool Two",
        type: "local_skill",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
    ];
    await writeFile(
      join(_tempKronusDir, "installed-apps.json"),
      JSON.stringify(apps, null, 2)
    );

    // Return a successful install response for any slug
    globalThis.fetch = mock((input: string | Request | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : input.toString();
      const slug = url.split("/apps/")[1]?.replace("/install", "") ?? "unknown";
      return Promise.resolve(
        makeResponse(
          makeHubInstallResponse({ app: { slug, name: slug, type: "developer_mcp" } })
        )
      );
    });

    // Act
    const updated = await updateApps();

    // Assert — both slugs returned
    expect(updated).toContain("tool-one");
    expect(updated).toContain("tool-two");
    expect(updated).toHaveLength(2);
  });

  test("returns empty array when no apps are installed", async () => {
    // Arrange — registry is empty (no file)
    globalThis.fetch = mock(() =>
      Promise.resolve(makeResponse(makeHubInstallResponse()))
    );

    // Act
    const updated = await updateApps();

    // Assert
    expect(updated).toEqual([]);
  });

  test("skips a failing app and continues updating the rest", async () => {
    // Arrange
    const apps: InstalledApp[] = [
      {
        slug: "fails-on-update",
        name: "Fails On Update",
        type: "developer_mcp",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
      {
        slug: "succeeds-on-update",
        name: "Succeeds On Update",
        type: "local_skill",
        version: "1.0.0",
        installed_at: "2026-01-01T00:00:00Z",
      },
    ];
    await writeFile(
      join(_tempKronusDir, "installed-apps.json"),
      JSON.stringify(apps, null, 2)
    );

    globalThis.fetch = mock((input: string | Request | URL) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof Request
          ? input.url
          : input.toString();

      if (url.includes("fails-on-update")) {
        return Promise.resolve(
          new Response("Server Error", { status: 500, statusText: "Server Error" })
        );
      }
      return Promise.resolve(
        makeResponse(
          makeHubInstallResponse({
            app: { slug: "succeeds-on-update", name: "Succeeds On Update", type: "local_skill" },
          })
        )
      );
    });

    // Act
    const updated = await updateApps();

    // Assert — only the successful one is in the returned list
    expect(updated).not.toContain("fails-on-update");
    expect(updated).toContain("succeeds-on-update");
  });

  test("throws when not connected (identity is null)", async () => {
    // Arrange
    _mockIdentity = null;

    // Act + Assert
    await expect(updateApps()).rejects.toThrow(
      "Not connected — run 'kronus connect' first"
    );
  });
});
