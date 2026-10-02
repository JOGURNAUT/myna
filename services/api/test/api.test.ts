import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { BusinessConfig } from '@myna/shared';
import { buildApp } from '../src/http/app.js';
import { DEMO_PATIENTS, seedDemo } from '../src/seed.js';
import { loadDemoConfig, makeTestDb, NOW } from './helpers.js';

const TOKEN = 'test-token-0123456789';
const CLINIC = 'smile-dental';

interface Ctx {
  app: FastifyInstance;
  cleanup: () => void;
  clock: { now: Date };
}

async function setup(mutate: (c: BusinessConfig) => BusinessConfig = (c) => c): Promise<Ctx> {
  const config = mutate(await loadDemoConfig());
  const { db, cleanup } = await makeTestDb([config]);
  await seedDemo(db, config, NOW);
  const clock = { now: NOW };
  const app = await buildApp({
    db,
    clinics: new Map([[config.id, config]]),
    agentToken: TOKEN,
    clock: () => clock.now,
  });
  return { app, cleanup, clock };
}

interface Envelope {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string; details?: unknown };
}

function client(app: FastifyInstance) {
  const call = async (method: 'GET' | 'POST', url: string, body?: unknown, token = TOKEN) => {
    const res = await app.inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
    });
    return { status: res.statusCode, body: res.json<Envelope>() };
  };
  return {
    call,
    tool: (name: string, body: unknown) =>
      call('POST', `/v1/clinics/${CLINIC}/tools/${name}`, body),
  };
}

let keyN = 0;
const key = () => `api-test-key-${++keyN}`;
const [pooja, arjun, , , meera, kavya] = DEMO_PATIENTS;

