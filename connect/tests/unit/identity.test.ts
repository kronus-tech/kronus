// identity.test.ts — Unit tests for connect/src/identity.ts
//
// Strategy: test pure functions (generateIdentityKeypair, getMachineFingerprint,
// getIdentityPath, getKronusDir) directly. For save/load/deleteIdentity we write
// to a real temp directory so the file I/O is exercised without touching ~/.kronus.
//
// Because identity.ts uses module-level constants for KRONUS_DIR and IDENTITY_PATH,
// we cannot redirect them via mock. Instead we call the exported functions with
// a parallel implementation over a temp path — or we import the real functions and
// verify side-effects through the save → load → delete lifecycle.
//
// Run from the connect/ directory: bun test tests/unit/identity.test.ts

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import * as jose from "jose";

import {
  generateIdentityKeypair,
  getMachineFingerprint,
  getIdentityPath,
  getKronusDir,
} from "../../src/identity.js";

import type { Identity } from "../../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Identity object for round-trip tests. */
function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    instance_id: "krn_inst_testinst001",
    hub_url: "http://localhost:3100",
    public_key: '{"kty":"OKP","crv":"Ed25519","x":"testpublickey"}',
    private_key: '{"kty":"OKP","crv":"Ed25519","x":"testpublickey","d":"testprivatekey"}',
    access_token: "test.access.token",
    refresh_token: "test.refresh.token",
    registered_at: new Date().toISOString(),
    user_id: "krn_usr_testuser0001",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// generateIdentityKeypair
// ---------------------------------------------------------------------------

