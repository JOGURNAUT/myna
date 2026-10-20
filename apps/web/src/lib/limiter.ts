import { Redis } from 'ioredis';
import {
  FallbackRateLimiter,
  MemoryRateLimiter,
  type RateLimiter,
  RedisRateLimiter,
} from '@myna/shared/rate-limit';

/**
 * The demo page's abuse limits. With REDIS_URL every web instance shares one counter (otherwise
 * N instances allow N× the limit); without it, this process's memory. If Redis is down we fall
 * back to per-instance counting rather than refuse every visitor.
 */
const globalForLimiter = globalThis as unknown as { mynaLimiter?: RateLimiter };

function create(): RateLimiter {
  const url = process.env.REDIS_URL;
  if (!url) return new MemoryRateLimiter();
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    commandTimeout: 1000,
  });
  redis.on('error', () => undefined); // handled per call by the fallback
  return new FallbackRateLimiter(new RedisRateLimiter(redis, 'myna:web:'), new MemoryRateLimiter());
}

// One per server process, surviving dev hot reloads.
export const limiter = (globalForLimiter.mynaLimiter ??= create());