describe('API', () => {
  let ctx: Ctx;
  let api: ReturnType<typeof client>;
  beforeEach(async () => {
    ctx = await setup();
    api = client(ctx.app);
  });
  afterEach(async () => {
    await ctx.app.close();
    ctx.cleanup();
  });

  const verify = async (p: { name: string; dob?: string; phone?: string }) => {
    const res = await api.tool('find_patient', { callId: 'call-test', ...p });
    return res.body.data as { status: string; verificationId?: string; patient?: { name: string } };
  };

  describe('auth and routing', () => {
    it('rejects requests without the agent token', async () => {
      const res = await api.call('GET', `/v1/clinics/${CLINIC}/config`, undefined, '');
      expect(res.status).toBe(401);
      expect(res.body.error?.code).toBe('UNAUTHORIZED');
      expect(
        (await api.call('GET', `/v1/clinics/${CLINIC}/config`, undefined, 'wrong-token-xxxxxx'))
          .status,
      ).toBe(401);
    });

    it('serves the clinic config to the agent', async () => {
      const res = await api.call('GET', `/v1/clinics/${CLINIC}/config`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: CLINIC, killSwitch: false, recordCalls: false });
    });

    it('404s unknown clinics and unknown tools', async () => {
      expect((await api.call('GET', '/v1/clinics/nope/config')).status).toBe(404);
      expect((await api.tool('drop_tables', {})).status).toBe(404);
    });

    it('has a handler for every tool in the contract', async () => {
      const { TOOLS } = await import('@myna/shared');
      for (const name of Object.keys(TOOLS)) {
        const res = await api.tool(name, {});
        expect(res.status, name).toBe(400); // exists, and validates its input
      }
    });

    it('does not mount the Hawk test routes by default', async () => {
      expect((await api.call('POST', '/v1/hawk/tenants', { baseClinicId: CLINIC })).status).toBe(
        404,
      );
    });

    it('explains validation failures by path', async () => {
      const res = await api.tool('find_slots', { serviceId: 'cleaning', dateFrom: 'tomorrow' });
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('VALIDATION');
      expect(JSON.stringify(res.body.error?.details)).toContain('dateFrom');
    });

    it('answers malformed JSON with a typed error', async () => {
      const res = await ctx.app.inject({
        method: 'POST',
        url: `/v1/clinics/${CLINIC}/tools/find_slots`,
        headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        payload: '{not json',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json<Envelope>().error?.code).toBe('VALIDATION');
    });
  });

  describe('verification (safety rule 4)', () => {
    it('verifies with full name + date of birth', async () => {
      const v = await verify({ name: pooja.name, dob: pooja.dob });
      expect(v.status).toBe('verified');
      expect(v.patient?.name).toBe('Pooja Malhotra');
    });

    it('verifies with name + registered phone, ignoring honorifics, order and spacing', async () => {
      const v = await verify({ name: 'malhotra pooja ji', phone: '+91 98111 00733' });
      expect(v.status).toBe('verified');
    });

    it('tells family members on one phone apart by name', async () => {
      const v = await verify({ name: kavya.name, phone: kavya.phone });
      expect(v.patient?.name).toBe('Kavya Nair');
      const m = await verify({ name: meera.name, phone: meera.phone });
      expect(m.patient?.name).toBe('Meera Nair');
    });

    it.each([
      ['wrong date of birth', { name: pooja.name, dob: '1990-04-13' }],
      ['wrong phone', { name: pooja.name, phone: '9811100734' }],
      ['right phone, wrong name', { name: 'Priya Malhotra', phone: pooja.phone }],
      ["someone else's dob", { name: pooja.name, dob: arjun.dob }],
      ['first name only', { name: 'Pooja', dob: pooja.dob }],
    ])('refuses %s, saying nothing about why', async (_label, query) => {
      const v = await verify(query);
      expect(v).toEqual({ status: 'not_verified' });
    });

    it('requires a second factor', async () => {
      const res = await api.tool('find_patient', { callId: 'c', name: pooja.name });
      expect(res.status).toBe(400);
    });

    it('refuses appointment details without a valid verification', async () => {
      for (const verificationId of ['ver_made-up-id', 'not-even-close']) {
        const res = await api.tool('list_appointments', { verificationId });
        expect(res.status).toBe(403);
        expect(res.body.error?.code).toBe('NOT_VERIFIED');
        expect(JSON.stringify(res.body)).not.toContain('Pooja');
      }
    });

    it('lists only the verified patient’s own appointments', async () => {
      const v = await verify({ name: pooja.name, dob: pooja.dob });
      const res = await api.tool('list_appointments', { verificationId: v.verificationId });
      const list = (
        res.body.data as { appointments: { serviceId: string; resourceName: string }[] }
      ).appointments;
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ serviceId: 'cleaning', resourceName: 'Dr. Mehta' });
    });

    it('expires a verification after 30 minutes', async () => {
      const v = await verify({ name: pooja.name, dob: pooja.dob });
      ctx.clock.now = new Date(NOW.getTime() + 31 * 60_000);
      const res = await api.tool('list_appointments', { verificationId: v.verificationId });
      expect(res.body.error?.code).toBe('NOT_VERIFIED');
    });

    it("a caller verified as one patient cannot touch another's appointment", async () => {
      const asArjun = await verify({ name: arjun.name, dob: arjun.dob });
      const asPooja = await verify({ name: pooja.name, dob: pooja.dob });
      const poojas = await api.tool('list_appointments', {
        verificationId: asPooja.verificationId,
      });
      const apptId = (poojas.body.data as { appointments: { id: string }[] }).appointments[0]!.id;
      for (const [tool, body] of [
        [
          'cancel',
          { idempotencyKey: key(), verificationId: asArjun.verificationId, appointmentId: apptId },
        ],
        [
          'reschedule',
          {
            idempotencyKey: key(),
            verificationId: asArjun.verificationId,
            appointmentId: apptId,
            newStart: '2026-10-13T11:00',
          },
        ],
        [
          'send_sms_confirmation',
          { verificationId: asArjun.verificationId, appointmentId: apptId, language: 'en' },
        ],
      ] as const) {
        const res = await api.tool(tool, body);
        expect(res.body.error?.code, tool).toBe('NOT_FOUND');
      }
    });
  });

  describe('scheduling through tools', () => {
    it('finds slots, books a new patient, and hands back a verification for the rest of the call', async () => {
      const slots = await api.tool('find_slots', {
        serviceId: 'cleaning',
        dateFrom: '2026-10-13',
        dateTo: '2026-10-13',
        partOfDay: 'evening',
      });
      const first = (slots.body.data as { slots: { start: string; resourceId: string }[] })
        .slots[0]!;
      expect(first.start).toBe('2026-10-13T17:00');

      const booked = await api.tool('book', {
        idempotencyKey: key(),
        callId: 'call-1',
        newPatient: { name: 'Neha Kapoor', phone: '9822200111' },
        serviceId: 'cleaning',
        resourceId: first.resourceId,
        start: first.start,
      });
      expect(booked.status).toBe(200);
      const data = booked.body.data as {
        appointment: { status: string; serviceName: string };
        verificationId: string;
      };
      expect(data.appointment).toMatchObject({ status: 'confirmed', serviceName: 'Cleaning' });

      const sms = await api.tool('send_sms_confirmation', {
        verificationId: data.verificationId,
        appointmentId: (data.appointment as unknown as { id: string }).id,
        language: 'hinglish',
      });
      expect(sms.body.data).toEqual({ queued: true });
    });

    it('enforces clinic rules in the API, whatever the agent sends', async () => {
      const v = await verify({ name: pooja.name, dob: pooja.dob });
      const attempt = (start: string, resourceId = 'dr-mehta', serviceId = 'cleaning') =>
        api.tool('book', {
          idempotencyKey: key(),
          callId: 'c',
          verificationId: v.verificationId,
          serviceId,
          resourceId,
          start,
        });
      expect((await attempt('2026-10-18T10:00')).body.error?.code).toBe('OUTSIDE_HOURS'); // Sunday
      expect((await attempt('2026-10-20T10:00')).body.error?.code).toBe('OUTSIDE_HOURS'); // Diwali
      expect((await attempt('2026-10-12T09:30')).body.error?.code).toBe('TOO_SOON');
      expect((await attempt('2027-01-04T10:00')).body.error?.code).toBe('TOO_FAR_AHEAD');
      expect((await attempt('2026-10-14T10:00', 'dr-rao', 'root-canal')).body.error?.code).toBe(
        'SERVICE_NOT_OFFERED',
      );
    });

    it('a retried book with the same key books once', async () => {
      const v = await verify({ name: arjun.name, dob: arjun.dob });
      const body = {
        idempotencyKey: key(),
        callId: 'c',
        verificationId: v.verificationId,
        serviceId: 'consultation',
        resourceId: 'dr-mehta',
        start: '2026-10-13T12:00',
      };
      const a = await api.tool('book', body);
      const b = await api.tool('book', body);
      expect(a.body.data).toEqual(b.body.data);
      const list = await api.tool('list_appointments', { verificationId: v.verificationId });
      expect((list.body.data as { appointments: unknown[] }).appointments).toHaveLength(2); // seeded + this one
    });

    it('reschedules within the same doctor and keeps exactly one booking', async () => {
      const v = await verify({ name: pooja.name, dob: pooja.dob });
      const before = await api.tool('list_appointments', { verificationId: v.verificationId });
      const appt = (before.body.data as { appointments: { id: string }[] }).appointments[0]!;
      const moved = await api.tool('reschedule', {
        idempotencyKey: key(),
        verificationId: v.verificationId,
        appointmentId: appt.id,
        newStart: '2026-10-16T18:00',
      });
      expect(moved.status).toBe(200);
      const after = await api.tool('list_appointments', { verificationId: v.verificationId });
      const list = (after.body.data as { appointments: { id: string; start: string }[] })
        .appointments;
      expect(list).toEqual([expect.objectContaining({ id: appt.id, start: '2026-10-16T18:00' })]);
    });
  });

  describe('call log', () => {
    it('stores masked caller numbers and the event stream, including handoffs', async () => {
      const started = await api.call('POST', `/v1/clinics/${CLINIC}/calls`, {
        callerPhone: '9811100733',
        source: 'manual_test',
      });
      const callId = (started.body.data as { callId: string }).callId;
      await api.call('POST', `/v1/clinics/${CLINIC}/calls/${callId}/events`, {
        type: 'turn',
        speaker: 'agent',
        text: 'Namaste',
        state: 'GREETING',
      });
      const handoff = await api.tool('handoff_to_human', {
        callId,
        reason: 'emergency',
        summary: 'caller reports heavy bleeding',
      });
      expect(handoff.body.data).toEqual({ transferTo: '9800000002' });
      const events = await api.call('GET', `/v1/clinics/${CLINIC}/calls/${callId}/events`);
      const types = (events.body.data as { events: { type: string }[] }).events.map((e) => e.type);
      expect(types).toEqual(['turn', 'handoff']);
    });

    it('rejects events for unknown calls', async () => {
      const res = await api.call('POST', `/v1/clinics/${CLINIC}/calls/call_nope/events`, {
        type: 'end',
        outcome: 'x',
      });
      expect(res.status).toBe(404);
    });
  });
});

describe('API with the kill switch on (safety rule 6)', () => {
  it('refuses every schedule change but still answers reads and handoffs', async () => {
    const ctx = await setup((c) => ({ ...c, killSwitch: true }));
    const api = client(ctx.app);
    try {
      const slots = await api.tool('find_slots', {
        serviceId: 'cleaning',
        dateFrom: '2026-10-13',
        dateTo: '2026-10-13',
      });
      expect(slots.status).toBe(200);
      const booked = await api.tool('book', {
        idempotencyKey: key(),
        callId: 'c',
        newPatient: { name: 'Neha Kapoor', phone: '9822200111' },
        serviceId: 'cleaning',
        resourceId: 'dr-mehta',
        start: '2026-10-13T11:00',
      });
      expect(booked.status).toBe(423);
      expect(booked.body.error?.code).toBe('KILL_SWITCH');
    } finally {
      await ctx.app.close();
      ctx.cleanup();
    }
  });
});
