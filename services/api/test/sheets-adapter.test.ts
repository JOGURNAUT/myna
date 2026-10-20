import { generateKeyPairSync, createVerify } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type { RedisLike } from '@myna/shared/rate-limit';
import { SheetsSchedulingAdapter } from '../src/adapters/sheets/adapter.js';
import { FakeSheetsClient, GoogleSheetsClient } from '../src/adapters/sheets/client.js';
import { InProcessMutex, RedisMutex } from '../src/adapters/sheets/mutex.js';
import { schedulingAdapterContract } from './contract/scheduling-adapter.contract.js';
import { buildApp } from '../src/http/app.js';
import { ScheduleStores } from '../src/infra/schedule-stores.js';
import { loadDemoConfig, makeTestDb } from './helpers.js';

// The same contract SQLite passes: different backend, identical behaviour.
schedulingAdapterContract('google sheets (fake client)', {
  async make() {
    const sheets = new FakeSheetsClient();
    await sheets.ensureHeaders();
    return {
      adapter: new SheetsSchedulingAdapter(sheets, await loadDemoConfig()),
      cleanup: () => undefined,
    };
  },
});

describe('sheets adapter: a spreadsheet people also edit by hand', () => {
  it('uses rows staff typed in, and skips rows it cannot understand', async () => {
    const sheets = new FakeSheetsClient();
    await sheets.ensureHeaders();
    const adapter = new SheetsSchedulingAdapter(sheets, await loadDemoConfig());
    // A patient and an appointment added by a receptionist, phone typed with spaces.
    sheets.seed('Patients', ['pat_hand', 'Sunita Rao', '+91 98765 43210', '1985-02-03']);
    sheets.seed('Appointments', [
      'apt_hand',
      'pat_hand',
      'dr-mehta',
      'cleaning',
      '2026-10-13T10:00',
      '2026-10-13T10:30',
      'confirmed',
      'staff',
    ]);
    // Garbage: half a row, an unknown status, a blank line.
    sheets.seed('Appointments', ['apt_bad', 'pat_hand', 'dr-mehta']);
    sheets.seed('Appointments', ['apt_odd', 'pat_hand', 'dr-mehta', 'cleaning', 'x', 'y', 'maybe']);
    sheets.seed('Appointments', []);

    expect((await adapter.findPatients({ phone: '9876543210' }))[0]?.name).toBe('Sunita Rao');
    expect(await adapter.getAppointment('apt_hand')).toMatchObject({ start: '2026-10-13T10:00' });
    expect(await adapter.getAppointment('apt_bad')).toBeNull();
    expect(await adapter.getAppointment('apt_odd')).toBeNull();
    // The hand-typed booking blocks the slot like any other.
    await expect(
      adapter.book({
        idempotencyKey: 'k1',
        patientId: 'pat_other',
        resourceId: 'dr-mehta',
        serviceId: 'cleaning',
        start: '2026-10-13T10:15',
        end: '2026-10-13T10:45',
        source: 'test',
      }),
    ).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
  });

  it('does not store a failed booking as an idempotent success', async () => {
    const sheets = new FakeSheetsClient();
    await sheets.ensureHeaders();
    const adapter = new SheetsSchedulingAdapter(sheets, await loadDemoConfig());
    const req = {
      idempotencyKey: 'same-key',
      patientId: 'p1',
      resourceId: 'dr-mehta',
      serviceId: 'cleaning',
      start: '2026-10-13T10:00',
      end: '2026-10-13T10:30',
      source: 'test',
    };
    await adapter.book({ ...req, idempotencyKey: 'first' });
    await expect(adapter.book(req)).rejects.toMatchObject({ code: 'SLOT_UNAVAILABLE' });
    expect(await sheets.readRows('Idempotency')).toHaveLength(1); // only the success is recorded
  });
});

