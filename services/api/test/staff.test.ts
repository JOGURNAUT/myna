import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BusinessConfig } from '@myna/shared';
import { hashPassword } from '../src/core/staff-auth.js';
import type { Db } from '../src/db/client.js';
import { buildApp } from '../src/http/app.js';
import { seedDemo } from '../src/seed.js';
import { loadDemoConfig, makeTestDb, withTenant } from './helpers.js';

const AGENT = 'agent-token-0123456789';
const SECRET = 'staff-session-secret-0123456789-abcdef';
const PASSWORD = 'demo-password-123';
const OTHER_PASSWORD = 'other-password-456';
/** Monday 12 Oct 2026, 11:00 IST. */
const MON_11 = new Date('2026-10-12T05:30:00Z');

interface Env {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string };
}

let db: Db;
let cleanup: () => void;
let app: FastifyInstance;
let configs: BusinessConfig[];
const clock = { now: MON_11 };

async function build(patch: (c: BusinessConfig) => BusinessConfig = (c) => c) {
  const base = patch(await loadDemoConfig());
  configs = [base, { ...withTenant(base, 'other-clinic'), publicDemo: false }];
  return buildApp({
    db,
    clinics: new Map(configs.map((c) => [c.id, c])),
    agentToken: AGENT,
    clock: () => clock.now,
    staff: {
      secret: SECRET,
      logins: new Map([
        ['smile-dental', hashPassword(PASSWORD)],
        ['other-clinic', hashPassword(OTHER_PASSWORD)],
      ]),
    },
  });
}

async function req(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  token: string | null,
  body?: unknown,
) {
  const res = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  return { status: res.statusCode, body: res.json<Env>() };
}

async function login(clinicId = 'smile-dental', password = PASSWORD): Promise<string> {
  const res = await req('POST', '/v1/staff/login', null, { clinicId, password });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return (res.body.data as { token: string }).token;
}

/** A call through the agent's routes, as Myna would log it. */
async function call(opts: {
  source?: string;
  said?: string | null;
  outcome: string;
  handoffReason?: string;
  clinic?: string;
}): Promise<string> {
  const clinic = opts.clinic ?? 'smile-dental';
  const started = await req('POST', `/v1/clinics/${clinic}/calls`, AGENT, {
    source: opts.source ?? 'patient',
    callerPhone: '9811100733',
  });
  const callId = (started.body.data as { callId: string }).callId;
  const event = (e: unknown) =>
    req('POST', `/v1/clinics/${clinic}/calls/${callId}/events`, AGENT, e);
  await event({
    type: 'turn',
    speaker: 'agent',
    text: 'Namaste, main Myna hoon',
    state: 'GREETING',
  });
  if (opts.said !== null) {
    await event({
      type: 'turn',
      speaker: 'caller',
      text: opts.said ?? 'Mujhe cleaning chahiye',
      language: 'hinglish',
      state: 'IDENTIFY_INTENT',
    });
  }
  if (opts.handoffReason) {
    await req('POST', `/v1/clinics/${clinic}/tools/handoff_to_human`, AGENT, {
      callId,
      reason: opts.handoffReason,
      summary: 'test',
    });
  }
  await event({
    type: 'end',
    outcome: opts.outcome,
    ...(opts.handoffReason ? { handoffReason: opts.handoffReason } : {}),
  });
  return callId;
}

beforeEach(async () => {
  clock.now = MON_11;
  const t = await makeTestDb([]);
  db = t.db;
  cleanup = t.cleanup;
  app = await build();
});
afterEach(async () => {
  await app.close();
  cleanup();
});

