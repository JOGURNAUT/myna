import { setTimeout as sleep } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Redis } from 'ioredis';
import RedisMock from 'ioredis-mock';
import {
  FallbackRateLimiter,
  MemoryRateLimiter,
  type RateLimiter,
  RedisRateLimiter,
  type RedisLike,
} from '@myna/shared/rate-limit';
import type { CreateHawkTenantInput } from '@myna/shared';
import { configCacheKey, RedisConfigBus } from '../src/infra/config-bus.js';
import { hashPassword } from '../src/core/staff-auth.js';
import {
  MemoryReminderClaims,
  RedisReminderClaims,
  type ReminderClaims,
} from '../src/core/reminder-claims.js';
import { buildApp } from '../src/http/app.js';
import { loadDemoConfig, makeTestDb } from './helpers.js';

/**
 * The same tests run against memory, an in-process Redis mock, and (when REDIS_URL is set, as in
 * CI) a real Redis server. Same interface, same behaviour.
 */
interface Backend {
  name: string;
  limiter(): RateLimiter;
  claims(): ReminderClaims;
}

let n = 0;
/** Mocks with the same host share data, so each test gets its own "server". */
const mock = () => new RedisMock({ host: `mock-${n++}` }) as unknown as RedisLike;
const backends: Backend[] = [
  {
    name: 'memory',
    limiter: () => new MemoryRateLimiter(),
    claims: () => new MemoryReminderClaims(),
  },
  {
    name: 'redis (mock)',
    limiter: () => new RedisRateLimiter(mock(), `t${Math.random()}:`),
    claims: () => new RedisReminderClaims(mock()),
  },
];
if (process.env.REDIS_URL) {
  const url = process.env.REDIS_URL;
  backends.push({
    name: 'redis (real)',
    limiter: () =>
      new RedisRateLimiter(new Redis(url, { enableReadyCheck: false }), `t${Math.random()}:`),
    // keyPrefix isolates each test's keys (ioredis applies it to EVAL keys too).
    claims: () =>
      new RedisReminderClaims(
        new Redis(url, { enableReadyCheck: false, keyPrefix: `t${Math.random()}:` }),
      ),
  });
}

describe.each(backends)('rate limiter — $name', (b) => {
  it('counts hits in a window and starts over when it ends', async () => {
    const rl = b.limiter();
    expect(await rl.count('k')).toBe(0);
    expect(await rl.hit('k', 150)).toBe(1);
    expect(await rl.hit('k', 150)).toBe(2);
    expect(await rl.count('k')).toBe(2);
    await sleep(220);
    expect(await rl.count('k')).toBe(0);
    expect(await rl.hit('k', 150)).toBe(1);
  });

  it('keeps keys apart and can be reset', async () => {
    const rl = b.limiter();
    await rl.hit('a', 5000);
    await rl.hit('a', 5000);
    await rl.hit('b', 5000);
    expect(await rl.count('a')).toBe(2);
    expect(await rl.count('b')).toBe(1);
    await rl.reset('a');
    expect(await rl.count('a')).toBe(0);
    expect(await rl.count('b')).toBe(1);
  });

  it('never loses a hit under concurrency', async () => {
    const rl = b.limiter();
    await Promise.all(Array.from({ length: 50 }, () => rl.hit('burst', 5000)));
    expect(await rl.count('burst')).toBe(50);
  });
});

