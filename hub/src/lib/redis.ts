import Redis from "ioredis";
import { getConfig } from "./config.js";
import { createLogger } from "./logger.js";

const logger = createLogger("redis");

let _redis: Redis | undefined;

export function getRedis(): Redis {
  if (!_redis) {
    const config = getConfig();
    _redis = new Redis(config.REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 200, 5000);
        logger.warn("Redis reconnecting", { attempt: times, delay_ms: delay });
        return delay;
      },
      lazyConnect: true,
    });

    _redis.on("error", (err: Error) => {
      logger.error("Redis error", { message: err.message });
    });

    _redis.on("connect", () => {
      logger.info("Redis connected");
    });
  }
  return _redis;
}

export async function closeRedis(): Promise<void> {
  if (_redis) {
    await _redis.quit();
    _redis = undefined;
    logger.info("Redis disconnected");
  }
}

export function isRedisReady(): boolean {
  return _redis?.status === "ready";
}
