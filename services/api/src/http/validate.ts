import type { z } from 'zod';
import { ToolFailure } from '@myna/shared';

/** Parses a request part against a contract, or throws a typed VALIDATION failure. */
export function parseOrFail<T extends z.ZodType>(schema: T, value: unknown): z.output<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new ToolFailure('VALIDATION', 'request does not match the contract', {
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}
