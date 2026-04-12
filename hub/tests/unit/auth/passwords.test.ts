// passwords.test.ts
//
// Tests for hub/src/auth/passwords.ts — pure unit tests.
// No database or network needed. Uses @node-rs/argon2 directly.

import { describe, it, expect } from "bun:test";
import { hashPassword, verifyPassword } from "../../../src/auth/passwords.js";

// ---------------------------------------------------------------------------
// hashPassword
// ---------------------------------------------------------------------------

describe("hashPassword", () => {
  it("returns a non-empty string", async () => {
    // Act
    const result = await hashPassword("correct-horse-battery-staple");

    // Assert
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns a string starting with '$argon2' (argon2 hash identifier)", async () => {
    // Act
    const result = await hashPassword("my-secret-password");

    // Assert
    expect(result.startsWith("$argon2")).toBe(true);
  });

  it("produces a different hash on each call for the same password (salted)", async () => {
    // Arrange
    const password = "same-password-every-time";

    // Act — hash twice
    const hash1 = await hashPassword(password);
    const hash2 = await hashPassword(password);

    // Assert — salted hashes must differ
    expect(hash1).not.toBe(hash2);
  });

  it("produces a hash for a minimum-length password (8 chars)", async () => {
    // Act
    const result = await hashPassword("12345678");

    // Assert
    expect(result.startsWith("$argon2")).toBe(true);
  });

  it("produces a hash for a long password (256 chars)", async () => {
    // Arrange
    const longPassword = "a".repeat(256);

    // Act
    const result = await hashPassword(longPassword);

    // Assert
    expect(result.startsWith("$argon2")).toBe(true);
  });

  it("produces a hash for a password containing special characters", async () => {
    // Arrange
    const specialPassword = "P@$$w0rd!#%^&*()_+{}|:<>?";

    // Act
    const result = await hashPassword(specialPassword);

    // Assert
    expect(result.startsWith("$argon2")).toBe(true);
  });

  it("produces a hash for a password with unicode characters", async () => {
    // Arrange
    const unicodePassword = "パスワード🔐secret";

    // Act
    const result = await hashPassword(unicodePassword);

    // Assert
    expect(result.startsWith("$argon2")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// verifyPassword
// ---------------------------------------------------------------------------

describe("verifyPassword — correct password", () => {
  it("returns true when the password matches the hash", async () => {
    // Arrange
    const password = "correct-horse-battery-staple";
    const hash = await hashPassword(password);

    // Act
    const result = await verifyPassword(hash, password);

    // Assert
    expect(result).toBe(true);
  });

  it("returns true for a minimum-length password (8 chars)", async () => {
    // Arrange
    const password = "abcdefgh";
    const hash = await hashPassword(password);

    // Act
    const result = await verifyPassword(hash, password);

    // Assert
    expect(result).toBe(true);
  });

  it("returns true for a password with special characters", async () => {
    // Arrange
    const password = "P@$$w0rd!#%^&*()";
    const hash = await hashPassword(password);

    // Act
    const result = await verifyPassword(hash, password);

    // Assert
    expect(result).toBe(true);
  });

  it("returns true for a password with unicode characters", async () => {
    // Arrange
    const password = "パスワード🔐secret";
    const hash = await hashPassword(password);

    // Act
    const result = await verifyPassword(hash, password);

    // Assert
    expect(result).toBe(true);
  });
});

describe("verifyPassword — wrong password", () => {
  it("returns false when the password does not match", async () => {
    // Arrange
    const password = "correct-password";
    const wrongPassword = "wrong-password";
    const hash = await hashPassword(password);

    // Act
    const result = await verifyPassword(hash, wrongPassword);

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when the password is one character off", async () => {
    // Arrange
    const password = "my-secret-password";
    const almostRight = "my-secret-password!";
    const hash = await hashPassword(password);

    // Act
    const result = await verifyPassword(hash, almostRight);

    // Assert
    expect(result).toBe(false);
  });

  it("returns false for a different capitalisation of the same password", async () => {
    // Arrange
    const password = "MySecretPassword";
    const hash = await hashPassword(password);

    // Act — passwords are case-sensitive
    const result = await verifyPassword(hash, "mysecretpassword");

    // Assert
    expect(result).toBe(false);
  });

  it("returns false when the password has a leading space", async () => {
    // Arrange
    const password = "secretpassword";
    const hash = await hashPassword(password);

    // Act
    const result = await verifyPassword(hash, " secretpassword");

    // Assert
    expect(result).toBe(false);
  });
});

describe("verifyPassword — malformed or edge-case hash", () => {
  it("returns false for a malformed hash string (does not throw)", async () => {
    // Arrange
    const malformedHash = "this-is-not-a-valid-argon2-hash";

    // Act — verifyPassword must catch the error and return false
    const result = await verifyPassword(malformedHash, "any-password");

    // Assert
    expect(result).toBe(false);
  });

  it("returns false for an empty hash string (does not throw)", async () => {
    // Act
    const result = await verifyPassword("", "any-password");

    // Assert
    expect(result).toBe(false);
  });

  it("returns false for a truncated argon2 hash", async () => {
    // Arrange — valid prefix but truncated body
    const truncatedHash = "$argon2id$v=19$m=65536,t=3,p=4$truncated";

    // Act
    const result = await verifyPassword(truncatedHash, "password");

    // Assert
    expect(result).toBe(false);
  });

  it("returns false for the dummy hash used in the login timing-safe path", async () => {
    // Arrange — this is the exact dummy hash the auth route uses to avoid
    // short-circuiting when the user is not found
    const dummyHash =
      "$argon2id$v=19$m=65536,t=3,p=4$dummysaltdummysalt$dummyhashvalueplaceholderhere";

    // Act
    const result = await verifyPassword(dummyHash, "any-password");

    // Assert — it must not crash and must return false
    expect(result).toBe(false);
  });
});
