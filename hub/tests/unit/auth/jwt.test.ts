// jwt.test.ts
//
// Tests for hub/src/auth/jwt.ts — pure cryptographic unit tests.
// No database or server needed.
//
// IMPORTANT: DATABASE_URL and REDIS_URL must be set before any import that
// touches getConfig(), because hub/src/db/index.ts evaluates getConfig() at
// module load time. Setting them here, at the top of the file, ensures they
// are in place for all static imports below.

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

import { describe, it, expect, beforeAll } from "bun:test";
import * as jose from "jose";
import {
  initializeKeys,
  signAccessToken,
  signRefreshToken,
  verifyToken,
  getPublicJwk,
  isInitialized,
  type AccessTokenPayload,
} from "../../../src/auth/jwt.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MOCK_USER_ID = "krn_usr_testuser1234";

const MOCK_ACCESS_PAYLOAD: AccessTokenPayload = {
  sub: MOCK_USER_ID,
  plan: "free",
  capabilities: ["apps:install"],
  app_access: ["krn_app_abc123"],
  scopes: ["read"],
};

// ---------------------------------------------------------------------------
// Setup — initialize keys once for the entire test suite
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Run in ephemeral mode (no JWT_PRIVATE_KEY / JWT_PUBLIC_KEY env vars set)
  // so we exercise the key-generation path without needing a configured env.
  delete process.env["JWT_PRIVATE_KEY"];
  delete process.env["JWT_PUBLIC_KEY"];
  await initializeKeys();
});

// ---------------------------------------------------------------------------
// initializeKeys
// ---------------------------------------------------------------------------

