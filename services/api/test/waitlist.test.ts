import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { type BusinessConfig, type CreateHawkTenantInput, loadBusinessConfig } from '@myna/shared';
import { resolve } from 'node:path';
import { buildApp } from '../src/http/app.js';
import { makeTestDb } from './helpers.js';

const TOKEN = 'test-token-0123456789';
const MON_11 = new Date('2026-10-12T05:30:00Z');
const EVENING = '2026-10-13T20:00';
const ON = { enabled: true, callWindow: { start: '10:00', end: '20:00' }, waitlistHoldMin: 15 };

interface Env {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string };
}

let app: FastifyInstance;
let cleanup: () => void;
const clock = { now: MON_11 };

async function call(method: 'GET' | 'POST', url: string, body?: unknown) {
  const res = await app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${TOKEN}` },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  return { status: res.statusCode, body: res.json<Env>() };
}

beforeEach(async () => {
  clock.now = MON_11;
  const config: BusinessConfig = await loadBusinessConfig(
    resolve(import.meta.dirname, '../../../clinics/spice-route.yaml'),
  );
  const db = await makeTestDb([config]);
  cleanup = db.cleanup;
  app = await buildApp({
    db: db.db,
    clinics: new Map([[config.id, config]]),
    agentToken: TOKEN,
    clock: () => clock.now,
    hawk: true,
  });
});
afterEach(async () => {
  await app.close();
  cleanup();
});

const GUESTS = [
  { key: 'g0', name: 'Ananya Kulkarni', phone: '9822200401' },
  { key: 'g1', name: 'Bilal Khan', phone: '9822200402' },
  { key: 'g2', name: 'Chitra Rao', phone: '9822200403' },
];

/** One sitting on Tuesday (8 to 9:30 pm). Table 1 (seats two) and table 5 (four or six) are taken. */
async function fullEvening(outbound: Record<string, unknown> | null = ON) {
  const input: Partial<CreateHawkTenantInput> = {
    baseClinicId: 'spice-route',
    config: {
      hours: {
        mon: [{ start: '12:00', end: '15:00' }],
        tue: [{ start: '20:00', end: '21:30' }],
      },
      ...(outbound ? { outboundReminders: outbound } : {}),
    },
    patients: GUESTS,
    appointments: [
      { key: 'a0', patient: 'g0', serviceId: 'table-2', resourceId: 'table-1', start: EVENING },
      { key: 'a1', patient: 'g1', serviceId: 'table-2', resourceId: 'table-2', start: EVENING },
      { key: 'a2', patient: 'g2', serviceId: 'table-6', resourceId: 'table-5', start: EVENING },
    ],
  };
  const res = await call('POST', '/v1/hawk/tenants', input);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const t = res.body.data as { clinicId: string; appointments: Record<string, string> };
  return t;
}

const tool = (id: string, name: string, body: unknown) =>
  call('POST', `/v1/clinics/${id}/tools/${name}`, body);

const join = (id: string, name: string, phone: string, serviceId: string, extra = {}) =>
  tool(id, 'join_waitlist', {
    callId: 'c1',
    name,
    phone,
    serviceId,
    date: '2026-10-13',
    ...extra,
  });

async function cancelFor(id: string, name: string, phone: string, appointmentId: string) {
  const v = await tool(id, 'find_patient', { callId: 'c1', name, phone });
  const verificationId = (v.body.data as { verificationId: string }).verificationId;
  const res = await tool(id, 'cancel', {
    callId: 'c1',
    verificationId,
    appointmentId,
    idempotencyKey: `cancel-${appointmentId}`,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function offers(id: string) {
  const res = await call('GET', `/v1/clinics/${id}/reminders/due`);
  const due = (res.body.data as { due: { kind: string; patientName: string }[] }).due;
  return due.filter((d) => d.kind === 'waitlist_offer').map((d) => d.patientName);
}

describe('join_waitlist', () => {
  it('counts the guests ahead, first come first served', async () => {
    const t = await fullEvening();
    const first = await join(t.clinicId, 'Farah Siddiqui', '9822200411', 'table-2');
    const second = await join(t.clinicId, 'Gita Nambiar', '9822200412', 'table-2');
    expect(first.body.data).toMatchObject({ ahead: 0 });
    expect(second.body.data).toMatchObject({ ahead: 1 });
  });

  it('refuses a bad phone, a past date and a number that opted out', async () => {
    const t = await fullEvening();
    expect((await join(t.clinicId, 'Farah Siddiqui', '12345', 'table-2')).status).toBe(400);
    const past = await join(t.clinicId, 'Farah Siddiqui', '9822200411', 'table-2', {
      date: '2026-10-11',
    });
    expect(past.status).toBe(400);
  });
});

describe('a freed table', () => {
  it('goes to the first waiting guest it fits, and only that guest is called', async () => {
    const t = await fullEvening();
    await join(t.clinicId, 'Big Family', '9822200421', 'table-6'); // first in line, but too big
    await join(t.clinicId, 'Farah Siddiqui', '9822200411', 'table-2');
    expect(await offers(t.clinicId)).toEqual([]);

    // Table 1 seats two: the family of six is skipped, Farah is called.
    await cancelFor(t.clinicId, 'Ananya Kulkarni', '9822200401', t.appointments.a0 ?? '');
    expect(await offers(t.clinicId)).toEqual(['Farah Siddiqui']);
  });

  it('is held, not booked, until the guest says yes', async () => {
    const t = await fullEvening();
    await join(t.clinicId, 'Farah Siddiqui', '9822200411', 'table-2');
    await cancelFor(t.clinicId, 'Ananya Kulkarni', '9822200401', t.appointments.a0 ?? '');
    const state = (await call('GET', `/v1/hawk/tenants/${t.clinicId}/state`)).body.data as {
      appointments: { patientName: string; status: string }[];
    };
    const farah = state.appointments.filter((a) => a.patientName === 'Farah Siddiqui');
    expect(farah.map((a) => a.status)).toEqual(['pending']);
  });

  it('moves on to the next guest when the hold runs out', async () => {
    const t = await fullEvening();
    await join(t.clinicId, 'Farah Siddiqui', '9822200411', 'table-2');
    await join(t.clinicId, 'Gita Nambiar', '9822200412', 'table-2');
    await cancelFor(t.clinicId, 'Ananya Kulkarni', '9822200401', t.appointments.a0 ?? '');
    expect(await offers(t.clinicId)).toEqual(['Farah Siddiqui']);

    clock.now = new Date(MON_11.getTime() + 16 * 60_000); // past the 15-minute hold
    expect(await offers(t.clinicId)).toEqual(['Gita Nambiar']);
  });

  it('is not held for anyone while outbound calls are switched off', async () => {
    const t = await fullEvening(null);
    await join(t.clinicId, 'Farah Siddiqui', '9822200411', 'table-2');
    await cancelFor(t.clinicId, 'Ananya Kulkarni', '9822200401', t.appointments.a0 ?? '');
    expect(await offers(t.clinicId)).toEqual([]);
  });
});
