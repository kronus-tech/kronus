import { getRedis } from "./redis.js";
import { getRateLimits } from "../relay/types.js";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds) when the window resets
}

export async function checkRateLimit(
  key: string,
  limit: number,
  windowSecs: number
): Promise<RateLimitResult> {
  const redis = getRedis();
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSecs);
  const windowKey = `rl:${key}:${windowStart}`;

  const count = await redis.incr(windowKey);
  if (count === 1) {
    await redis.expire(windowKey, windowSecs);
  }

  const resetAt = windowStart + windowSecs;

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

export async function checkRelayRateLimit(
  userId: string,
  plan: string
): Promise<RateLimitResult> {
  const limits = getRateLimits(plan);

  // Check per-minute limit first — tighter constraint
  const minuteResult = await checkRateLimit(
    `relay:${userId}:min`,
    limits.callsPerMin,
    60
  );
  if (!minuteResult.allowed) return minuteResult;

  // Check per-day limit
  const dayResult = await checkRateLimit(
    `relay:${userId}:day`,
    limits.callsPerDay,
    86400
  );
  if (!dayResult.allowed) return dayResult;

  // Return the most restrictive (lowest remaining)
  return minuteResult.remaining <= dayResult.remaining ? minuteResult : dayResult;
}
