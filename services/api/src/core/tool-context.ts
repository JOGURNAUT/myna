import { randomUUID } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import { type BusinessConfig, ToolFailure } from '@myna/shared';
import type { SchedulingAdapter } from '../adapters/types.js';
import type { Db } from '../db/client.js';
import { verifications } from '../db/schema.js';

/** How long a successful identity check lasts. One call rarely runs past this. */
export const VERIFICATION_TTL_MIN = 30;

export interface ToolContext {
  db: Db;
  adapter: SchedulingAdapter;
  config: BusinessConfig;
  clock: () => Date;
}

export async function issueVerification(
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
export async function verifiedPatient(ctx: ToolContext, verificationId: string): Promise<string> {
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

export function assertNotKilled(config: BusinessConfig): void {
  if (config.killSwitch) {
    throw new ToolFailure('KILL_SWITCH', 'the clinic has routed all calls to staff');
  }
}
