import { z } from 'zod';
import { Language } from './primitives.js';

/** Call log contracts: the agent reports every turn and tool call to the API. */

export const CallDirection = z.enum(['inbound', 'outbound']);
export const CallSource = z.enum(['patient', 'manual_test', 'hawk']);

export const StartCallInput = z.object({
  direction: CallDirection.default('inbound'),
  source: CallSource.default('patient'),
  /** Caller's number, masked before it is stored in logs. */
  callerPhone: z.string().optional(),
});
export const StartCallOutput = z.object({ callId: z.string() });

export const CallEvent = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('turn'),
    speaker: z.enum(['agent', 'caller']),
    text: z.string(),
    language: Language.optional(),
    state: z.string(),
    latencyMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal('tool_call'),
    tool: z.string(),
    ok: z.boolean(),
    errorCode: z.string().optional(),
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('end'),
    outcome: z.string(),
    handoffReason: z.string().optional(),
  }),
]);
export type CallEvent = z.infer<typeof CallEvent>;
