/**
 * GlobIQ — shared validation helpers (§37: explicit validation errors).
 * Used by every module's zod schemas and API routes.
 */
import type { z } from 'zod'

/** Flattens zod issues into `{ field: message }` for the API error envelope. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_'
    if (!(key in out)) out[key] = issue.message
  }
  return out
}