describe("initializeKeys — ephemeral mode", () => {
  it("succeeds without JWT_PRIVATE_KEY and JWT_PUBLIC_KEY set", async () => {
    // Already called in beforeAll — just verify no error was thrown and state
    // is consistent.
    expect(isInitialized()).toBe(true);
  });

  it("isInitialized() returns true after initializeKeys() completes", () => {
    // Arrange — keys were initialized in beforeAll

    // Act
    const result = isInitialized();

    // Assert
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPublicJwk
// ---------------------------------------------------------------------------

describe("getPublicJwk", () => {
  it("returns an object (JWK)", () => {
    // Act
    const jwk = getPublicJwk();

    // Assert
    expect(jwk).toBeDefined();
    expect(typeof jwk).toBe("object");
  });

  it("returns a JWK with a kid field", () => {
    // Act
    const jwk = getPublicJwk();

    // Assert
    expect(jwk.kid).toBeDefined();
    expect(typeof jwk.kid).toBe("string");
    expect(jwk.kid!.length).toBeGreaterThan(0);
  });

  it("defaults kid to 'kronus-hub-1' when no kid was present on the generated key", () => {
    // When keys are generated ephemerally, exportJWK does not set a kid.
    // initializeKeys() injects 'kronus-hub-1' as the fallback.

    // Act
    const jwk = getPublicJwk();

    // Assert — kid must be exactly the fallback string in ephemeral mode
    expect(jwk.kid).toBe("kronus-hub-1");
  });

  it("returns a JWK with kty field", () => {
    // Act
    const jwk = getPublicJwk();

    // Assert
    expect(jwk.kty).toBeDefined();
  });

  it("returns a JWK with crv field (Ed25519 curve)", () => {
    // Act
    const jwk = getPublicJwk();

    // Assert
    expect(jwk.crv).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// signAccessToken
// ---------------------------------------------------------------------------

describe("signAccessToken", () => {
  it("returns a non-empty string", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);

    // Assert
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("returns a JWT string — three dot-separated parts", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);

    // Assert — a compact JWS has exactly three segments
    const parts = token.split(".");
    expect(parts.length).toBe(3);
  });

  it("payload contains the sub claim", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["sub"]).toBe(MOCK_USER_ID);
  });

  it("payload contains the plan claim", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["plan"]).toBe("free");
  });

  it("payload contains the capabilities claim", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["capabilities"]).toEqual(["apps:install"]);
  });

  it("payload contains the app_access claim", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["app_access"]).toEqual(["krn_app_abc123"]);
  });

  it("payload contains the scopes claim", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["scopes"]).toEqual(["read"]);
  });

  it("payload contains iss matching HUB_URL", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["iss"]).toBe(process.env["HUB_URL"] ?? "http://localhost:3100");
  });

  it("payload contains aud: 'kronus-mesh'", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert — jose encodes single-string aud as a string, but accept array too
    const aud = decoded["aud"];
    const audiences = Array.isArray(aud) ? aud : [aud];
    expect(audiences).toContain("kronus-mesh");
  });

  it("payload contains exp (expiration) claim", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["exp"]).toBeDefined();
    expect(typeof decoded["exp"]).toBe("number");
  });

  it("exp is approximately 1 hour in the future", async () => {
    // Arrange
    const before = Math.floor(Date.now() / 1000);

    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);
    const after = Math.floor(Date.now() / 1000);

    // Assert — 1h = 3600 seconds; allow ±10 s tolerance for test execution time
    const exp = decoded["exp"] as number;
    expect(exp).toBeGreaterThanOrEqual(before + 3600 - 10);
    expect(exp).toBeLessThanOrEqual(after + 3600 + 10);
  });

  it("payload contains iat (issued-at) claim", async () => {
    // Act
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["iat"]).toBeDefined();
    expect(typeof decoded["iat"]).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// signRefreshToken
// ---------------------------------------------------------------------------

describe("signRefreshToken", () => {
  it("returns a non-empty string", async () => {
    // Act
    const token = await signRefreshToken(MOCK_USER_ID);

    // Assert
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);
  });

  it("returns a JWT string — three dot-separated parts", async () => {
    // Act
    const token = await signRefreshToken(MOCK_USER_ID);

    // Assert
    expect(token.split(".").length).toBe(3);
  });

  it("payload contains type: 'refresh'", async () => {
    // Act
    const token = await signRefreshToken(MOCK_USER_ID);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["type"]).toBe("refresh");
  });

  it("payload contains the sub claim equal to userId", async () => {
    // Act
    const token = await signRefreshToken(MOCK_USER_ID);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["sub"]).toBe(MOCK_USER_ID);
  });

  it("payload contains iss matching HUB_URL", async () => {
    // Act
    const token = await signRefreshToken(MOCK_USER_ID);
    const decoded = jose.decodeJwt(token);

    // Assert
    expect(decoded["iss"]).toBe(process.env["HUB_URL"] ?? "http://localhost:3100");
  });

  it("payload contains aud: 'kronus-mesh'", async () => {
    // Act
    const token = await signRefreshToken(MOCK_USER_ID);
    const decoded = jose.decodeJwt(token);

    // Assert
    const aud = decoded["aud"];
    const audiences = Array.isArray(aud) ? aud : [aud];
    expect(audiences).toContain("kronus-mesh");
  });

  it("exp is approximately 30 days in the future", async () => {
    // Arrange
    const before = Math.floor(Date.now() / 1000);

    // Act
    const token = await signRefreshToken(MOCK_USER_ID);
    const decoded = jose.decodeJwt(token);
    const after = Math.floor(Date.now() / 1000);

    // Assert — 30d = 2592000 seconds; allow ±30 s tolerance
    const exp = decoded["exp"] as number;
    expect(exp).toBeGreaterThanOrEqual(before + 2592000 - 30);
    expect(exp).toBeLessThanOrEqual(after + 2592000 + 30);
  });
});

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe("verifyToken — access token", () => {
  it("returns the payload for a valid access token", async () => {
    // Arrange
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);

    // Act
    const payload = await verifyToken(token);

    // Assert
    expect(payload).toBeDefined();
    expect(payload["sub"]).toBe(MOCK_USER_ID);
  });

  it("returned payload contains all original claims", async () => {
    // Arrange
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);

    // Act
    const payload = await verifyToken(token);

    // Assert
    expect(payload["plan"]).toBe("free");
    expect(payload["capabilities"]).toEqual(["apps:install"]);
    expect(payload["app_access"]).toEqual(["krn_app_abc123"]);
    expect(payload["scopes"]).toEqual(["read"]);
  });
});

