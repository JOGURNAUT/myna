import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  BusinessConfig,
  CreateHawkTenantInput,
  type CreateHawkTenantOutput,
  type HawkTenantState,
  ToolFailure,
} from '@myna/shared';
import { registerClinics } from '../clinics.js';
import { phoneKey } from '../core/identity.js';
import { reminderAttemptsFor } from '../core/reminders.js';
import { listTasks } from '../core/tasks.js';
import type { Db } from '../db/client.js';
import { appointments, contactPreferences, patients } from '../db/schema.js';
import type { ClinicRegistry } from './registry.js';
import { parseOrFail } from './validate.js';

/**
 * Test-only routes for Hawk. Mounted only when HAWK_ENABLED=1, and main.ts refuses that in
 * production. Each scenario gets its own throwaway tenant cloned from a real clinic config.
 */
export function registerHawkRoutes(
  v1: FastifyInstance,
  deps: { db: Db; registry: ClinicRegistry },
): void {
  v1.post('/hawk/tenants', async (req): Promise<{ ok: true; data: CreateHawkTenantOutput }> => {
    const input = parseOrFail(CreateHawkTenantInput, req.body);
    const base = deps.registry.get(input.baseClinicId);
    if (!base) throw new ToolFailure('NOT_FOUND', `unknown clinic "${input.baseClinicId}"`);

    const clinicId = `hawk-${randomUUID().slice(0, 12)}`;
    const merged = {
      ...base.config,
      ...input.config,
      outboundReminders: { ...base.config.outboundReminders, ...input.config.outboundReminders },
      id: clinicId,
      tenantId: clinicId,
    };
    const parsed = BusinessConfig.safeParse(merged);
    if (!parsed.success) {
      throw new ToolFailure('VALIDATION', 'config overrides are invalid', {
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    }
    const config = parsed.data;
    await registerClinics(deps.db, [config]);
    const { adapter } = deps.registry.add(config);

    const patientIds: Record<string, string> = {};
    for (const p of input.patients) {
      const created = await adapter.createPatient(p);
      patientIds[p.key] = created.id;
      if (p.doNotCall) {
        await deps.db
          .insert(contactPreferences)
          .values({ tenantId: clinicId, phone: created.phone, doNotCall: true });
      }
    }
    const appointmentIds: Record<string, string> = {};
    for (const a of input.appointments) {
      const patientId = patientIds[a.patient];
      if (!patientId)
        throw new ToolFailure(
          'VALIDATION',
          `seed appointment "${a.key}": unknown patient "${a.patient}"`,
        );
      const service = config.services.find((s) => s.id === a.serviceId);
      if (!service)
        throw new ToolFailure('VALIDATION', `seed appointment "${a.key}": unknown service`);
      const end = new Date(`${a.start}:00Z`);
      end.setUTCMinutes(end.getUTCMinutes() + service.durationMin);
      const booked = await adapter.book({
        idempotencyKey: `hawk-seed-${clinicId}-${a.key}`,
        patientId,
        resourceId: a.resourceId,
        serviceId: a.serviceId,
        start: a.start,
        end: end.toISOString().slice(0, 16),
        source: 'hawk-seed',
      });
      appointmentIds[a.key] = booked.id;
    }
    return { ok: true, data: { clinicId, patients: patientIds, appointments: appointmentIds } };
  });

  v1.get<{ Params: { clinicId: string } }>(
    '/hawk/tenants/:clinicId/state',
    async (req): Promise<{ ok: true; data: HawkTenantState }> => {
      const entry = deps.registry.get(req.params.clinicId);
      if (!entry || !req.params.clinicId.startsWith('hawk-')) {
        throw new ToolFailure('NOT_FOUND', 'unknown hawk tenant');
      }
      const tenantId = entry.config.tenantId;
      const pats = await deps.db.select().from(patients).where(eq(patients.tenantId, tenantId));
      const dnc = new Set(
        (
          await deps.db
            .select()
            .from(contactPreferences)
            .where(eq(contactPreferences.tenantId, tenantId))
        )
          .filter((c) => c.doNotCall)
          .map((c) => c.phone),
      );
      const names = new Map(pats.map((p) => [p.id, p.name]));
      const appts = await deps.db
        .select()
        .from(appointments)
        .where(eq(appointments.tenantId, tenantId))
        .orderBy(appointments.start);
      const reminders = await reminderAttemptsFor(deps.db, tenantId);
      return {
        ok: true,
        data: {
          patients: pats.map((p) => ({
            id: p.id,
            name: p.name,
            phone: p.phone,
            doNotCall: dnc.has(phoneKey(p.phone) ?? p.phone),
          })),
          appointments: appts.map((a) => ({
            id: a.id,
            patientId: a.patientId,
            patientName: names.get(a.patientId) ?? '?',
            serviceId: a.serviceId,
            resourceId: a.resourceId,
            start: a.start,
            status: a.status,
          })),
          tasks: await listTasks(deps.db, entry.adapter),
          reminders: reminders.map((r) => ({
            appointmentId: r.appointmentId,
            callId: r.callId,
            outcome: r.outcome,
          })),
        },
      };
    },
  );
}
