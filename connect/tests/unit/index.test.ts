// tests/unit/index.test.ts
// Unit tests for the Connect SDK public surface (connect/src/index.ts).

import { describe, it, expect } from "bun:test";
import {
  VERSION,
  getStatus,
  generateIdentityKeypair,
  getMachineFingerprint,
  getIdentityPath,
  getKronusDir,
} from "../../src/index";

describe("VERSION", () => {
  it('should equal "5.3.0-dev"', () => {
    expect(VERSION).toBe("5.3.0-dev");
  });
});

describe("exported identity functions", () => {
  it("generateIdentityKeypair is a function", () => {
    expect(typeof generateIdentityKeypair).toBe("function");
  });

  it("getMachineFingerprint is a function", () => {
    expect(typeof getMachineFingerprint).toBe("function");
  });

  it("getIdentityPath is a function", () => {
    expect(typeof getIdentityPath).toBe("function");
  });

  it("getKronusDir is a function", () => {
    expect(typeof getKronusDir).toBe("function");
  });
});

describe("getStatus()", () => {
  it("should resolve (not throw)", async () => {
    await expect(getStatus()).resolves.toBeDefined();
  });

  it("should return connected: false when no identity exists", async () => {
    const status = await getStatus();
    expect(status.connected).toBe(false);
  });

  it("should return the current VERSION", async () => {
    const status = await getStatus();
    expect(status.version).toBe(VERSION);
  });

  it("should include a message field", async () => {
    const status = await getStatus();
    expect(typeof status.message).toBe("string");
  });

  it("should return a plain object", async () => {
    const status = await getStatus();
    expect(status).not.toBeNull();
    expect(Array.isArray(status)).toBe(false);
    expect(typeof status).toBe("object");
  });
});
