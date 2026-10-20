import { randomBytes } from 'node:crypto';
import type { RedisLike } from '@myna/shared/rate-limit';

/**
 * A Sheets API call is not a transaction, so "check the slot is free, then write the booking" can
 * interleave with another booking. The adapter therefore runs every write under a mutex. One
 * process: an in-memory queue. Several instances: a Redis lock, so they queue behind each other.
 */
export interface Mutex {
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export class InProcessMutex implements Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

const ACQUIRE = `return redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])`;
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0`;

export class RedisMutex implements Mutex {
  constructor(
    private readonly redis: RedisLike,
    private readonly key: string,
    private readonly ttlMs = 15_000,
    private readonly waitMs = 10_000,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    const token = randomBytes(8).toString('hex');
    const giveUpAt = Date.now() + this.waitMs;
    while ((await this.redis.eval(ACQUIRE, 1, this.key, token, String(this.ttlMs))) !== 'OK') {
      if (Date.now() > giveUpAt) throw new Error(`could not get the schedule lock (${this.key})`);
      await new Promise((r) => setTimeout(r, 25));
    }
    try {
      return await fn();
    } finally {
      await this.redis.eval(RELEASE, 1, this.key, token).catch(() => undefined); // expires anyway
    }
  }
}
