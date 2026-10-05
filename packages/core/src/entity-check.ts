import { ValidationError } from './errors.js';
import type { z } from 'zod';

/** Parses `value`, throwing a {@link ValidationError} that names `what`. */
export function check<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ValidationError(
      `invalid ${what}`,
      parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    );
  }
  return parsed.data;
}
