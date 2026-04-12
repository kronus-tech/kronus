import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { homedir } from "os";
import { join } from "path";

// Keys managed by loadConfig — saved and restored around each test
const ENV_KEYS = ["BRAIN_ROOTS", "BRAIN_DB", "BRAIN_UI_PORT"] as const;

type SavedEnv = Record<(typeof ENV_KEYS)[number], string | undefined>;

let savedEnv: SavedEnv;

beforeEach(() => {
  // Snapshot current values
  savedEnv = {
    BRAIN_ROOTS: process.env["BRAIN_ROOTS"],
    BRAIN_DB: process.env["BRAIN_DB"],
    BRAIN_UI_PORT: process.env["BRAIN_UI_PORT"],
  };

  // Clear all three so each test starts from a clean slate
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
});

afterEach(() => {
  // Restore original values (or delete if they weren't set before)
  for (const key of ENV_KEYS) {
    const original = savedEnv[key];
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
});

// loadConfig is called at call-time, so we import it fresh inside each test
// to pick up whichever env vars are currently set.
async function freshLoadConfig() {
  // Dynamic import with a cache-buster isn't available in Bun's module cache,
  // but loadConfig() reads process.env at call time — not at import time —
  // so a single import is sufficient.
  const { loadConfig } = await import("../src/config.js");
  return loadConfig();
}

describe("loadConfig — defaults (no env vars set)", () => {
  test("returns correct default brainRoot (~/second-brain)", async () => {
    const config = await freshLoadConfig();
    expect(config.brainRoot).toBe(join(homedir(), "second-brain"));
  });

  test("returns correct default dbPath (~/.kronus/brain.sqlite)", async () => {
    const config = await freshLoadConfig();
    expect(config.dbPath).toBe(join(homedir(), ".kronus", "brain.sqlite"));
  });

  test("returns correct default uiPort (4242)", async () => {
    const config = await freshLoadConfig();
    expect(config.uiPort).toBe(4242);
  });

  test("uiPort is a number, not a string", async () => {
    const config = await freshLoadConfig();
    expect(typeof config.uiPort).toBe("number");
  });
});

describe("loadConfig — BRAIN_ROOTS override", () => {
  test("brainRoot reflects first BRAIN_ROOTS entry", async () => {
    process.env["BRAIN_ROOTS"] = "/tmp/my-brain|personal";
    const config = await freshLoadConfig();
    expect(config.brainRoot).toBe("/tmp/my-brain");
    expect(config.brainRoots).toEqual([{ path: "/tmp/my-brain", label: "personal" }]);
  });

  test("multiple roots are parsed correctly", async () => {
    process.env["BRAIN_ROOTS"] = "/tmp/brain|personal,/tmp/projects|project";
    const config = await freshLoadConfig();
    expect(config.brainRoots).toEqual([
      { path: "/tmp/brain", label: "personal" },
      { path: "/tmp/projects", label: "project" },
    ]);
    expect(config.brainRoot).toBe("/tmp/brain");
  });

  test("dbPath is unaffected when only BRAIN_ROOTS is set", async () => {
    process.env["BRAIN_ROOTS"] = "/tmp/my-brain|personal";
    const config = await freshLoadConfig();
    expect(config.dbPath).toBe(join(homedir(), ".kronus", "brain.sqlite"));
  });

  test("uiPort is unaffected when only BRAIN_ROOTS is set", async () => {
    process.env["BRAIN_ROOTS"] = "/tmp/my-brain|personal";
    const config = await freshLoadConfig();
    expect(config.uiPort).toBe(4242);
  });
});

describe("loadConfig — BRAIN_DB override", () => {
  test("dbPath reflects BRAIN_DB env var", async () => {
    process.env["BRAIN_DB"] = "/tmp/test.sqlite";
    const config = await freshLoadConfig();
    expect(config.dbPath).toBe("/tmp/test.sqlite");
  });

  test("brainRoot is unaffected when only BRAIN_DB is set", async () => {
    process.env["BRAIN_DB"] = "/tmp/test.sqlite";
    const config = await freshLoadConfig();
    expect(config.brainRoot).toBe(join(homedir(), "second-brain"));
  });
});

describe("loadConfig — BRAIN_UI_PORT override", () => {
  test("uiPort reflects BRAIN_UI_PORT env var parsed as number", async () => {
    process.env["BRAIN_UI_PORT"] = "9090";
    const config = await freshLoadConfig();
    expect(config.uiPort).toBe(9090);
  });

  test("uiPort is a number when parsed from string env var", async () => {
    process.env["BRAIN_UI_PORT"] = "3000";
    const config = await freshLoadConfig();
    expect(typeof config.uiPort).toBe("number");
  });

  test("uiPort works with port 80", async () => {
    process.env["BRAIN_UI_PORT"] = "80";
    const config = await freshLoadConfig();
    expect(config.uiPort).toBe(80);
  });

  test("uiPort works with high port number 65535", async () => {
    process.env["BRAIN_UI_PORT"] = "65535";
    const config = await freshLoadConfig();
    expect(config.uiPort).toBe(65535);
  });

  test("brainRoot and dbPath are unaffected when only BRAIN_UI_PORT is set", async () => {
    process.env["BRAIN_UI_PORT"] = "9090";
    const config = await freshLoadConfig();
    expect(config.brainRoot).toBe(join(homedir(), "second-brain"));
    expect(config.dbPath).toBe(join(homedir(), ".kronus", "brain.sqlite"));
  });
});

describe("loadConfig — all env vars set simultaneously", () => {
  test("all overrides are applied at once", async () => {
    process.env["BRAIN_ROOTS"] = "/custom/brain|personal";
    process.env["BRAIN_DB"] = "/custom/db.sqlite";
    process.env["BRAIN_UI_PORT"] = "7777";

    const config = await freshLoadConfig();

    expect(config.brainRoot).toBe("/custom/brain");
    expect(config.brainRoots).toEqual([{ path: "/custom/brain", label: "personal" }]);
    expect(config.dbPath).toBe("/custom/db.sqlite");
    expect(config.uiPort).toBe(7777);
  });
});

describe("loadConfig — return shape", () => {
  test("returned object has exactly the four expected keys", async () => {
    const config = await freshLoadConfig();
    const keys = Object.keys(config).sort();
    expect(keys).toEqual(["brainRoot", "brainRoots", "dbPath", "uiPort"].sort());
  });

  test("brainRoot is a non-empty string", async () => {
    const config = await freshLoadConfig();
    expect(typeof config.brainRoot).toBe("string");
    expect(config.brainRoot.length).toBeGreaterThan(0);
  });

  test("dbPath is a non-empty string", async () => {
    const config = await freshLoadConfig();
    expect(typeof config.dbPath).toBe("string");
    expect(config.dbPath.length).toBeGreaterThan(0);
  });
});