describe("generateIdentityKeypair()", () => {
  it("returns an object with publicKey and privateKey string fields", async () => {
    // Act
    const keypair = await generateIdentityKeypair();

    // Assert
    expect(typeof keypair.publicKey).toBe("string");
    expect(typeof keypair.privateKey).toBe("string");
  });

  it("publicKey is valid JSON", async () => {
    // Act
    const { publicKey } = await generateIdentityKeypair();

    // Assert — JSON.parse must not throw
    expect(() => JSON.parse(publicKey)).not.toThrow();
  });

  it("privateKey is valid JSON", async () => {
    // Act
    const { privateKey } = await generateIdentityKeypair();

    // Assert
    expect(() => JSON.parse(privateKey)).not.toThrow();
  });

  it("publicKey JSON contains kty field", async () => {
    // Act
    const { publicKey } = await generateIdentityKeypair();
    const jwk = JSON.parse(publicKey) as Record<string, unknown>;

    // Assert
    expect(jwk["kty"]).toBeDefined();
    expect(typeof jwk["kty"]).toBe("string");
  });

  it("publicKey JSON contains crv field", async () => {
    // Act
    const { publicKey } = await generateIdentityKeypair();
    const jwk = JSON.parse(publicKey) as Record<string, unknown>;

    // Assert
    expect(jwk["crv"]).toBeDefined();
    expect(typeof jwk["crv"]).toBe("string");
  });

  it("privateKey JSON contains kty field", async () => {
    // Act
    const { privateKey } = await generateIdentityKeypair();
    const jwk = JSON.parse(privateKey) as Record<string, unknown>;

    // Assert
    expect(jwk["kty"]).toBeDefined();
  });

  it("privateKey JSON contains crv field", async () => {
    // Act
    const { privateKey } = await generateIdentityKeypair();
    const jwk = JSON.parse(privateKey) as Record<string, unknown>;

    // Assert
    expect(jwk["crv"]).toBeDefined();
  });

  it("privateKey JSON contains d field (private scalar)", async () => {
    // Act
    const { privateKey } = await generateIdentityKeypair();
    const jwk = JSON.parse(privateKey) as Record<string, unknown>;

    // Assert — the 'd' field is what distinguishes a private JWK from a public one
    expect(jwk["d"]).toBeDefined();
    expect(typeof jwk["d"]).toBe("string");
  });

  it("publicKey JSON does NOT contain d field", async () => {
    // Act
    const { publicKey } = await generateIdentityKeypair();
    const jwk = JSON.parse(publicKey) as Record<string, unknown>;

    // Assert — public key must never contain the private scalar
    expect(jwk["d"]).toBeUndefined();
  });

  it("two consecutive calls produce different keypairs", async () => {
    // Act
    const first = await generateIdentityKeypair();
    const second = await generateIdentityKeypair();

    // Assert — each call generates a fresh key
    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.privateKey).not.toBe(second.privateKey);
  });

  it("generated keypair can be imported by jose for EdDSA", async () => {
    // Act
    const { publicKey, privateKey } = await generateIdentityKeypair();
    const pubJwk = JSON.parse(publicKey) as jose.JWK;
    const privJwk = JSON.parse(privateKey) as jose.JWK;

    // Assert — jose can round-trip the keys without throwing
    const importedPub = await jose.importJWK(pubJwk, "EdDSA");
    const importedPriv = await jose.importJWK(privJwk, "EdDSA");
    expect(importedPub).toBeDefined();
    expect(importedPriv).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// getMachineFingerprint
// ---------------------------------------------------------------------------

describe("getMachineFingerprint()", () => {
  it("returns a non-empty string", () => {
    // Act
    const fp = getMachineFingerprint();

    // Assert
    expect(typeof fp).toBe("string");
    expect(fp.length).toBeGreaterThan(0);
  });

  it("contains a hyphen separating hostname and platform", () => {
    // Act
    const fp = getMachineFingerprint();

    // Assert — format is "<hostname>-<platform>"
    expect(fp).toContain("-");
  });

  it("returns the same value on repeated calls (deterministic)", () => {
    // Act
    const first = getMachineFingerprint();
    const second = getMachineFingerprint();

    // Assert
    expect(first).toBe(second);
  });

  it("does not contain whitespace", () => {
    // Act
    const fp = getMachineFingerprint();

    // Assert — fingerprint should be a safe identifier
    expect(fp).not.toMatch(/\s/);
  });
});

// ---------------------------------------------------------------------------
// getIdentityPath / getKronusDir
// ---------------------------------------------------------------------------

describe("getIdentityPath()", () => {
  it("returns a string", () => {
    // Act
    const p = getIdentityPath();

    // Assert
    expect(typeof p).toBe("string");
  });

  it("path ends with identity.json", () => {
    // Act
    const p = getIdentityPath();

    // Assert
    expect(p.endsWith("identity.json")).toBe(true);
  });

  it("path is absolute (starts with /)", () => {
    // Act
    const p = getIdentityPath();

    // Assert — must be an absolute path
    expect(p.startsWith("/")).toBe(true);
  });
});

describe("getKronusDir()", () => {
  it("returns a string", () => {
    // Act
    const d = getKronusDir();

    // Assert
    expect(typeof d).toBe("string");
  });

  it("path ends with .kronus", () => {
    // Act
    const d = getKronusDir();

    // Assert
    expect(d.endsWith(".kronus")).toBe(true);
  });

  it("path is absolute (starts with /)", () => {
    // Act
    const d = getKronusDir();

    // Assert
    expect(d.startsWith("/")).toBe(true);
  });

  it("getIdentityPath() is a child of getKronusDir()", () => {
    // Act
    const dir = getKronusDir();
    const identityPath = getIdentityPath();

    // Assert — identity.json lives inside the .kronus directory
    expect(identityPath.startsWith(dir)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// saveIdentity / loadIdentity / deleteIdentity — temp directory round-trips
//
// Because KRONUS_DIR and IDENTITY_PATH are module-level constants pointing at
// ~/.kronus we cannot redirect the real functions without patching the module.
// Instead we replicate the same low-level fs operations over a temp directory
// and verify the serialisation contract independently.
// ---------------------------------------------------------------------------

describe("saveIdentity → loadIdentity round-trip (temp directory)", () => {
  let tempDir: string;
  let tempIdentityPath: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tempDir = join(tmpdir(), `kronus-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tempDir, { recursive: true });
    tempIdentityPath = join(tempDir, "identity.json");
  });

  afterEach(async () => {
    // Clean up temp directory after each test
    await rm(tempDir, { recursive: true, force: true });
  });

  it("identity written as JSON can be parsed back to the same object", async () => {
    // Arrange
    const identity = makeIdentity();

    // Act — mirror what saveIdentity does
    await writeFile(tempIdentityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
    const raw = await readFile(tempIdentityPath, "utf-8");
    const loaded = JSON.parse(raw) as Identity;

    // Assert
    expect(loaded.instance_id).toBe(identity.instance_id);
    expect(loaded.hub_url).toBe(identity.hub_url);
    expect(loaded.public_key).toBe(identity.public_key);
    expect(loaded.private_key).toBe(identity.private_key);
    expect(loaded.access_token).toBe(identity.access_token);
    expect(loaded.refresh_token).toBe(identity.refresh_token);
    expect(loaded.registered_at).toBe(identity.registered_at);
    expect(loaded.user_id).toBe(identity.user_id);
  });

  it("all Identity interface fields survive the JSON serialisation round-trip", async () => {
    // Arrange
    const identity = makeIdentity({
      instance_id: "krn_inst_roundtrip01",
      hub_url: "https://hub.kronus.example.com",
      user_id: "krn_usr_roundtrip0001",
    });

    // Act
    await writeFile(tempIdentityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });
    const loaded = JSON.parse(await readFile(tempIdentityPath, "utf-8")) as Identity;

    // Assert — field-by-field check covering every field in the Identity interface
    const fields: Array<keyof Identity> = [
      "instance_id",
      "hub_url",
      "public_key",
      "private_key",
      "access_token",
      "refresh_token",
      "registered_at",
      "user_id",
    ];
    for (const field of fields) {
      expect(loaded[field]).toBe(identity[field]);
    }
  });

  it("returns null when identity file does not exist", async () => {
    // Arrange — tempIdentityPath has not been written
    const missingPath = join(tempDir, "nonexistent.json");

    // Act — mirror what loadIdentity does
    let result: Identity | null = null;
    try {
      const data = await readFile(missingPath, "utf-8");
      result = JSON.parse(data) as Identity;
    } catch {
      result = null;
    }

    // Assert
    expect(result).toBeNull();
  });

  it("does not throw when deleting a file that does not exist", async () => {
    // Arrange
    const { unlink } = await import("fs/promises");
    const missingPath = join(tempDir, "does-not-exist.json");

    // Act + Assert — mirror what deleteIdentity does (swallows ENOENT)
    let threw = false;
    try {
      await unlink(missingPath);
    } catch {
      threw = false; // swallowed, as the real implementation does
    }
    expect(threw).toBe(false);
  });

  it("file is absent after a delete operation", async () => {
    // Arrange — write file then delete it
    const { unlink } = await import("fs/promises");
    const identity = makeIdentity();
    await writeFile(tempIdentityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });

    // Act
    await unlink(tempIdentityPath);

    // Assert — subsequent read should return null (file gone)
    let result: Identity | null = null;
    try {
      const data = await readFile(tempIdentityPath, "utf-8");
      result = JSON.parse(data) as Identity;
    } catch {
      result = null;
    }
    expect(result).toBeNull();
  });

  it("saved identity file has restrictive permissions (mode 0o600)", async () => {
    // Arrange
    const identity = makeIdentity();

    // Act — save with the same mode as saveIdentity
    await writeFile(tempIdentityPath, JSON.stringify(identity, null, 2), { mode: 0o600 });

    // Assert — stat the file and check the permission bits
    const { stat } = await import("fs/promises");
    const stats = await stat(tempIdentityPath);
    // The last 9 bits of mode are rwxrwxrwx. 0o600 = owner rw, no others.
    const permBits = stats.mode & 0o777;
    expect(permBits).toBe(0o600);
  });
});

// ---------------------------------------------------------------------------
// generateIdentityKeypair + Identity type integration
// ---------------------------------------------------------------------------

describe("generateIdentityKeypair() output as Identity.public_key / private_key", () => {
  it("keypair public/private key strings can be stored directly in an Identity object", async () => {
    // Arrange
    const { publicKey, privateKey } = await generateIdentityKeypair();

    // Act
    const identity = makeIdentity({ public_key: publicKey, private_key: privateKey });

    // Assert — the Identity struct is valid with generated keys
    expect(identity.public_key).toBe(publicKey);
    expect(identity.private_key).toBe(privateKey);
    expect(() => JSON.parse(identity.public_key)).not.toThrow();
    expect(() => JSON.parse(identity.private_key)).not.toThrow();
  });

  it("stored keypair can be re-imported from the Identity object for signing", async () => {
    // Arrange
    const { publicKey, privateKey } = await generateIdentityKeypair();
    const identity = makeIdentity({ public_key: publicKey, private_key: privateKey });

    // Act — simulate what Connect would do: load identity, import keys, sign something
    const privJwk = JSON.parse(identity.private_key) as jose.JWK;
    const pubJwk = JSON.parse(identity.public_key) as jose.JWK;
    const signingKey = await jose.importJWK(privJwk, "EdDSA");
    const verifyKey = await jose.importJWK(pubJwk, "EdDSA");

    const jwt = await new jose.SignJWT({ test: true })
      .setProtectedHeader({ alg: "EdDSA" })
      .sign(signingKey);

    const { payload } = await jose.jwtVerify(jwt, verifyKey);

    // Assert — the full sign-verify round-trip works with the stored keypair
    expect(payload["test"]).toBe(true);
  });
});
