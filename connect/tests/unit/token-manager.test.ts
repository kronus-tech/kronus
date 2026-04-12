/**
 * Unit tests for connect/src/token-manager.ts
 *
 * Strategy:
 * - Mock the identity module (loadIdentity / saveIdentity) via mock.module
 * - Mock global fetch for all HTTP calls
 * - Fake JWTs are base64url-encoded payloads — decodeJwt only decodes, never verifies
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// ── Fake JWT helper ───────────────────────────────────────────────────────────

/**
 * Builds a structurally valid JWT with a controlled `exp` claim.
 * The signature is a stub — jose.decodeJwt only decodes the payload, never verifies.
 */
function fakeJwt(exp: number, sub = "krn_usr_test"): string {
  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const header = b64url({ alg: "EdDSA", typ: "JWT" });
  const payload = b64url({ sub, exp });
  return `${header}.${payload}.fakesig`;
}

// ── Shared mock state ─────────────────────────────────────────────────────────

const mockIdentityStore = {
  current: null as import("../../src/types.js").Identity | null,
};

const mockLoadIdentity = mock(() => Promise.resolve(mockIdentityStore.current));
const mockSaveIdentity = mock(
  (identity: import("../../src/types.js").Identity) => {
    mockIdentityStore.current = identity;
    return Promise.resolve();
  }
);

// Mock the identity module before importing token-manager
mock.module("../../src/identity.js", () => ({
  loadIdentity: mockLoadIdentity,
  saveIdentity: mockSaveIdentity,
}));

// Import after mocking so the module receives mocked deps
const { getAccessToken, refreshAccessToken, onTokenRefreshed } = await import(
  "../../src/token-manager.js"
);

// ── Test fixture factory ──────────────────────────────────────────────────────

function makeIdentity(
  accessToken: string,
  refreshToken = "rtoken_test"
): import("../../src/types.js").Identity {
  return {
    instance_id: "krn_inst_test",
    hub_url: "http://hub.test",
    public_key: "{}",
    private_key: "{}",
    access_token: accessToken,
    refresh_token: refreshToken,
    registered_at: "2026-01-01T00:00:00Z",
    user_id: "krn_usr_test",
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
  mockLoadIdentity.mockClear();
  mockSaveIdentity.mockClear();
  mockIdentityStore.current = null;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── getAccessToken ────────────────────────────────────────────────────────────

describe("getAccessToken", () => {
  test("returns cached token when exp is more than 5 minutes in the future", async () => {
    const futureExp = Math.floor(Date.now() / 1000) + 600; // 10 min from now
    const token = fakeJwt(futureExp);
    mockIdentityStore.current = makeIdentity(token);

    const result = await getAccessToken();

    expect(result).toBe(token);
    // No HTTP call should have been made
    expect(mockLoadIdentity).toHaveBeenCalledTimes(1);
  });

  test("calls refreshAccessToken when exp is less than 5 minutes away", async () => {
    const nearExp = Math.floor(Date.now() / 1000) + 200; // only 3.3 min remaining
    const oldToken = fakeJwt(nearExp);
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);

    mockIdentityStore.current = makeIdentity(oldToken);

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await getAccessToken();

    expect(result).toBe(newToken);
  });

  test("calls refreshAccessToken when token exp is exactly at the 5-minute boundary", async () => {
    // exp = now + 300 means timeRemaining === 300, which is NOT > 300, so refresh is needed
    const boundaryExp = Math.floor(Date.now() / 1000) + 300;
    const oldToken = fakeJwt(boundaryExp);
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);

    mockIdentityStore.current = makeIdentity(oldToken);

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await getAccessToken();

    expect(result).toBe(newToken);
  });

  test("calls refreshAccessToken when token is unparseable / corrupt", async () => {
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);

    // Store a token that is not a valid JWT structure — decodeJwt will throw
    mockIdentityStore.current = makeIdentity("not.a.valid.jwt");

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await getAccessToken();

    expect(result).toBe(newToken);
  });

  test("calls refreshAccessToken when token has no exp claim", async () => {
    // Build a JWT payload without an `exp` field
    const b64url = (obj: object) =>
      btoa(JSON.stringify(obj))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const noExpToken = `${b64url({ alg: "EdDSA", typ: "JWT" })}.${b64url({ sub: "krn_usr_test" })}.fakesig`;
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);

    mockIdentityStore.current = makeIdentity(noExpToken);

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    // No exp means the code falls through to refresh
    const result = await getAccessToken();
    expect(result).toBe(newToken);
  });

  test("throws when no identity exists (loadIdentity returns null)", async () => {
    mockIdentityStore.current = null; // no identity on disk

    await expect(getAccessToken()).rejects.toThrow(
      "Not connected — run 'kronus connect' first"
    );
  });
});

