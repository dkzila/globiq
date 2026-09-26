/**
 * GlobIQ — Editorial module: input validation (P2-S4, §37)
 * zod schemas for the workspace API surface. Scope rules (which country/
 * language an actor may touch) are enforced in the service layer on EVERY
 * operation (§20) — never by hiding UI elements.
 */
import { z } from 'zod'

import {
  EDITORIAL_TASK_ACTIONS,
  EDITORIAL_TASK_PRIORITIES,
  EDITORIAL_TASK_STATUSES,
  EDITORIAL_TASK_TYPES,
} from './types'

export const editorialTaskListQuerySchema = z.object({
  status: z.enum(EDITORIAL_TASK_STATUSES).optional(),
  type: z.enum(EDITORIAL_TASK_TYPES).optional(),
  priority: z.enum(EDITORIAL_TASK_PRIORITIES).optional(),
  /** 'me' = the caller's tasks; 'unassigned' = the unclaimed pool; a cuid = that user. */
  assignee: z.enum(['me', 'unassigned']).or(z.string().regex(/^c[a-z0-9]{20,}$/)).optional(),
  /** ADMIN only: ISO code filter; 'global' selects platform tasks (countryId null). */
  country: z.string().trim().min(2).max(8).optional(),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export type EditorialTaskListQuery = z.infer<typeof editorialTaskListQuerySchema>

export const createEditorialTaskSchema = z.object({
  type: z.enum(EDITORIAL_TASK_TYPES),
  /** The work object — a ContentItem id (polymorphic ref §6 object_id). */
  objectId: z.string().trim().regex(/^c[a-z0-9]{20,}$/, 'A content item id is required'),
  title: z.string().trim().min(3, 'Give the task a short title').max(160),
  notes: z.string().trim().max(2000).optional(),
  assigneeId: z
    .string()
    .trim()
    .regex(/^c[a-z0-9]{20,}$/, 'Assignee must be a staff member id')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  priority: z.enum(EDITORIAL_TASK_PRIORITIES).optional(),
  dueAt: z.string().datetime({ offset: true }).optional(),
})

export type CreateEditorialTaskInput = z.infer<typeof createEditorialTaskSchema>

export const updateEditorialTaskSchema = z
  .object({
    title: z.string().trim().min(3).max(160).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    priority: z.enum(EDITORIAL_TASK_PRIORITIES).optional(),
    dueAt: z.string().datetime({ offset: true }).nullable().optional(),
    /** null clears the assignment (back to the unclaimed pool). */
    assigneeId: z
      .string()
      .trim()
      .regex(/^c[a-z0-9]{20,}$/, 'Assignee must be a staff member id')
      .nullable()
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Nothing to update',
  })

export type UpdateEditorialTaskInput = z.infer<typeof updateEditorialTaskSchema>

export const editorialTaskTransitionSchema = z.object({
  action: z.enum(EDITORIAL_TASK_ACTIONS),
  /** Optional outcome note recorded on resolve. */
  resolutionNote: z.string().trim().max(1000).optional(),
})

export type EditorialTaskTransitionInput = z.infer<typeof editorialTaskTransitionSchema>
