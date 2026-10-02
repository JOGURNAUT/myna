import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import {
  maskPhone,
  nowIn,
  type StaffTask,
  type ToolArgs,
  ToolFailure,
  type ToolOutput,
} from '@myna/shared';
import type { SchedulingAdapter } from '../adapters/types.js';
import type { Db } from '../db/client.js';
import { staffTasks } from '../db/schema.js';
import { addOpenMinutes } from './hours.js';
import { phoneKey } from './identity.js';
import { type ToolContext, verifiedPatient } from './tool-context.js';

/** Flow (b): a message for staff, with a call-back promise counted in opening hours. */
export async function createStaffTask(
  ctx: ToolContext,
  args: ToolArgs<'create_staff_task'>,
): Promise<ToolOutput<'create_staff_task'>> {
  const patientId =
    args.verificationId === undefined ? null : await verifiedPatient(ctx, args.verificationId);
  const phone = phoneKey(args.callbackNumber);
  if (!phone)
    throw new ToolFailure('VALIDATION', 'callback number must be a 10-digit Indian mobile');

  const urgency = ctx.config.staffTasks.urgentCategories.includes(args.category)
    ? 'urgent'
    : args.urgency;
  const now = nowIn(ctx.config.timezone, ctx.clock());
  const callbackBy = addOpenMinutes(ctx.config, now, ctx.config.callbackPromiseHours * 60);
  if (callbackBy === null) throw new ToolFailure('INTERNAL', 'clinic has no opening hours');

  const id = `task_${randomUUID()}`;
  await ctx.db.insert(staffTasks).values({
    id,
    tenantId: ctx.config.tenantId,
    callId: args.callId,
    patientId,
    // A verified patient is named by the record; an unverified caller only by what they said.
    callerName: patientId === null ? (args.callerName ?? null) : null,
    category: args.category,
    summary: args.summary,
    urgency,
    callbackNumber: phone,
    callbackBy,
  });
  return { taskId: id, callbackBy };
}

export async function listTasks(
  db: Db,
  adapter: SchedulingAdapter,
  status?: 'open' | 'done',
): Promise<StaffTask[]> {
  const tenantId = adapter.config.tenantId;
  const rows = await db
    .select()
    .from(staffTasks)
    .where(
      and(eq(staffTasks.tenantId, tenantId), ...(status ? [eq(staffTasks.status, status)] : [])),
    )
    .orderBy(staffTasks.callbackBy, desc(staffTasks.createdAt));
  return Promise.all(
    rows.map(async (r): Promise<StaffTask> => {
      const patient = r.patientId ? await adapter.getPatient(r.patientId) : null;
      return {
        id: r.id,
        callId: r.callId,
        category: r.category,
        summary: r.summary,
        urgency: r.urgency,
        patientId: r.patientId,
        patientName: patient?.name ?? null,
        callerName: r.callerName,
        verified: r.patientId !== null,
        callbackNumberMasked: maskPhone(r.callbackNumber),
        callbackBy: r.callbackBy,
        status: r.status,
        createdAt: r.createdAt,
      };
    }),
  );
}

export async function completeTask(db: Db, tenantId: string, taskId: string): Promise<void> {
  const done = await db
    .update(staffTasks)
    .set({ status: 'done', doneAt: new Date().toISOString() })
    .where(and(eq(staffTasks.tenantId, tenantId), eq(staffTasks.id, taskId)))
    .returning({ id: staffTasks.id });
  if (done.length === 0) throw new ToolFailure('NOT_FOUND', `unknown task "${taskId}"`);
}
