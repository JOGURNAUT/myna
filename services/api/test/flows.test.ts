import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { CreateHawkTenantInput, HawkTenantState } from '@myna/shared';
import { buildApp } from '../src/http/app.js';
import { loadDemoConfig, makeTestDb } from './helpers.js';

const TOKEN = 'test-token-0123456789';
/** Monday 12 Oct 2026, 11:00 IST: inside the default 10:00–18:00 reminder window. */
const MON_11 = new Date('2026-10-12T05:30:00Z');

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

async function tenant(input: Partial<CreateHawkTenantInput> = {}) {
  const res = await call('POST', '/v1/hawk/tenants', { baseClinicId: 'smile-dental', ...input });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.data as {
    clinicId: string;
    patients: Record<string, string>;
    appointments: Record<string, string>;
  };
}

const tool = (clinicId: string, name: string, body: unknown) =>
  call('POST', `/v1/clinics/${clinicId}/tools/${name}`, body);

async function state(clinicId: string): Promise<HawkTenantState> {
  return (await call('GET', `/v1/hawk/tenants/${clinicId}/state`)).body.data as HawkTenantState;
}

beforeEach(async () => {
  clock.now = MON_11;
  const config = await loadDemoConfig();
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

const POOJA = { key: 'pooja', name: 'Pooja Malhotra', phone: '9811100733', dob: '1990-04-12' };
const ARJUN = { key: 'arjun', name: 'Arjun Verma', phone: '9911100487', dob: '1985-11-02' };

describe('hawk tenants (test-only routes)', () => {
  it('seeds an isolated tenant from the base clinic', async () => {
    const t = await tenant({
      patients: [POOJA],
      appointments: [
        {
          key: 'a1',
          patient: 'pooja',
          serviceId: 'cleaning',
          resourceId: 'dr-mehta',
          start: '2026-10-13T10:00',
        },
      ],
    });
    expect(t.clinicId).toMatch(/^hawk-/);
    const s = await state(t.clinicId);
    expect(s.appointments).toEqual([
      expect.objectContaining({
        patientName: 'Pooja Malhotra',
        start: '2026-10-13T10:00',
        status: 'confirmed',
      }),
    ]);
    // The base clinic can't see the tenant's patient.
    const probe = await tool('smile-dental', 'find_patient', {
      callId: 'c',
      name: POOJA.name,
      dob: POOJA.dob,
    });
    expect(probe.body.data).toEqual({ status: 'not_verified' });
  });

  it('rejects config overrides that break the rules', async () => {
    const res = await call('POST', '/v1/hawk/tenants', {
      baseClinicId: 'smile-dental',
      config: { outboundReminders: { callWindow: { start: '10:00', end: '22:00' } } },
    });
    expect(res.status).toBe(400);
  });

  it('is not mounted unless enabled', async () => {
    const config = await loadDemoConfig();
    const db = await makeTestDb([config]);
    const plain = await buildApp({
      db: db.db,
      clinics: new Map([[config.id, config]]),
      agentToken: TOKEN,
    });
    const res = await plain.inject({
      method: 'POST',
      url: '/v1/hawk/tenants',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { baseClinicId: 'smile-dental' },
    });
    expect(res.statusCode).toBe(404);
    await plain.close();
    db.cleanup();
  });
});

describe('flow (b): staff tasks', () => {
  it('links a verified patient and promises a callback in opening hours', async () => {
    const t = await tenant({ patients: [POOJA] });
    const v = await tool(t.clinicId, 'find_patient', {
      callId: 'c1',
      name: POOJA.name,
      dob: POOJA.dob,
    });
    const verificationId = (v.body.data as { verificationId: string }).verificationId;
    const created = await tool(t.clinicId, 'create_staff_task', {
      callId: 'c1',
      verificationId,
      category: 'report_status',
      summary: 'Asking if her OPG X-ray report is ready',
      urgency: 'routine',
      callbackNumber: '9811100733',
    });
    expect(created.body.data).toMatchObject({ callbackBy: '2026-10-12T13:00' }); // 11:00 + 2 open hours
    const [task] = (await state(t.clinicId)).tasks;
    expect(task).toMatchObject({
      verified: true,
      patientName: 'Pooja Malhotra',
      callerName: null,
      callbackNumberMasked: '98xxxxx733',
      status: 'open',
    });
  });

  it('takes a message from an unverified caller without linking anyone', async () => {
    const t = await tenant();
    await tool(t.clinicId, 'create_staff_task', {
      callId: 'c2',
      callerName: 'Ramesh',
      category: 'billing_question',
      summary: 'Question about last month’s bill',
      urgency: 'today',
      callbackNumber: '+91 99999 00011',
    });
    const [task] = (await state(t.clinicId)).tasks;
    expect(task).toMatchObject({ verified: false, patientId: null, callerName: 'Ramesh' });
  });

  it('forces clinic-urgent categories to urgent', async () => {
    const t = await tenant();
    const res = await tool(t.clinicId, 'create_staff_task', {
      callId: 'c3',
      category: 'medicine_refill_request',
      summary: 'Needs a refill after extraction',
      urgency: 'routine',
      callbackNumber: '9999900011',
    });
    expect(res.status).toBe(200);
    expect((await state(t.clinicId)).tasks[0]?.urgency).toBe('urgent');
  });

  it('rejects an invalid verification or callback number', async () => {
    const t = await tenant();
    const base = { callId: 'c', category: 'other', summary: 's', urgency: 'routine' };
    expect(
      (await tool(t.clinicId, 'create_staff_task', { ...base, callbackNumber: '12345' })).status,
    ).toBe(400);
    const bad = await tool(t.clinicId, 'create_staff_task', {
      ...base,
      callbackNumber: '9999900011',
      verificationId: 'ver_made-up-id',
    });
    expect(bad.body.error?.code).toBe('NOT_VERIFIED');
  });

  it('lists open tasks and marks them done', async () => {
    const t = await tenant();
    const created = await tool(t.clinicId, 'create_staff_task', {
      callId: 'c4',
      category: 'doctor_callback',
      summary: 'Wants Dr. Mehta to call',
      urgency: 'today',
      callbackNumber: '9999900011',
    });
    const taskId = (created.body.data as { taskId: string }).taskId;
    expect(
      (await call('GET', `/v1/clinics/${t.clinicId}/tasks?status=open`)).body.data,
    ).toMatchObject({
      tasks: [expect.objectContaining({ id: taskId })],
    });
    expect((await call('POST', `/v1/clinics/${t.clinicId}/tasks/${taskId}/done`)).status).toBe(200);
    expect((await call('GET', `/v1/clinics/${t.clinicId}/tasks?status=open`)).body.data).toEqual({
      tasks: [],
    });
    expect((await call('POST', `/v1/clinics/${t.clinicId}/tasks/task_nope/done`)).status).toBe(404);
  });
});

describe('flow (c): reminders', () => {
  const tomorrow = (key: string, patient: string, start: string) => ({
    key,
    patient,
    serviceId: 'cleaning',
    resourceId: 'dr-mehta',
    start,
  });
  const enabled = { outboundReminders: { enabled: true } };

  const due = async (clinicId: string) =>
    (
      (await call('GET', `/v1/clinics/${clinicId}/reminders/due`)).body.data as {
        due: { appointmentId: string; patientName: string; attempts: number }[];
      }
    ).due;

  it('calls nobody unless the clinic turned reminders on', async () => {
    const t = await tenant({
      patients: [POOJA],
      appointments: [tomorrow('a', 'pooja', '2026-10-13T10:00')],
    });
    expect(await due(t.clinicId)).toEqual([]);
  });

  it('lists tomorrow’s appointments, only inside the call window', async () => {
    const t = await tenant({
      config: enabled,
      patients: [POOJA, ARJUN],
      appointments: [
        tomorrow('a', 'pooja', '2026-10-13T10:00'),
        tomorrow('b', 'arjun', '2026-10-14T10:00'), // the day after: not yet
      ],
    });
    expect((await due(t.clinicId)).map((d) => d.patientName)).toEqual(['Pooja Malhotra']);
    clock.now = new Date('2026-10-12T03:00:00Z'); // 08:30 IST
    expect(await due(t.clinicId)).toEqual([]);
    clock.now = new Date('2026-10-12T13:00:00Z'); // 18:30 IST — never late evening
    expect(await due(t.clinicId)).toEqual([]);
  });

  it('retries a no-answer after the gap, at most twice, and stops after a final outcome', async () => {
    const t = await tenant({
      config: enabled,
      patients: [POOJA, ARJUN],
      appointments: [
        tomorrow('a', 'pooja', '2026-10-13T10:00'),
        tomorrow('b', 'arjun', '2026-10-13T11:00'),
      ],
    });
    const [a, b] = [t.appointments.a, t.appointments.b];
    await tool(t.clinicId, 'mark_reminder_outcome', {
      callId: 'r1',
      appointmentId: a,
      outcome: 'no_answer',
    });
    await tool(t.clinicId, 'mark_reminder_outcome', {
      callId: 'r2',
      appointmentId: b,
      outcome: 'confirmed',
    });
    expect(await due(t.clinicId)).toEqual([]); // a: inside retry gap; b: done
    clock.now = new Date(MON_11.getTime() + 91 * 60_000);
    expect(await due(t.clinicId)).toEqual([
      expect.objectContaining({ appointmentId: a, attempts: 1 }),
    ]);
    await tool(t.clinicId, 'mark_reminder_outcome', {
      callId: 'r3',
      appointmentId: a,
      outcome: 'voicemail',
    });
    clock.now = new Date(MON_11.getTime() + 200 * 60_000);
    expect(await due(t.clinicId)).toEqual([]); // two attempts used
  });

  it('an opt-out marks the number do-not-call and is never called again', async () => {
    const t = await tenant({
      config: enabled,
      patients: [POOJA, { ...POOJA, key: 'pooja-child', name: 'Ira Malhotra', dob: '2016-01-01' }],
      appointments: [
        tomorrow('a', 'pooja', '2026-10-13T10:00'),
        tomorrow('b', 'pooja-child', '2026-10-13T11:00'),
      ],
    });
    await tool(t.clinicId, 'mark_reminder_outcome', {
      callId: 'r1',
      appointmentId: t.appointments.a,
      outcome: 'opted_out',
    });
    const s = await state(t.clinicId);
    expect(s.patients.every((p) => p.doNotCall)).toBe(true); // same family number
    expect(await due(t.clinicId)).toEqual([]);
  });

  it('skips numbers seeded as do-not-call', async () => {
    const t = await tenant({
      config: enabled,
      patients: [{ ...POOJA, doNotCall: true }],
      appointments: [tomorrow('a', 'pooja', '2026-10-13T10:00')],
    });
    expect(await due(t.clinicId)).toEqual([]);
  });
});

describe('reports', () => {
  it('stores and returns a go-live report', async () => {
    const saved = await call('POST', '/v1/clinics/smile-dental/reports', {
      runId: 'run-1',
      createdAt: '2026-10-12T05:30:00Z',
      verdicts: { booking: 'SAFE TO LAUNCH' },
    });
    const id = (saved.body.data as { reportId: string }).reportId;
    const back = await call('GET', `/v1/clinics/smile-dental/reports/${id}`);
    expect(back.body.data).toMatchObject({
      runId: 'run-1',
      verdicts: { booking: 'SAFE TO LAUNCH' },
    });
    expect((await call('POST', '/v1/clinics/smile-dental/reports', { nope: 1 })).status).toBe(400);
  });
});