describe('sign-in', () => {
  it('refuses a wrong password and an unknown clinic with the same answer', async () => {
    const wrong = await req('POST', '/v1/staff/login', null, {
      clinicId: 'smile-dental',
      password: 'nope-nope-nope',
    });
    const unknown = await req('POST', '/v1/staff/login', null, {
      clinicId: 'ghost-clinic',
      password: PASSWORD,
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error?.message).toBe(unknown.body.error?.message);
  });

  it('locks a clinic after 5 failed attempts, even for the right password', async () => {
    for (let i = 0; i < 5; i++) {
      await req('POST', '/v1/staff/login', null, {
        clinicId: 'smile-dental',
        password: `wrong-${i}-xxxx`,
      });
    }
    const right = await req('POST', '/v1/staff/login', null, {
      clinicId: 'smile-dental',
      password: PASSWORD,
    });
    expect(right.status).toBe(401);
    expect(right.body.error?.message).toContain('too many attempts');
  });

  it('keeps staff sessions and the agent token apart', async () => {
    const token = await login();
    expect((await req('GET', '/v1/staff/me', token)).body.data).toMatchObject({
      clinicId: 'smile-dental',
    });
    expect((await req('GET', '/v1/staff/me', null)).status).toBe(401);
    expect((await req('GET', '/v1/staff/me', AGENT)).status).toBe(401);
    expect((await req('GET', '/v1/clinics/smile-dental/config', token)).status).toBe(401);
  });

  it('refuses tampered and expired sessions', async () => {
    const token = await login();
    const [payload, mac] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({ c: 'other-clinic', e: Date.now() * 2 })).toString('base64url')}.${mac}`;
    expect((await req('GET', '/v1/staff/me', forged)).status).toBe(401);
    expect((await req('GET', '/v1/staff/me', `${payload}.x${mac?.slice(1)}`)).status).toBe(401);
    clock.now = new Date(MON_11.getTime() + 13 * 3600_000);
    expect((await req('GET', '/v1/staff/me', token)).status).toBe(401);
  });
});

describe('call log and labels', () => {
  it('lists today’s calls with what the caller asked, and the full detail', async () => {
    const id = await call({ outcome: 'booked' });
    const token = await login();
    const list = (await req('GET', '/v1/staff/calls', token)).body.data as {
      calls: Record<string, unknown>[];
    };
    expect(list.calls).toEqual([
      expect.objectContaining({
        id,
        startedAt: '2026-10-12T11:00',
        firstRequest: 'Mujhe cleaning chahiye',
        language: 'hinglish',
        outcome: 'booked',
        callerPhoneMasked: '98xxxxx733',
      }),
    ]);
    const detail = (await req('GET', `/v1/staff/calls/${id}`, token)).body.data as {
      events: { type: string }[];
    };
    expect(detail.events.map((e) => e.type)).toEqual(['turn', 'turn', 'end']);
  });

  it('labels a call; a wrong call needs a failure type', async () => {
    const id = await call({ source: 'manual_test', outcome: 'booked' });
    const token = await login();
    expect(
      (await req('PUT', `/v1/staff/calls/${id}/label`, token, { correct: false })).status,
    ).toBe(400);
    const ok = await req('PUT', `/v1/staff/calls/${id}/label`, token, {
      correct: false,
      failureType: 'wrong_date_or_time',
      notes: 'Booked Tuesday, I said Thursday',
    });
    expect(ok.status).toBe(200);
    const detail = (await req('GET', `/v1/staff/calls/${id}`, token)).body.data as {
      label: unknown;
    };
    expect(detail.label).toMatchObject({ correct: false, failureType: 'wrong_date_or_time' });
  });

  it("never shows one clinic another clinic's calls", async () => {
    const id = await call({ outcome: 'booked' });
    const other = await login('other-clinic', OTHER_PASSWORD);
    expect((await req('GET', `/v1/staff/calls/${id}`, other)).status).toBe(404);
    expect(
      ((await req('GET', '/v1/staff/calls', other)).body.data as { calls: unknown[] }).calls,
    ).toEqual([]);
    expect((await req('PUT', `/v1/staff/calls/${id}/label`, other, { correct: true })).status).toBe(
      404,
    );
  });
});

describe('alerts and metrics', () => {
  it('shows a handoff until someone marks it seen', async () => {
    const id = await call({ outcome: 'handoff', handoffReason: 'emergency', said: 'bahut khoon' });
    const token = await login();
    const alerts = async () =>
      ((await req('GET', '/v1/staff/handoffs', token)).body.data as { handoffs: { id: string }[] })
        .handoffs;
    expect((await alerts()).map((a) => a.id)).toEqual([id]);
    await req('POST', `/v1/staff/calls/${id}/handoff-seen`, token);
    expect(await alerts()).toEqual([]);
  });

  it('computes metrics from real calls only, each with its formula', async () => {
    await call({ outcome: 'booked' });
    await call({ outcome: 'handoff', handoffReason: 'caller_asked' });
    await call({ outcome: 'message_taken' });
    await call({ outcome: 'no_action', said: null }); // dropped before speaking
    await call({ source: 'hawk', outcome: 'booked' });
    await call({ source: 'manual_test', outcome: 'handoff', handoffReason: 'frustrated' });
    const token = await login();
    const m = (await req('GET', '/v1/staff/metrics', token)).body.data as {
      metrics: { id: string; value: number | null; formula: string }[];
    };
    const by = Object.fromEntries(m.metrics.map((x) => [x.id, x]));
    expect(by.handled_without_staff?.value).toBe(33); // 1 of 3 answered
    expect(by.missed_calls?.value).toBe(1);
    expect(by.no_show_rate?.value).toBeNull();
    expect(by.staff_hours_saved?.value).toBe(0.1); // 1 call × 3 min
    expect(m.metrics.every((x) => x.formula.length > 20)).toBe(true);
  });
});

describe('after-hours bookings (pilot step 2)', () => {
  it('books pending while closed; staff approve one and reject the other', async () => {
    await app.close();
    app = await build((c) => ({ ...c, bookingApproval: 'after_hours' }));
    clock.now = new Date('2026-10-12T15:30:00Z'); // 21:00 IST, closed
    const book = (start: string, phone: string) =>
      req('POST', '/v1/clinics/smile-dental/tools/book', AGENT, {
        idempotencyKey: `k-${start}`,
        callId: 'c',
        newPatient: { name: `Patient ${phone.slice(-3)}`, phone },
        serviceId: 'cleaning',
        resourceId: 'dr-mehta',
        start,
      });
    const a = (await book('2026-10-13T10:00', '9822200111')).body.data as {
      appointment: { id: string; status: string };
    };
    const b = (await book('2026-10-13T11:00', '9822200222')).body.data as {
      appointment: { id: string };
    };
    expect(a.appointment.status).toBe('pending');

    clock.now = new Date('2026-10-13T04:00:00Z'); // 09:30 IST next morning
    const token = await login();
    const pending = (await req('GET', '/v1/staff/pending', token)).body.data as {
      pending: { id: string; patientName: string }[];
    };
    expect(pending.pending.map((p) => p.patientName)).toEqual(['Patient 111', 'Patient 222']);

    expect(
      (await req('POST', `/v1/staff/pending/${a.appointment.id}/approve`, token)).body.data,
    ).toMatchObject({
      appointment: { status: 'confirmed' },
    });
    await req('POST', `/v1/staff/pending/${b.appointment.id}/reject`, token);
    const tasks = (await req('GET', '/v1/staff/tasks', token)).body.data as {
      tasks: { summary: string; patientName: string }[];
    };
    expect(tasks.tasks).toEqual([expect.objectContaining({ patientName: 'Patient 222' })]);
    expect(tasks.tasks[0]?.summary).toContain('not approved');
    expect((await req('POST', `/v1/staff/pending/${a.appointment.id}/approve`, token)).status).toBe(
      400,
    );
  });

  it('books confirmed straight away while the clinic is open', async () => {
    await app.close();
    app = await build((c) => ({ ...c, bookingApproval: 'after_hours' }));
    const res = await req('POST', '/v1/clinics/smile-dental/tools/book', AGENT, {
      idempotencyKey: 'key-open-hours',
      callId: 'c',
      newPatient: { name: 'Open Hours', phone: '9822200333' },
      serviceId: 'cleaning',
      resourceId: 'dr-mehta',
      start: '2026-10-13T10:00',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body.data as { appointment: { status: string } }).appointment.status).toBe(
      'confirmed',
    );
  });
});

describe('kill switch from the dashboard', () => {
  it('stops Myna at once and survives a restart', async () => {
    const token = await login();
    expect((await req('PUT', '/v1/staff/kill-switch', token, { on: true })).body.data).toEqual({
      on: true,
    });
    const cfg = (await req('GET', '/v1/clinics/smile-dental/config', AGENT)).body.data as {
      killSwitch: boolean;
    };
    expect(cfg.killSwitch).toBe(true);

    await app.close();
    app = await build();
    const after = (await req('GET', '/v1/clinics/smile-dental/config', AGENT)).body.data as {
      killSwitch: boolean;
    };
    expect(after.killSwitch).toBe(true);
    const other = (await req('GET', '/v1/clinics/other-clinic/config', AGENT)).body.data as {
      killSwitch: boolean;
    };
    expect(other.killSwitch).toBe(false);
  });
});

describe('public routes', () => {
  it('shows the demo clinic’s busy times without names, and shared reports', async () => {
    await seedDemo(db, configs[0]!, MON_11);
    const demo = await req('GET', '/v1/public/clinics/smile-dental/demo', null);
    expect(demo.status).toBe(200);
    expect(JSON.stringify(demo.body)).not.toMatch(/Pooja|Arjun|Rahul|patient/i);
    expect((demo.body.data as { busy: unknown[] }).busy.length).toBeGreaterThan(0);
    expect((await req('GET', '/v1/public/clinics/other-clinic/demo', null)).status).toBe(404);

    const saved = await req('POST', '/v1/clinics/smile-dental/reports', AGENT, {
      runId: 'r1',
      createdAt: 'x',
    });
    const id = (saved.body.data as { reportId: string }).reportId;
    expect((await req('GET', `/v1/public/reports/${id}`, null)).body.data).toMatchObject({
      runId: 'r1',
    });
    expect(
      (await req('GET', '/v1/public/clinics/smile-dental/latest-report', null)).body.data,
    ).toEqual({ reportId: id });
  });
});
