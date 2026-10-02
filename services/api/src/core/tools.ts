import { randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import {
  type Appointment,
  type BusinessConfig,
  nowIn,
  type ToolArgs,
  ToolFailure,
  type ToolName,
  type ToolOutput,
} from '@myna/shared';
import type { SchedulingAdapter, StoredAppointment } from '../adapters/types.js';
import type { Db } from '../db/client.js';
import { smsOutbox, verifications } from '../db/schema.js';
import { recordHandoff } from './calls.js';
import { nameKey, phoneKey } from './identity.js';
import { assertBookable, findResource, findService } from './slots.js';

/** How long a successful identity check lasts. One call rarely runs past this. */
export const VERIFICATION_TTL_MIN = 30;

export interface ToolContext {
  db: Db;
  adapter: SchedulingAdapter;
  config: BusinessConfig;
  clock: () => Date;
}

type Handler<K extends ToolName> = (ctx: ToolContext, args: ToolArgs<K>) => Promise<ToolOutput<K>>;
export type ToolHandlers = { [K in ToolName]?: Handler<K> };

const localNow = (ctx: ToolContext) => nowIn(ctx.config.timezone, ctx.clock());

function toAppointment(config: BusinessConfig, a: StoredAppointment): Appointment {
  return {
    ...a,
    resourceName: findResource(config, a.resourceId).name,
    serviceName: findService(config, a.serviceId).name,
  };
}

async function issueVerification(
  ctx: ToolContext,
  patientId: string,
  callId: string,
): Promise<string> {
  const id = `ver_${randomUUID()}`;
  const expiresAt = new Date(ctx.clock().getTime() + VERIFICATION_TTL_MIN * 60_000).toISOString();
  await ctx.db.insert(verifications).values({
    id,
    tenantId: ctx.config.tenantId,
    patientId,
    callId,
    expiresAt,
  });
  return id;
}

/** Resolves a verification to its patient, or refuses. Every patient-specific tool goes through here. */
async function verifiedPatient(ctx: ToolContext, verificationId: string): Promise<string> {
  const [row] = await ctx.db
    .select({ patientId: verifications.patientId })
    .from(verifications)
    .where(
      and(
        eq(verifications.tenantId, ctx.config.tenantId),
        eq(verifications.id, verificationId),
        gt(verifications.expiresAt, ctx.clock().toISOString()),
      ),
    );
  if (!row) throw new ToolFailure('NOT_VERIFIED', 'patient is not verified on this call');
  return row.patientId;
}

function assertNotKilled(config: BusinessConfig): void {
  if (config.killSwitch) {
    throw new ToolFailure('KILL_SWITCH', 'the clinic has routed all calls to staff');
  }
}

/** The patient's own appointment; anybody else's is indistinguishable from a missing one. */
async function ownAppointment(ctx: ToolContext, patientId: string, appointmentId: string) {
  const appt = await ctx.adapter.getAppointment(appointmentId);
  if (appt?.patientId !== patientId) {
    throw new ToolFailure('NOT_FOUND', 'no such appointment for this patient');
  }
  return appt;
}

export const toolHandlers: ToolHandlers = {
  async find_patient(ctx, args) {
    const wanted = nameKey(args.name);
    const phone = args.phone === undefined ? null : phoneKey(args.phone);
    const candidates = await ctx.adapter.findPatients({
      ...(phone ? { phone } : {}),
      ...(args.dob ? { dob: args.dob } : {}),
    });
    const matches = candidates.filter(
      (c) =>
        nameKey(c.name) === wanted &&
        ((args.dob !== undefined && c.dob === args.dob) || (phone !== null && c.phone === phone)),
    );
    // Exactly one match, or nothing. Two people with the same name and number get a human.
    const [only] = matches;
    if (matches.length !== 1 || !only) return { status: 'not_verified' };
    return {
      status: 'verified',
      verificationId: await issueVerification(ctx, only.id, args.callId),
      patient: { id: only.id, name: only.name },
    };
  },

  async list_appointments(ctx, args) {
    const patientId = await verifiedPatient(ctx, args.verificationId);
    const list = await ctx.adapter.listAppointments(patientId, localNow(ctx));
    return { appointments: list.map((a) => toAppointment(ctx.config, a)) };
  },

  async find_slots(ctx, args) {
    return { slots: await ctx.adapter.listSlots(args, localNow(ctx)) };
  },

  async book(ctx, args) {
    assertNotKilled(ctx.config);
    const now = localNow(ctx);
    const slot = assertBookable(ctx.config, args.resourceId, args.serviceId, args.start, now);

    let patientId: string;
    let newVerification: string | undefined;
    if (args.verificationId !== undefined) {
      patientId = await verifiedPatient(ctx, args.verificationId);
    } else if (args.newPatient !== undefined) {
      const np = args.newPatient;
      const phone = phoneKey(np.phone);
      if (!phone)
        throw new ToolFailure('VALIDATION', 'phone must be a 10-digit Indian mobile number');
      // Same name + same number is the same person (that is also a valid verification).
      const existing = (await ctx.adapter.findPatients({ phone })).filter(
        (c) => nameKey(c.name) === nameKey(np.name),
      );
      const patient =
        existing.length === 1 && existing[0]
          ? existing[0]
          : await ctx.adapter.createPatient({ name: np.name, phone, dob: np.dob });
      patientId = patient.id;
      newVerification = await issueVerification(ctx, patientId, args.callId);
    } else {
      throw new ToolFailure('VALIDATION', 'exactly one of verificationId or newPatient');
    }

    const stored = await ctx.adapter.book({
      idempotencyKey: args.idempotencyKey,
      patientId,
      resourceId: args.resourceId,
      serviceId: args.serviceId,
      start: slot.start,
      end: slot.end,
      source: 'agent',
    });
    const appointment = toAppointment(ctx.config, stored);
    return newVerification ? { appointment, verificationId: newVerification } : { appointment };
  },

  async reschedule(ctx, args) {
    assertNotKilled(ctx.config);
    const patientId = await verifiedPatient(ctx, args.verificationId);
    const current = await ownAppointment(ctx, patientId, args.appointmentId);
    const resourceId = args.newResourceId ?? current.resourceId;
    const slot = assertBookable(
      ctx.config,
      resourceId,
      current.serviceId,
      args.newStart,
      localNow(ctx),
    );
    const stored = await ctx.adapter.reschedule({
      idempotencyKey: args.idempotencyKey,
      appointmentId: current.id,
      patientId,
      resourceId,
      start: slot.start,
      end: slot.end,
    });
    return { appointment: toAppointment(ctx.config, stored) };
  },

  async cancel(ctx, args) {
    assertNotKilled(ctx.config);
    const patientId = await verifiedPatient(ctx, args.verificationId);
    const stored = await ctx.adapter.cancel({
      idempotencyKey: args.idempotencyKey,
      appointmentId: args.appointmentId,
      patientId,
    });
    return { appointment: toAppointment(ctx.config, stored) };
  },

  async handoff_to_human(ctx, args) {
    await recordHandoff(ctx.db, ctx.config.tenantId, args.callId, args.reason, args.summary);
    return { transferTo: ctx.config.humanHandoffNumber };
  },

  async send_sms_confirmation(ctx, args) {
    const patientId = await verifiedPatient(ctx, args.verificationId);
    const appt = await ownAppointment(ctx, patientId, args.appointmentId);
    // M1: queue only. A provider (Exotel/Plivo SMS) sends from the outbox in a later milestone.
    await ctx.db.insert(smsOutbox).values({
      id: `sms_${randomUUID()}`,
      tenantId: ctx.config.tenantId,
      appointmentId: appt.id,
      language: args.language,
    });
    return { queued: true };
  },
};
