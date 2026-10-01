import { z } from 'zod';

/**
 * Every failure a tool can return. The agent branches on `code`, never on `message`.
 */
export const ToolErrorCode = z.enum([
  'VALIDATION',
  'NOT_VERIFIED',
  'NOT_FOUND',
  'SLOT_UNAVAILABLE',
  'OUTSIDE_HOURS',
  'TOO_SOON',
  'TOO_FAR_AHEAD',
  'SERVICE_NOT_OFFERED',
  'ALREADY_CANCELLED',
  'IDEMPOTENCY_CONFLICT',
  'KILL_SWITCH',
  'UNAUTHORIZED',
  'INTERNAL',
]);
export type ToolErrorCode = z.infer<typeof ToolErrorCode>;

export const ToolError = z.object({
  code: ToolErrorCode,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ToolError = z.infer<typeof ToolError>;

/** Typed error thrown inside the API and adapters; serialised as `ToolError`. */
export class ToolFailure extends Error {
  override readonly name = 'ToolFailure';
  constructor(
    readonly code: ToolErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }

  toJSON(): ToolError {
    return this.details
      ? { code: this.code, message: this.message, details: this.details }
      : { code: this.code, message: this.message };
  }
}

export const isToolFailure = (e: unknown): e is ToolFailure => e instanceof ToolFailure;
