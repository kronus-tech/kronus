import type Redis from "ioredis";
import { getRedis } from "../lib/redis.js";
import { db } from "../db/index.js";
import { usage_events } from "../db/schema.js";
import { createLogger } from "../lib/logger.js";

const logger = createLogger("relay:metering");

// Current minute expressed as an integer bucket (minutes since epoch)
function getMinuteBucket(): string {
  return String(Math.floor(Date.now() / 60_000));
}

export async function meterCall(
  userId: string,
  instanceId: string,
  appId: string,
  payloadBytes: number
): Promise<void> {
  const redis = getRedis();
  const bucket = getMinuteBucket();
  const callsKey = `meter:${userId}:${appId}:calls:${bucket}`;
  const bytesKey = `meter:${userId}:${appId}:bytes:${bucket}`;

  // Pipeline both increments in a single round-trip
  const pipeline = redis.pipeline();
  pipeline.incr(callsKey);
  pipeline.expire(callsKey, 7200); // 2h TTL — well beyond any flush window
  pipeline.incrby(bytesKey, payloadBytes);
  pipeline.expire(bytesKey, 7200);
  await pipeline.exec();

  logger.debug("Call metered", { userId, instanceId, appId, payloadBytes });
}

// ---------------------------------------------------------------------------
// Background flush
// ---------------------------------------------------------------------------

let flushInterval: ReturnType<typeof setInterval> | null = null;

export function startMeteringFlush(intervalMs = 60_000): void {
  if (flushInterval) return;

  logger.info("Metering flush started", { interval_ms: intervalMs });

  flushInterval = setInterval(async () => {
    try {
      await flushMetering();
    } catch (err) {
      logger.error("Metering flush failed", {
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, intervalMs);
}

export function stopMeteringFlush(): void {
  if (flushInterval) {
    clearInterval(flushInterval);
    flushInterval = null;
    logger.info("Metering flush stopped");
  }
}

// ---------------------------------------------------------------------------
// Internal flush logic
// ---------------------------------------------------------------------------

interface UsageEventInsert {
  instance_id: string;
  app_id: string;
  event_type: string;
  payload_bytes: number;
}

async function flushMetering(): Promise<void> {
  const redis = getRedis();

  const keys = await scanKeys(redis, "meter:*:calls:*");
  if (keys.length === 0) return;

  const events: UsageEventInsert[] = [];
  const keysToDelete: string[] = [];

  for (const callsKey of keys) {
    // Key format: meter:{userId}:{appId}:calls:{bucket}
    const parts = callsKey.split(":");
    if (parts.length < 5) continue;

    const userId = parts[1];
    const appId = parts[2];
    const bytesKey = callsKey.replace(":calls:", ":bytes:");

    const [rawCalls, rawBytes] = await redis.mget(callsKey, bytesKey);
    const callCount = rawCalls ? parseInt(rawCalls, 10) : 0;

    if (callCount > 0) {
      events.push({
        instance_id: userId,
        app_id: appId,
        event_type: "mcp_call",
        payload_bytes: rawBytes ? parseInt(rawBytes, 10) : 0,
      });
    }

    keysToDelete.push(callsKey, bytesKey);
  }

  // HUB-34: Insert to Postgres FIRST, delete Redis keys only on success
  if (events.length > 0) {
    await db.insert(usage_events).values(events);
    logger.info("Metering flushed", { events: events.length });
  }

  // Only delete after successful insert (or if no events to insert)
  if (keysToDelete.length > 0) {
    await redis.del(...keysToDelete);
  }
}

async function scanKeys(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const [nextCursor, batch] = await redis.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== "0");

  return keys;
}
