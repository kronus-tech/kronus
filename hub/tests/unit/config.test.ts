import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "../../src/lib/config.js";

// We test loadConfig() directly for all validation/parsing cases because
// getConfig() is a module-level singleton that cannot be reset between tests
// without re-importing the module. The singleton behaviour is tested at the end
// using getConfig() directly after ensuring env is clean and populated.

const REQUIRED_ENV: Record<string, string> = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/kronus_test",
  REDIS_URL: "redis://localhost:6379",
};

let savedEnv: Record<string, string | undefined> = {};

const TRACKED_KEYS = [
  "DATABASE_URL",
  "REDIS_URL",
  "PORT",
  "NODE_ENV",
  "LOG_LEVEL",
  "HUB_URL",
  "RELAY_URL",
  "JWT_PRIVATE_KEY",
  "JWT_PUBLIC_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

function saveEnv(): void {
  for (const key of TRACKED_KEYS) {
    savedEnv[key] = process.env[key];
  }
}

function restoreEnv(): void {
  for (const key of TRACKED_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
  savedEnv = {};
}

function setRequiredVars(): void {
  for (const [key, val] of Object.entries(REQUIRED_ENV)) {
    process.env[key] = val;
  }
}

function clearRequiredVars(): void {
  delete process.env["DATABASE_URL"];
  delete process.env["REDIS_URL"];
}

beforeEach(() => {
  saveEnv();
});

afterEach(() => {
  restoreEnv();
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe("loadConfig — happy path", () => {
  it("returns a Config object when all required vars are present", () => {
    // Arrange
    setRequiredVars();

    // Act
    const result = loadConfig();

    // Assert
    expect(result).toBeDefined();
  });

  it("DATABASE_URL is set from env", () => {
    // Arrange
    setRequiredVars();

    // Act
    const result = loadConfig();

    // Assert
    expect(result.DATABASE_URL).toBe(REQUIRED_ENV.DATABASE_URL);
  });

  it("REDIS_URL is set from env", () => {
    // Arrange
    setRequiredVars();

    // Act
    const result = loadConfig();

    // Assert
    expect(result.REDIS_URL).toBe(REQUIRED_ENV.REDIS_URL);
  });

  it("config object is frozen", () => {
    // Arrange
    setRequiredVars();

    // Act
    const result = loadConfig();

    // Assert
    expect(Object.isFrozen(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Required variable validation
// ---------------------------------------------------------------------------

describe("loadConfig — missing required vars", () => {
  it("throws when DATABASE_URL is missing", () => {
    // Arrange
    setRequiredVars();
    delete process.env["DATABASE_URL"];

    // Act & Assert
    expect(() => loadConfig()).toThrow("DATABASE_URL");
  });

  it("throws when REDIS_URL is missing", () => {
    // Arrange
    setRequiredVars();
    delete process.env["REDIS_URL"];

    // Act & Assert
    expect(() => loadConfig()).toThrow("REDIS_URL");
  });

  it("throws when both DATABASE_URL and REDIS_URL are missing", () => {
    // Arrange
    clearRequiredVars();

    // Act
    let error: Error | undefined;
    try {
      loadConfig();
    } catch (e) {
      error = e as Error;
    }

    // Assert — both names must appear in the single error message
    expect(error).toBeDefined();
    expect(error!.message).toContain("DATABASE_URL");
    expect(error!.message).toContain("REDIS_URL");
  });

  it("error message does not mention REDIS_URL when only DATABASE_URL is missing", () => {
    // Arrange
    setRequiredVars();
    delete process.env["DATABASE_URL"];

    // Act
    let error: Error | undefined;
    try {
      loadConfig();
    } catch (e) {
      error = e as Error;
    }

    // Assert — should only list the missing var
    expect(error!.message).not.toContain("REDIS_URL");
  });
});

// ---------------------------------------------------------------------------
// PORT parsing
// ---------------------------------------------------------------------------

describe("loadConfig — PORT", () => {
  it("defaults to 3100 when PORT is not set", () => {
    // Arrange
    setRequiredVars();
    delete process.env["PORT"];

    // Act
    const result = loadConfig();

    // Assert
    expect(result.PORT).toBe(3100);
  });

  it("parses PORT as a number when set as a string", () => {
    // Arrange
    setRequiredVars();
    process.env["PORT"] = "4000";

    // Act
    const result = loadConfig();

    // Assert
    expect(result.PORT).toBe(4000);
    expect(typeof result.PORT).toBe("number");
  });

  it("PORT is a number type, not a string", () => {
    // Arrange
    setRequiredVars();
    process.env["PORT"] = "8080";

    // Act
    const result = loadConfig();

    // Assert
    expect(typeof result.PORT).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Default values for optional env vars
// ---------------------------------------------------------------------------

describe("loadConfig — NODE_ENV default", () => {
  it("defaults to 'development' when NODE_ENV is not set", () => {
    // Arrange
    setRequiredVars();
    delete process.env["NODE_ENV"];

    // Act
    const result = loadConfig();

    // Assert
    expect(result.NODE_ENV).toBe("development");
  });

  it("uses the provided NODE_ENV value", () => {
    // Arrange
    setRequiredVars();
    process.env["NODE_ENV"] = "production";

    // Act
    const result = loadConfig();

    // Assert
    expect(result.NODE_ENV).toBe("production");
  });
});

describe("loadConfig — LOG_LEVEL default", () => {
  it("defaults to 'info' when LOG_LEVEL is not set", () => {
    // Arrange
    setRequiredVars();
    delete process.env["LOG_LEVEL"];

    // Act
    const result = loadConfig();

    // Assert
    expect(result.LOG_LEVEL).toBe("info");
  });

  it("uses the provided LOG_LEVEL value", () => {
    // Arrange
    setRequiredVars();
    process.env["LOG_LEVEL"] = "debug";

    // Act
    const result = loadConfig();

    // Assert
    expect(result.LOG_LEVEL).toBe("debug");
  });
});

// ---------------------------------------------------------------------------
// Optional vars — undefined when not set
// ---------------------------------------------------------------------------

describe("loadConfig — optional vars are undefined when not set", () => {
  beforeEach(() => {
    setRequiredVars();
    delete process.env["JWT_PRIVATE_KEY"];
    delete process.env["JWT_PUBLIC_KEY"];
    delete process.env["STRIPE_SECRET_KEY"];
    delete process.env["STRIPE_WEBHOOK_SECRET"];
  });

  it("JWT_PRIVATE_KEY is undefined when not set", () => {
    const result = loadConfig();
    expect(result.JWT_PRIVATE_KEY).toBeUndefined();
  });

  it("JWT_PUBLIC_KEY is undefined when not set", () => {
    const result = loadConfig();
    expect(result.JWT_PUBLIC_KEY).toBeUndefined();
  });

  it("STRIPE_SECRET_KEY is undefined when not set", () => {
    const result = loadConfig();
    expect(result.STRIPE_SECRET_KEY).toBeUndefined();
  });

  it("STRIPE_WEBHOOK_SECRET is undefined when not set", () => {
    const result = loadConfig();
    expect(result.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getConfig() singleton — must come last so the module singleton is cold
// ---------------------------------------------------------------------------

describe("getConfig — singleton", () => {
  it("returns the same object reference on subsequent calls", async () => {
    // Arrange — ensure required vars are set before first call to getConfig
    setRequiredVars();

    // We must import getConfig dynamically so the module-level _config
    // has already been populated by any earlier call (or is fresh in a new
    // worker). Both calls must return the identical reference.
    const { getConfig } = await import("../../src/lib/config.js");

    // Act
    const first = getConfig();
    const second = getConfig();

    // Assert
    expect(first).toBe(second);
  });
});