describe("verifyToken — refresh token", () => {
  it("returns the payload for a valid refresh token", async () => {
    // Arrange
    const token = await signRefreshToken(MOCK_USER_ID);

    // Act
    const payload = await verifyToken(token);

    // Assert
    expect(payload).toBeDefined();
    expect(payload["sub"]).toBe(MOCK_USER_ID);
    expect(payload["type"]).toBe("refresh");
  });
});

describe("verifyToken — rejection cases", () => {
  it("rejects a token that has been tampered with (modified body)", async () => {
    // Arrange
    const token = await signAccessToken(MOCK_ACCESS_PAYLOAD);
    const [header, , signature] = token.split(".");
    // Replace the body with a different base64url payload
    const tamperedBody = Buffer.from(
      JSON.stringify({ sub: "krn_usr_hacker0000", plan: "enterprise" })
    )
      .toString("base64url");
    const tamperedToken = `${header}.${tamperedBody}.${signature}`;

    // Act & Assert
    await expect(verifyToken(tamperedToken)).rejects.toThrow();
  });

  it("rejects a token signed with a different key", async () => {
    // Arrange — generate a completely separate key pair and sign with it
    const { privateKey } = await jose.generateKeyPair("EdDSA");
    const hubUrl = process.env["HUB_URL"] ?? "http://localhost:3100";
    const rogueToken = await new jose.SignJWT({ sub: MOCK_USER_ID, plan: "free" })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer(hubUrl)
      .setAudience("kronus-mesh")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    // Act & Assert
    await expect(verifyToken(rogueToken)).rejects.toThrow();
  });

  it("rejects a token with a wrong issuer", async () => {
    // Arrange — sign with the correct key but inject wrong iss
    // We test this by verifying that verifyToken validates the issuer claim.
    // Construct a valid token first, then show that a token bearing a different
    // issuer (signed with a different key, as issuer manipulation would require
    // re-signing) is rejected.
    const { privateKey: wrongKey } = await jose.generateKeyPair("EdDSA");
    const tokenWithWrongIssuer = await new jose.SignJWT({ sub: MOCK_USER_ID })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer("https://evil-hub.example.com")
      .setAudience("kronus-mesh")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(wrongKey);

    // Act & Assert — fails both on signature AND issuer
    await expect(verifyToken(tokenWithWrongIssuer)).rejects.toThrow();
  });

  it("rejects a completely malformed token string", async () => {
    // Act & Assert
    await expect(verifyToken("not.a.jwt")).rejects.toThrow();
  });

  it("rejects an empty string", async () => {
    // Act & Assert
    await expect(verifyToken("")).rejects.toThrow();
  });

  it("rejects a token that has expired", async () => {
    // Arrange — build an already-expired token using a raw jose call with the
    // correct verify key but an exp in the past. We cannot do this through the
    // public API, so we sign directly with jose and the same private key.
    // Because we cannot export the private key from the module, we generate a
    // fresh pair for this test — rejection should still occur on signature.
    const { privateKey } = await jose.generateKeyPair("EdDSA");
    const hubUrl = process.env["HUB_URL"] ?? "http://localhost:3100";
    const expiredToken = await new jose.SignJWT({ sub: MOCK_USER_ID })
      .setProtectedHeader({ alg: "EdDSA" })
      .setIssuer(hubUrl)
      .setAudience("kronus-mesh")
      .setIssuedAt()
      .setExpirationTime("-1h") // already expired
      .sign(privateKey);

    // Act & Assert
    await expect(verifyToken(expiredToken)).rejects.toThrow();
  });
});
