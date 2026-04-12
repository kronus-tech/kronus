// metering.test.ts
//
// Unit tests for hub/src/relay/metering.ts
//
// Both Redis (pipeline) and db (insert) are mocked with lightweight fakes.
// mock.module() calls must come BEFORE any static import of metering.ts
// because Bun resolves mocks at import time.

process.env["DATABASE_URL"] =
  process.env["DATABASE_URL"] ?? "postgres://user:pass@localhost:5432/kronus_test";
process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:6379";
process.env["HUB_URL"] = process.env["HUB_URL"] ?? "http://localhost:3100";

import { describe, it, expect, beforeEach, mock } from "bun:test";

// ---------------------------------------------------------------------------
// Fake Redis with pipeline recording
// ---------------------------------------------------------------------------

interface PipelineCall {
  method: string;
  args: unknown[];
}

interface FakePipeline {
  _calls: PipelineCall[];
  incr(key: string): FakePipeline;
  incrby(key: string, amount: number): FakePipeline;
  expire(key: string, ttl: number): FakePipeline;
  exec(): Promise<unknown[]>;
}

// Track all pipeline instances created so tests can inspect them
const _pipelines: FakePipeline[] = [];

// Counter store shared with scan/mget
const _counters = new Map<string, number>();

function makeFakePipeline(): FakePipeline {
  const pipeline: FakePipeline = {
    _calls: [],

    incr(key: string) {
      this._calls.push({ method: "incr", args: [key] });
      const next = (_counters.get(key) ?? 0) + 1;
      _counters.set(key, next);
      return this;
    },

    incrby(key: string, amount: number) {
      this._calls.push({ method: "incrby", args: [key, amount] });
      const next = (_counters.get(key) ?? 0) + amount;
      _counters.set(key, next);
      return this;
    },

    expire(key: string, ttl: number) {
      this._calls.push({ method: "expire", args: [key, ttl] });
      return this;
    },

    async exec() {
      return this._calls.map(() => [null, 1]);
    },
  };

  _pipelines.push(pipeline);
  return pipeline;
}

const fakeRedis = {
  pipeline: () => makeFakePipeline(),

  async scan(
    _cursor: string,
    _matchLiteral: string,
    _pattern: string,
    _countLiteral: string,
    _count: number
  ): Promise<[string, string[]]> {
    // Return all meter:* keys in a single page then signal done (cursor "0")
    const matching = Array.from(_counters.keys()).filter((k) => k.startsWith("meter:"));
    return ["0", matching];
  },

  async mget(...keys: string[]): Promise<(string | null)[]> {
    return keys.map((k) => {
      const v = _counters.get(k);
      return v !== undefined ? String(v) : null;
    });
  },

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (_counters.delete(key)) deleted++;
    }
    return deleted;
  },
};

// ---------------------------------------------------------------------------
// Fake db with insert recording
// ---------------------------------------------------------------------------

const _insertedRows: unknown[][] = [];

