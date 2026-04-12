// health.test.ts
//
// IMPORTANT: process.env must be populated with the required vars BEFORE the
// `app` module is imported, because hub/src/index.ts calls getConfig() at the
// top level during module initialisation. We set the vars here, at the top of
// the file, so they are in place for the static `import` below.

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";

import { describe, it, expect } from "bun:test";
import { app } from "../../src/index.js";

// ---------------------------------------------------------------------------
// /health endpoint
// ---------------------------------------------------------------------------

describe("GET /health — status code", () => {
  it("returns 200", async () => {
    // Arrange & Act
    const response = await app.request("/health");

    // Assert
    expect(response.status).toBe(200);
  });
});

describe("GET /health — response body", () => {
  it("returns JSON with status 'ok'", async () => {
    // Arrange & Act
    const response = await app.request("/health");
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["status"]).toBe("ok");
  });

  it("returns JSON with version '5.3.0'", async () => {
    // Arrange & Act
    const response = await app.request("/health");
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["version"]).toBe("5.3.0");
  });

  it("returns JSON with a timestamp field", async () => {
    // Arrange & Act
    const response = await app.request("/health");
    const body = await response.json() as Record<string, unknown>;

    // Assert
    expect(body["timestamp"]).toBeDefined();
  });

  it("timestamp is a valid ISO 8601 string", async () => {
    // Arrange & Act
    const response = await app.request("/health");
    const body = await response.json() as Record<string, unknown>;

    // Assert
    const ts = body["timestamp"] as string;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it("timestamp is reasonably close to the current time", async () => {
    // Arrange
    const before = Date.now();

    // Act
    const response = await app.request("/health");
    const body = await response.json() as Record<string, unknown>;
    const after = Date.now();

    // Assert — timestamp must fall within the request window (±5 s tolerance)
    const ts = new Date(body["timestamp"] as string).getTime();
    expect(ts).toBeGreaterThanOrEqual(before - 5000);
    expect(ts).toBeLessThanOrEqual(after + 5000);
  });

  it("Content-Type header is application/json", async () => {
    // Arrange & Act
    const response = await app.request("/health");

    // Assert
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

// ---------------------------------------------------------------------------
// Unknown routes
// ---------------------------------------------------------------------------

describe("unknown routes", () => {
  it("returns 404 for an unknown GET route", async () => {
    // Arrange & Act
    const response = await app.request("/does-not-exist");

    // Assert
    expect(response.status).toBe(404);
  });

  it("returns 404 for a deep unknown path", async () => {
    // Arrange & Act
    const response = await app.request("/api/v1/unknown/nested/path");

    // Assert
    expect(response.status).toBe(404);
  });

  it("returns 404 for POST to an undefined route", async () => {
    // Arrange & Act
    const response = await app.request("/health", { method: "POST" });

    // Assert — Hono returns 404 for unregistered method+path combinations
    expect(response.status).toBe(404);
  });
});