describe('mutexes', () => {
  it('queue work in order, and one failure does not block the next', async () => {
    const m = new InProcessMutex();
    const order: number[] = [];
    const results = await Promise.allSettled([
      m.run(async () => {
        await sleep(20);
        order.push(1);
      }),
      m.run(() => Promise.reject(new Error('boom'))),
      m.run(() => {
        order.push(3);
        return Promise.resolve();
      }),
    ]);
    expect(order).toEqual([1, 3]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('a Redis mutex makes two instances take turns', async () => {
    const redis = new RedisMock({ host: 'mutex-test' }) as unknown as RedisLike;
    const a = new RedisMutex(redis, 'lock:clinic');
    const b = new RedisMutex(redis, 'lock:clinic');
    let inside = 0;
    let peak = 0;
    const work = async () => {
      inside++;
      peak = Math.max(peak, inside);
      await sleep(15);
      inside--;
    };
    await Promise.all([a.run(work), b.run(work), a.run(work), b.run(work)]);
    expect(peak).toBe(1);
  });
});

describe('google sheets client (against a fake Google)', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = {
    client_email: 'myna@clinic.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };

  function fakeGoogle() {
    const calls: { url: string; method: string; body?: string }[] = [];
    let tokens = 0;
    const http = ((url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
      const method = init?.method ?? 'GET';
      const raw = init?.body;
      const body =
        typeof raw === 'string' ? raw : raw instanceof URLSearchParams ? raw.toString() : undefined;
      calls.push({ url: u, method, ...(body ? { body } : {}) });
      if (u.startsWith('https://oauth2.googleapis.com/token')) {
        tokens++;
        const assertion = new URLSearchParams(body).get('assertion') ?? '';
        const [h, c, s] = assertion.split('.');
        const ok = createVerify('RSA-SHA256')
          .update(`${h}.${c}`)
          .verify(publicKey, Buffer.from(s ?? '', 'base64url'));
        const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString()) as { iss: string };
        return Promise.resolve(
          Response.json(
            ok && claims.iss === account.client_email
              ? { access_token: `tok-${tokens}`, expires_in: 3600 }
              : {},
            { status: ok ? 200 : 401 },
          ),
        );
      }
      if (method === 'GET' && u.includes('/values/Appointments!A2:I')) {
        return Promise.resolve(Response.json({ values: [['apt_1', 'pat_1', 'dr-mehta']] }));
      }
      if (method === 'GET') return Promise.resolve(Response.json({})); // blank header rows
      return Promise.resolve(Response.json({ updatedRows: 1 }));
    }) as typeof fetch;
    return { http, calls, tokenCount: () => tokens };
  }

  it('signs in with a service-account JWT and reuses the token', async () => {
    const g = fakeGoogle();
    const client = new GoogleSheetsClient('sheet-id', account, g.http);
    await client.readRows('Appointments');
    await client.readRows('Appointments');
    expect(g.tokenCount()).toBe(1);
    expect(g.calls.at(-1)?.url).toContain('/spreadsheets/sheet-id/values/Appointments!A2:I');
  });

  it('pads short rows to the header width', async () => {
    const client = new GoogleSheetsClient('sheet-id', account, fakeGoogle().http);
    const rows = await client.readRows('Appointments');
    expect(rows[0]).toHaveLength(9);
    expect(rows[0]?.slice(0, 4)).toEqual(['apt_1', 'pat_1', 'dr-mehta', '']);
  });

  it('appends, overwrites the right row (header offset), and writes headers on a blank sheet', async () => {
    const g = fakeGoogle();
    const client = new GoogleSheetsClient('sheet-id', account, g.http);
    await client.appendRow('Patients', ['pat_1', 'Pooja', '9811100733', '']);
    await client.updateRow('Appointments', 3, ['x']);
    await client.ensureHeaders();
    const urls = g.calls.map(
      (c) => `${c.method} ${decodeURIComponent(c.url.split('/v4/')[1] ?? '')}`,
    );
    expect(urls).toContain(
      'POST spreadsheets/sheet-id/values/Patients!A1:D1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    );
    // 0-based data row 3 is spreadsheet row 5 (row 1 is the header).
    expect(urls).toContain(
      'PUT spreadsheets/sheet-id/values/Appointments!A5:I5?valueInputOption=RAW',
    );
    expect(urls.filter((u) => u.startsWith('PUT') && u.includes('!A1:'))).toHaveLength(3);
  });

  it('refuses to continue when Google rejects the credentials', async () => {
    const wrong = {
      ...account,
      private_key: generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
        type: 'pkcs8',
        format: 'pem',
      }),
    };
    const client = new GoogleSheetsClient('sheet-id', wrong, fakeGoogle().http);
    await expect(client.readRows('Patients')).rejects.toThrow(/sign-in failed/);
  });
});

describe('a clinic whose schedule is a Google Sheet, through the real API', () => {
  it('books through the tool endpoint and the booking lands in the sheet', async () => {
    const config = {
      ...(await loadDemoConfig()),
      scheduleStore: { backend: 'gsheets' as const, spreadsheetId: 'sheet-id-0123456789' },
    };
    const sheets = new FakeSheetsClient();
    const stores = new ScheduleStores(
      { client_email: 'a@b.c', private_key: 'unused' },
      undefined,
      () => sheets,
    );
    await stores.prepare([config]);
    const { db, cleanup } = await makeTestDb([config]);
    const app = await buildApp({
      db,
      clinics: new Map([[config.id, config]]),
      agentToken: 'test-token-0123456789',
      clock: () => new Date('2026-10-12T05:30:00Z'),
      adapterFor: (c) => stores.adapterFor(c),
    });
    const tool = async (name: string, payload: unknown) =>
      (
        await app.inject({
          method: 'POST',
          url: `/v1/clinics/${config.id}/tools/${name}`,
          headers: { authorization: 'Bearer test-token-0123456789' },
          payload: payload as Record<string, unknown>,
        })
      ).json<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }>();
    try {
      const slots = await tool('find_slots', {
        serviceId: 'cleaning',
        dateFrom: '2026-10-13',
        dateTo: '2026-10-13',
        partOfDay: 'evening',
      });
      const first = (slots.data as { slots: { start: string; resourceId: string }[] }).slots[0]!;
      const booked = await tool('book', {
        idempotencyKey: 'sheet-key-12345',
        callId: 'call-1',
        newPatient: { name: 'Neha Kapoor', phone: '9822200111' },
        serviceId: 'cleaning',
        resourceId: first.resourceId,
        start: first.start,
      });
      expect(booked.ok, JSON.stringify(booked)).toBe(true);

      const appts = await sheets.readRows('Appointments');
      expect(appts).toHaveLength(1);
      expect(appts[0]?.slice(3, 7)).toEqual([
        'cleaning',
        first.start,
        expect.any(String),
        'confirmed',
      ]);
      expect((await sheets.readRows('Patients'))[0]?.slice(1, 3)).toEqual([
        'Neha Kapoor',
        '9822200111',
      ]);

      // The same slot is now taken, as seen through the sheet.
      const again = await tool('book', {
        idempotencyKey: 'sheet-key-67890',
        callId: 'call-2',
        newPatient: { name: 'Karan Bedi', phone: '9822200222' },
        serviceId: 'cleaning',
        resourceId: first.resourceId,
        start: first.start,
      });
      expect(again.error?.code).toBe('SLOT_UNAVAILABLE');
    } finally {
      await app.close();
      cleanup();
    }
  });

  it('refuses to start without credentials rather than failing on the first call', async () => {
    const config = {
      ...(await loadDemoConfig()),
      scheduleStore: { backend: 'gsheets' as const, spreadsheetId: 'sheet-id-0123456789' },
    };
    await expect(new ScheduleStores(undefined).prepare([config])).rejects.toThrow(
      /GOOGLE_SERVICE_ACCOUNT_JSON/,
    );
  });

  it('rejects a Sheets clinic config without a spreadsheet id', async () => {
    const { BusinessConfig } = await import('@myna/shared');
    const base = await loadDemoConfig();
    const parsed = BusinessConfig.safeParse({ ...base, scheduleStore: { backend: 'gsheets' } });
    expect(parsed.success).toBe(false);
  });
});
