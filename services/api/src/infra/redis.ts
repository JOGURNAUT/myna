import { Redis } from 'ioredis';
import { FallbackRateLimiter, MemoryRateLimiter, RedisRateLimiter } from '@myna/shared/rate-limit';
import { type ConfigBus, RedisConfigBus } from './config-bus.js';
import { RedisReminderClaims, type ReminderClaims } from '../core/reminder-claims.js';
import type { RateLimiter, RedisLike } from '@myna/shared/rate-limit';

export interface Infra {
  /** For features that need Redis directly (the schedule lock). */
  redis: RedisLike;
  configBus: ConfigBus;
  limiter: RateLimiter;
  claims: ReminderClaims;
  close(): Promise<void>;
}

/**
 * Redis-backed shared state when REDIS_URL is set; undefined otherwise (the app then keeps
 * everything in this process: fine for one instance, dev, and tests).
 */
export function connectRedis(url: string | undefined): Infra | undefined {
  if (!url) return undefined;
  const redis = new Redis(url, {
    // A turn must not hang on a dead Redis: fail fast and let the fallbacks decide.
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 1000,
  });
  const lastLog = { at: 0 };
  const onError = (e: unknown) => {
    const now = Date.now();
    if (now - lastLog.at < 10_000) return; // one line per 10 s, not one per request
    lastLog.at = now;
    console.error(
      JSON.stringify({ severity: 'ERROR', message: 'redis unavailable', error: String(e) }),
    );
  };
  redis.on('error', onError);
  return {
    redis,
    configBus: new RedisConfigBus(redis, onError),
    limiter: new FallbackRateLimiter(new RedisRateLimiter(redis), new MemoryRateLimiter(), onError),
    claims: new RedisReminderClaims(redis, onError),
    close: async () => {
      await redis.quit().catch(() => undefined);
    },
  };
}