// ── refreshAccessToken ────────────────────────────────────────────────────────

describe("refreshAccessToken", () => {
  test("POSTs to /auth/refresh with refresh_token in body", async () => {
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);
    const identity = makeIdentity(fakeJwt(0), "my_refresh_token");

    let capturedUrl: string | null = null;
    let capturedInit: RequestInit | null = null;
    globalThis.fetch = mock((input: string | Request | URL, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
      capturedInit = init ?? null;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    await refreshAccessToken(identity);

    expect(capturedUrl).toBe("http://hub.test/auth/refresh");
    expect(capturedInit?.method).toBe("POST");

    const body = JSON.parse(capturedInit?.body as string);
    expect(body).toEqual({ refresh_token: "my_refresh_token" });
  });

  test("updates the identity file via saveIdentity with new access_token", async () => {
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);
    const identity = makeIdentity(fakeJwt(0), "rtoken");

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await refreshAccessToken(identity);

    expect(mockSaveIdentity).toHaveBeenCalledTimes(1);
    const savedIdentity = mockSaveIdentity.mock.calls[0][0] as import("../../src/types.js").Identity;
    expect(savedIdentity.access_token).toBe(newToken);
    // Other fields should be preserved
    expect(savedIdentity.refresh_token).toBe("rtoken");
    expect(savedIdentity.instance_id).toBe("krn_inst_test");
  });

  test("fires onTokenRefreshed callback with new access_token", async () => {
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);
    const identity = makeIdentity(fakeJwt(0));
    const callbackReceived: string[] = [];

    onTokenRefreshed((token) => {
      callbackReceived.push(token);
    });

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    await refreshAccessToken(identity);

    expect(callbackReceived).toHaveLength(1);
    expect(callbackReceived[0]).toBe(newToken);

    // Reset callback to avoid leaking into other tests
    onTokenRefreshed(() => {});
  });

  test("returns the new access_token string", async () => {
    const newToken = fakeJwt(Math.floor(Date.now() / 1000) + 900);
    const identity = makeIdentity(fakeJwt(0));

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ access_token: newToken }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      )
    );

    const result = await refreshAccessToken(identity);

    expect(result).toBe(newToken);
  });

  test("throws on HTTP 401 response", async () => {
    const identity = makeIdentity(fakeJwt(0));

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        })
      )
    );

    await expect(refreshAccessToken(identity)).rejects.toThrow(
      "Token refresh failed: 401 Unauthorized"
    );
  });

  test("throws on HTTP 500 response", async () => {
    const identity = makeIdentity(fakeJwt(0));

    globalThis.fetch = mock(() =>
      Promise.resolve(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      )
    );

    await expect(refreshAccessToken(identity)).rejects.toThrow(
      "Token refresh failed: 500 Internal Server Error"
    );
  });

  test("throws on network failure", async () => {
    const identity = makeIdentity(fakeJwt(0));

    globalThis.fetch = mock(() =>
      Promise.reject(new Error("fetch failed"))
    );

    await expect(refreshAccessToken(identity)).rejects.toThrow("fetch failed");
  });

  test("does not call saveIdentity when HTTP request fails", async () => {
    const identity = makeIdentity(fakeJwt(0));

    globalThis.fetch = mock(() =>
      Promise.resolve(new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }))
    );

    await expect(refreshAccessToken(identity)).rejects.toThrow();
    expect(mockSaveIdentity).not.toHaveBeenCalled();
  });
});
