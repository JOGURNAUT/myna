import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { type CallEvent, maskPhone, ToolFailure } from '@myna/shared';
import { type Db, writeTransaction } from '../db/client.js';
import { callEvents, calls } from '../db/schema.js';

export interface StartCall {
  direction: 'inbound' | 'outbound';
  source: 'patient' | 'manual_test' | 'hawk';
  callerPhone?: string | undefined;
}

export async function startCall(db: Db, tenantId: string, input: StartCall): Promise<string> {
  const id = `call_${randomUUID()}`;
  await db.insert(calls).values({
    id,
    tenantId,
    direction: input.direction,
    source: input.source,
    callerPhoneMasked: input.callerPhone ? maskPhone(input.callerPhone) : null,
  });
  return id;
}

async function assertCall(db: Db, tenantId: string, callId: string): Promise<void> {
  const [row] = await db
    .select({ id: calls.id })
    .from(calls)
    .where(and(eq(calls.tenantId, tenantId), eq(calls.id, callId)));
  if (!row) throw new ToolFailure('NOT_FOUND', `unknown call "${callId}"`);
}

export async function appendCallEvent(
  db: Db,
  tenantId: string,
  callId: string,
  event: CallEvent,
): Promise<void> {
  await assertCall(db, tenantId, callId);
  await writeTransaction(db, async (tx) => {
    await tx.insert(callEvents).values({
      tenantId,
      callId,
      type: event.type,
      payloadJson: JSON.stringify(event),
    });
    if (event.type === 'end') {
      await tx
        .update(calls)
        .set({
          endedAt: new Date().toISOString(),
          outcome: event.outcome,
          ...(event.handoffReason ? { handoffReason: event.handoffReason } : {}),
        })
        .where(and(eq(calls.tenantId, tenantId), eq(calls.id, callId)));
    }
  });
}

export async function recordHandoff(
  db: Db,
  tenantId: string,
  callId: string,
  reason: string,
  summary: string,
): Promise<void> {
  await assertCall(db, tenantId, callId);
  await writeTransaction(db, async (tx) => {
    await tx.insert(callEvents).values({
      tenantId,
      callId,
      type: 'handoff',
      payloadJson: JSON.stringify({ type: 'handoff', reason, summary }),
    });
    await tx
      .update(calls)
      .set({ handoffReason: reason })
      .where(and(eq(calls.tenantId, tenantId), eq(calls.id, callId)));
  });
}

export async function listCallEvents(db: Db, tenantId: string, callId: string) {
  await assertCall(db, tenantId, callId);
  const rows = await db
    .select()
    .from(callEvents)
    .where(and(eq(callEvents.tenantId, tenantId), eq(callEvents.callId, callId)))
    .orderBy(callEvents.id);
  return rows.map((r) => JSON.parse(r.payloadJson) as unknown);
}