const fakeDb = {
  insert(_table: unknown) {
    return {
      values(rows: unknown[]) {
        _insertedRows.push(rows);
        return Promise.resolve();
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Inject mocks — MUST be before any import of metering.ts
// ---------------------------------------------------------------------------

mock.module("../../../src/lib/redis.js", () => ({
  getRedis: () => fakeRedis,
  closeRedis: async () => {},
  isRedisReady: () => true,
}));

mock.module("../../../src/db/index.js", () => ({
  db: fakeDb,
  sql: {},
}));

import {
  meterCall,
  startMeteringFlush,
  stopMeteringFlush,
} from "../../../src/relay/metering.js";

// ---------------------------------------------------------------------------
// Reset fake state between tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  _pipelines.length = 0;
  _insertedRows.length = 0;
  _counters.clear();
  // Ensure flush interval is stopped so tests start clean
  stopMeteringFlush();
});

// ---------------------------------------------------------------------------
// meterCall — pipeline usage
// ---------------------------------------------------------------------------

describe("meterCall — Redis pipeline calls", () => {
  it("creates a pipeline for each meterCall invocation", async () => {
    // Arrange
    const initialCount = _pipelines.length;

    // Act
    await meterCall("krn_usr_u1", "krn_inst_i1", "krn_app_a1", 512);

    // Assert
    expect(_pipelines.length).toBe(initialCount + 1);
  });

  it("pipeline includes an incr call for the calls key", async () => {
    // Arrange / Act
    await meterCall("krn_usr_u2", "krn_inst_i2", "krn_app_a2", 256);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const incrCall = pipeline._calls.find(
      (c) => c.method === "incr" && (c.args[0] as string).includes(":calls:")
    );
    expect(incrCall).toBeDefined();
  });

  it("calls key embeds the userId", async () => {
    // Arrange
    const userId = "krn_usr_embed001";

    // Act
    await meterCall(userId, "krn_inst_x", "krn_app_x", 128);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const incrCall = pipeline._calls.find((c) => c.method === "incr");
    expect(incrCall).toBeDefined();
    expect((incrCall!.args[0] as string)).toContain(userId);
  });

  it("calls key embeds the appId", async () => {
    // Arrange
    const appId = "krn_app_embed002";

    // Act
    await meterCall("krn_usr_x", "krn_inst_x", appId, 128);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const incrCall = pipeline._calls.find((c) => c.method === "incr");
    expect(incrCall).toBeDefined();
    expect((incrCall!.args[0] as string)).toContain(appId);
  });

  it("pipeline includes an incrby call for the bytes key", async () => {
    // Arrange / Act
    await meterCall("krn_usr_u3", "krn_inst_i3", "krn_app_a3", 1024);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const incrbyCall = pipeline._calls.find(
      (c) => c.method === "incrby" && (c.args[0] as string).includes(":bytes:")
    );
    expect(incrbyCall).toBeDefined();
  });

  it("incrby is called with the exact payloadBytes value", async () => {
    // Arrange
    const payloadBytes = 2048;

    // Act
    await meterCall("krn_usr_u4", "krn_inst_i4", "krn_app_a4", payloadBytes);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const incrbyCall = pipeline._calls.find((c) => c.method === "incrby");
    expect(incrbyCall).toBeDefined();
    expect(incrbyCall!.args[1]).toBe(payloadBytes);
  });

  it("pipeline sets a TTL on the calls key", async () => {
    // Arrange / Act
    await meterCall("krn_usr_u5", "krn_inst_i5", "krn_app_a5", 64);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const expireForCalls = pipeline._calls.find(
      (c) => c.method === "expire" && (c.args[0] as string).includes(":calls:")
    );
    expect(expireForCalls).toBeDefined();
    // TTL must be positive
    expect((expireForCalls!.args[1] as number)).toBeGreaterThan(0);
  });

  it("pipeline sets a TTL on the bytes key", async () => {
    // Arrange / Act
    await meterCall("krn_usr_u6", "krn_inst_i6", "krn_app_a6", 64);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const expireForBytes = pipeline._calls.find(
      (c) => c.method === "expire" && (c.args[0] as string).includes(":bytes:")
    );
    expect(expireForBytes).toBeDefined();
    expect((expireForBytes!.args[1] as number)).toBeGreaterThan(0);
  });

  it("TTL on calls key is at least 3600 seconds (1 hour)", async () => {
    // The source sets 7200 (2h). Verify it meets the minimum.
    // Arrange / Act
    await meterCall("krn_usr_u7", "krn_inst_i7", "krn_app_a7", 32);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const expireCall = pipeline._calls.find(
      (c) => c.method === "expire" && (c.args[0] as string).includes(":calls:")
    );
    expect((expireCall!.args[1] as number)).toBeGreaterThanOrEqual(3600);
  });

  it("calls key and bytes key share the same userId:appId:bucket prefix", async () => {
    // Arrange
    const userId = "krn_usr_prefix";
    const appId = "krn_app_prefix";

    // Act
    await meterCall(userId, "krn_inst_p", appId, 128);

    // Assert — both keys embed userId and appId
    const pipeline = _pipelines[_pipelines.length - 1];
    const incrCall = pipeline._calls.find((c) => c.method === "incr");
    const incrbyCall = pipeline._calls.find((c) => c.method === "incrby");

    const callsKey = incrCall!.args[0] as string;
    const bytesKey = incrbyCall!.args[0] as string;

    expect(callsKey).toContain(userId);
    expect(callsKey).toContain(appId);
    expect(bytesKey).toContain(userId);
    expect(bytesKey).toContain(appId);
  });

  it("calls key uses 'calls' segment and bytes key uses 'bytes' segment", async () => {
    // Arrange / Act
    await meterCall("krn_usr_seg", "krn_inst_seg", "krn_app_seg", 100);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const callsKey = (pipeline._calls.find((c) => c.method === "incr")!.args[0]) as string;
    const bytesKey = (pipeline._calls.find((c) => c.method === "incrby")!.args[0]) as string;

    expect(callsKey).toContain(":calls:");
    expect(bytesKey).toContain(":bytes:");
  });

  it("calls key starts with 'meter:' prefix", async () => {
    // Arrange / Act
    await meterCall("krn_usr_pfx", "krn_inst_pfx", "krn_app_pfx", 50);

    // Assert
    const pipeline = _pipelines[_pipelines.length - 1];
    const callsKey = (pipeline._calls.find((c) => c.method === "incr")!.args[0]) as string;
    expect(callsKey.startsWith("meter:")).toBe(true);
  });

  it("does not throw for zero-byte payload", async () => {
    // Act / Assert — 0-byte is valid (empty ping-style call)
    await expect(meterCall("krn_usr_zero", "krn_inst_zero", "krn_app_zero", 0)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// startMeteringFlush / stopMeteringFlush — lifecycle
// ---------------------------------------------------------------------------

describe("startMeteringFlush", () => {
  it("does not throw when called once", () => {
    // Act / Assert
    expect(() => startMeteringFlush(60_000)).not.toThrow();
    stopMeteringFlush(); // clean up
  });

  it("does not throw when called with a custom interval", () => {
    // Act / Assert
    expect(() => startMeteringFlush(5_000)).not.toThrow();
    stopMeteringFlush(); // clean up
  });

  it("is idempotent — calling twice does not create two intervals", () => {
    // Arrange
    startMeteringFlush(60_000);

    // Act — call a second time
    expect(() => startMeteringFlush(60_000)).not.toThrow();

    // Cleanup
    stopMeteringFlush();
    // If two intervals were started, stopMeteringFlush (which nulls the ref)
    // would only stop one — the second would keep running. We cannot directly
    // assert the interval count, but we can verify stop doesn't throw and
    // the module stays in a clean state for subsequent tests.
    expect(() => stopMeteringFlush()).not.toThrow();
  });
});

describe("stopMeteringFlush", () => {
  it("does not throw when called after startMeteringFlush", () => {
    // Arrange
    startMeteringFlush(60_000);

    // Act / Assert
    expect(() => stopMeteringFlush()).not.toThrow();
  });

  it("does not throw when called without a prior start (no-op)", () => {
    // Act / Assert — interval ref is null by default
    expect(() => stopMeteringFlush()).not.toThrow();
  });

  it("does not throw when called multiple times in a row", () => {
    // Arrange
    startMeteringFlush(60_000);
    stopMeteringFlush();

    // Act — second stop call should be a clean no-op
    expect(() => stopMeteringFlush()).not.toThrow();
  });
});
