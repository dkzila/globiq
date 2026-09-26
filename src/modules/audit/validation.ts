/**
 * GlobIQ — Audit module: query validation
 * Master Plan §37 (explicit validation errors, pagination, deterministic sort).
 */
import { z } from 'zod'

export const auditListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Exact action key, e.g. "taxonomy.topic.update". */
  action: z.string().trim().min(1).max(100).optional(),
  /** Actor email substring (case-insensitive). */
  actor: z.string().trim().min(1).max(200).optional(),
  objectType: z.string().trim().min(1).max(60).optional(),
  objectId: z.string().trim().min(1).max(60).optional(),
  /** ISO date-time lower bound (inclusive). */
  from: z.coerce.date().optional(),
  /** ISO date-time upper bound (inclusive). */
  to: z.coerce.date().optional(),
})

export type AuditListQuery = z.infer<typeof auditListQuerySchema>