describe.each(backends)('reminder claims — $name', (b) => {
  it('lets exactly one of 20 racing workers claim a reminder', async () => {
    const claims = b.claims();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => claims.claim('t1', 'appt-1', `worker-${i}`, 5000)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('claims different appointments and different tenants independently', async () => {
    const claims = b.claims();
    expect(await claims.claim('t1', 'a', 'w1', 5000)).toBe(true);
    expect(await claims.claim('t1', 'b', 'w2', 5000)).toBe(true);
    expect(await claims.claim('t2', 'a', 'w3', 5000)).toBe(true);
  });

  it('lets a crashed worker’s claim expire, so the reminder is not lost', async () => {
    const claims = b.claims();
    expect(await claims.claim('t1', 'a', 'w1', 100)).toBe(true);
    expect(await claims.claim('t1', 'a', 'w2', 100)).toBe(false);
    await sleep(160);
    expect(await claims.claim('t1', 'a', 'w2', 100)).toBe(true);
  });

  it('releases only for the holder', async () => {
    const claims = b.claims();
    await claims.claim('t1', 'a', 'w1', 5000);
    await claims.release('t1', 'a', 'w2'); // not the holder: no effect
    expect(await claims.claim('t1', 'a', 'w3', 5000)).toBe(false);
    await claims.release('t1', 'a', 'w1');
    expect(await claims.claim('t1', 'a', 'w3', 5000)).toBe(true);
  });
});

describe('when Redis is down', () => {
  const dead: RedisLike = { eval: () => Promise.reject(new Error('ECONNREFUSED')) };

  it('claims nothing rather than risk calling a patient twice', async () => {
    const errors: unknown[] = [];
    const claims = new RedisReminderClaims(dead, (e) => errors.push(e));
    expect(await claims.claim('t1', 'a', 'w1', 5000)).toBe(false);
    await claims.release('t1', 'a', 'w1'); // must not throw
    expect(errors).toHaveLength(2);
  });

  it('limits per instance instead of failing the request', async () => {
    const errors: unknown[] = [];
    const rl = new FallbackRateLimiter(new RedisRateLimiter(dead), new MemoryRateLimiter(), (e) =>
      errors.push(e),
    );
    expect(await rl.hit('k', 5000)).toBe(1);
    expect(await rl.hit('k', 5000)).toBe(2);
    expect(await rl.count('k')).toBe(2);
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ---- Two API instances, one Redis: the behaviour that motivated all of this.

const AGENT = 'agent-token-0123456789';
const SECRET = 'staff-session-secret-0123456789-abcdef';
const PASSWORD = 'demo-password-123';
const MON_11 = new Date('2026-10-12T05:30:00Z');

describe('two API instances sharing Redis', () => {
  let cleanup: () => void;
  let apps: Awaited<ReturnType<typeof buildApp>>[];
  let redis: RedisLike;

  beforeEach(async () => {
    const config = await loadDemoConfig();
    const db = await makeTestDb([config]);
    cleanup = db.cleanup;
    redis = mock();
    const build = () =>
      buildApp({
        db: db.db,
        clinics: new Map([[config.id, config]]),
        agentToken: AGENT,
        clock: () => MON_11,
        hawk: true,
        limiter: new RedisRateLimiter(redis, 'two:'),
        claims: new RedisReminderClaims(redis),
        configBus: new RedisConfigBus(redis as unknown as Redis),
        staff: { secret: SECRET, logins: new Map([['smile-dental', hashPassword(PASSWORD)]]) },
      });
    apps = [await build(), await build()];
  });
  afterEach(async () => {
    await Promise.all(apps.map((a) => a.close()));
    cleanup();
  });

  const login = (i: number, password: string) =>
    apps[i]!.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { clinicId: 'smile-dental', password },
    });

  it('shares the login lock-out, so hopping between instances does not reset it', async () => {
    for (let i = 0; i < 5; i++) await login(i % 2, `wrong-${i}-xxxx`); // alternate A, B, A, B, A
    const right = await login(1, PASSWORD);
    expect(right.statusCode).toBe(401);
    expect(right.json<{ error: { message: string } }>().error.message).toContain(
      'too many attempts',
    );
  });

  it('gives each due reminder to one worker only', async () => {
    const body: Partial<CreateHawkTenantInput> = {
      baseClinicId: 'smile-dental',
      config: { outboundReminders: { enabled: true } },
      patients: [{ key: 'p', name: 'Pooja Malhotra', phone: '9811100733', dob: '1990-04-12' }],
      appointments: [
        {
          key: 'a',
          patient: 'p',
          serviceId: 'cleaning',
          resourceId: 'dr-mehta',
          start: '2026-10-13T10:00',
        },
      ],
    };
    const made = await apps[0]!.inject({
      method: 'POST',
      url: '/v1/hawk/tenants',
      headers: { authorization: `Bearer ${AGENT}` },
      payload: body,
    });
    const clinicId = made.json<{ data: { clinicId: string } }>().data.clinicId;
    const claim = (worker: string) =>
      apps[0]!
        .inject({
          method: 'POST',
          url: `/v1/clinics/${clinicId}/reminders/claim`,
          headers: { authorization: `Bearer ${AGENT}` },
          payload: { worker },
        })
        .then((r) => r.json<{ data: { due: { patientName: string }[] } }>().data.due);

    const [first, second] = await Promise.all([claim('worker-a'), claim('worker-b')]);
    expect([first.length, second.length].sort()).toEqual([0, 1]);
    expect([...first, ...second].map((d) => d.patientName)).toEqual(['Pooja Malhotra']);
  });

  it('turns the kill switch off on EVERY instance when one is told, and flushes cached config', async () => {
    const asAgent = { authorization: `Bearer ${AGENT}` };
    const killSwitchSeenBy = async (i: number) =>
      (
        await apps[i]!.inject({
          method: 'GET',
          url: '/v1/clinics/smile-dental/config',
          headers: asAgent,
        })
      ).json<{ data: { killSwitch: boolean } }>().data.killSwitch;

    // The agent's shared cache holds a copy of the config.
    await (redis as unknown as Redis).set(configCacheKey('smile-dental'), '{"stale":true}');

    const token = (await login(0, PASSWORD)).json<{ data: { token: string } }>().data.token;
    const put = await apps[0]!.inject({
      method: 'PUT',
      url: '/v1/staff/kill-switch',
      headers: { authorization: `Bearer ${token}` },
      payload: { on: true },
    });
    expect(put.statusCode).toBe(200);

    expect(await killSwitchSeenBy(0)).toBe(true);
    await vi.waitFor(async () => {
      expect(await killSwitchSeenBy(1)).toBe(true);
    }); // the OTHER instance
    expect(await (redis as unknown as Redis).get(configCacheKey('smile-dental'))).toBeNull();
  });
});
