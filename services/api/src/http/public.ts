import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addDays, nowIn, splitDateTime, ToolFailure } from '@myna/shared';
import type { Db } from '../db/client.js';
import { hawkReports } from '../db/schema.js';
import type { ClinicRegistry } from './registry.js';

/**
 * Unauthenticated, read-only routes: a shared Hawk report link, and the demo clinic's
 * busy/free grid for the public "Talk to Myna" page. Neither ever contains a patient name.
 */
export function registerPublicRoutes(
  app: FastifyInstance,
  deps: { db: Db; registry: ClinicRegistry; clock: () => Date },
): void {
  app.get<{ Params: { reportId: string } }>('/reports/:reportId', async (req) => {
    const [row] = await deps.db
      .select()
      .from(hawkReports)
      .where(eq(hawkReports.id, req.params.reportId));
    if (!row) throw new ToolFailure('NOT_FOUND', 'unknown report');
    return { ok: true, data: JSON.parse(row.reportJson) as unknown };
  });

  app.get<{ Params: { clinicId: string } }>('/clinics/:clinicId/latest-report', async (req) => {
    const entry = deps.registry.get(req.params.clinicId);
    if (!entry?.config.publicDemo) throw new ToolFailure('NOT_FOUND', 'unknown clinic');
    const rows = await deps.db
      .select({ id: hawkReports.id, createdAt: hawkReports.createdAt })
      .from(hawkReports)
      .where(and(eq(hawkReports.tenantId, entry.config.tenantId)));
    const latest = rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!latest) throw new ToolFailure('NOT_FOUND', 'no report yet');
    return { ok: true, data: { reportId: latest.id } };
  });

  app.get<{ Params: { clinicId: string } }>('/clinics/:clinicId/demo', async (req) => {
    const entry = deps.registry.get(req.params.clinicId);
    if (!entry?.config.publicDemo) throw new ToolFailure('NOT_FOUND', 'unknown clinic');
    const { config, adapter } = entry;
    const today = splitDateTime(nowIn(config.timezone, deps.clock())).date;
    const busy = await adapter.listAppointmentsBetween(
      `${today}T00:00`,
      `${addDays(today, 7)}T00:00`,
    );
    return {
      ok: true,
      data: {
        name: config.name,
        today,
        hours: config.hours,
        closedDates: config.closedDates,
        resources: config.resources.map((r) => ({ id: r.id, name: r.name, hours: r.hours })),
        services: config.services.map((s) => ({
          id: s.id,
          name: s.name,
          durationMin: s.durationMin,
        })),
        // Times only: who is booked is nobody's business on a public page.
        busy: busy.map((a) => ({
          resourceId: a.resourceId,
          start: a.start,
          end: a.end,
          status: a.status,
        })),
      },
    };
  });
}
