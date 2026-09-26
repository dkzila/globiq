/**
 * GlobIQ — Exams module: input validation (P3-S1)
 * Master Plan §6 (Exam/ExamVersion field rows), §14 (country required — an
 * exam is never global), §16 (URL-stable slug), §36 (version windows:
 * day-granular, non-overlapping; effectiveTo inclusive), §37 (explicit errors).
 *
 * Identity is create-time: slug + code + country are immutable afterwards
 * (stable identifiers §37, migration-safe §36).
 */
import { z } from 'zod'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/

export const examSlugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters')
  .max(96, 'Slug must be at most 96 characters')
  .regex(SLUG_PATTERN, 'Slug must be lowercase kebab-case (letters, digits, single hyphens)')

export const EXAM_LEVELS = ['NATIONAL', 'STATE', 'REGIONAL'] as const

export const EXAM_TRANSITION_ACTIONS = ['activate', 'deactivate', 'reactivate', 'retire'] as const

export const createExamSchema = z.object({
  name: z.string().trim().min(3, 'Exam name must be at least 3 characters').max(160),
  slug: examSlugSchema,
  code: z
    .string()
    .trim()
    .min(2, 'Code must be at least 2 characters')
    .max(32, 'Code must be at most 32 characters')
    .regex(CODE_PATTERN, 'Code must be uppercase letters/digits with hyphens, e.g. "UPSC-CSE"'),
  organiser: z.string().trim().min(2, 'Organiser (conducting body) is required').max(160),
  level: z.enum(EXAM_LEVELS).default('NATIONAL'),
  /** §14: the owning country ISO code — always required (exams are never global). */
  country: z.string().trim().min(2, 'Country is required — every exam belongs to exactly one country (§14)').max(2),
  description: z.string().trim().max(2000).optional(),
  notes: z.string().trim().max(2000).optional(),
})

export type CreateExamInput = z.infer<typeof createExamSchema>

/**
 * Update schema — descriptive fields only. slug/code/country are immutable
 * identity (§37 stable identifiers); status changes go through transitions.
 */
export const updateExamSchema = z.object({
  name: z.string().trim().min(3).max(160).optional(),
  organiser: z.string().trim().min(2).max(160).optional(),
  level: z.enum(EXAM_LEVELS).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type UpdateExamInput = z.infer<typeof updateExamSchema>

export const examTransitionSchema = z.object({
  action: z.enum(EXAM_TRANSITION_ACTIONS),
  /** Required for retire (§36 provenance — why this exam left the platform). */
  reason: z.string().trim().max(1000).optional(),
})

export type ExamTransitionInput = z.infer<typeof examTransitionSchema>

/**
 * §36: exam syllabus changes create a NEW ExamVersion — never edit a window.
 * effectiveFrom defaults to today; effectiveTo is the inclusive last day.
 * Overlap/precedence rules are enforced in the service (they need DB state).
 */
export const createExamVersionSchema = z
  .object({
    label: z.string().trim().min(3, 'Label must be at least 3 characters').max(160),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().nullable().optional(),
    source: z.string().trim().max(500).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    const from = data.effectiveFrom instanceof Date ? data.effectiveFrom : null
    const to = data.effectiveTo instanceof Date ? data.effectiveTo : null
    if (from && to && to < from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['effectiveTo'],
        message: 'effectiveTo must not be before effectiveFrom',
      })
    }
  })

export type CreateExamVersionInput = z.infer<typeof createExamVersionSchema>

/** Metadata-only edits; the effective window is immutable (§36 append-only history). */
export const updateExamVersionSchema = z.object({
  label: z.string().trim().min(3).max(160).optional(),
  source: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type UpdateExamVersionInput = z.infer<typeof updateExamVersionSchema>

/** Public directory: country-scoped ACTIVE exams (§38). */
export const publicExamListQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export type PublicExamListQuery = z.infer<typeof publicExamListQuerySchema>

export const adminExamListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'RETIRED']).optional(),
  level: z.enum(EXAM_LEVELS).optional(),
  country: z.string().trim().min(2).max(2).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminExamListQuery = z.infer<typeof adminExamListQuerySchema>

// ---------- P3-S2: SyllabusNode validation (§6, §13, §36) ----------

export const createSyllabusNodeSchema = z.object({
  name: z.string().trim().min(2, 'Node name must be at least 2 characters').max(200),
  /** Parent within the SAME version (service checks); null/omitted = root. */
  parentId: z.string().trim().min(5).optional().nullable(),
  /** Canonical taxonomy link (§13): GLOBAL or the exam's country (service checks). */
  topicId: z.string().trim().min(5).optional().nullable(),
  priority: z.coerce.number().int().min(0).max(9999).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export type CreateSyllabusNodeInput = z.infer<typeof createSyllabusNodeSchema>

/** Update/move: every field optional — parentId carries the move (cycle guard in service). */
export const updateSyllabusNodeSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  parentId: z.string().trim().min(5).optional().nullable(),
  topicId: z.string().trim().min(5).optional().nullable(),
  priority: z.coerce.number().int().min(0).max(9999).optional(),
  notes: z.string().trim().max(2000).optional().nullable(),
})

export type UpdateSyllabusNodeInput = z.infer<typeof updateSyllabusNodeSchema>

/**
 * Bulk outline import — the primary staging path. Indented plain text where
 * indentation = tree depth (2 spaces OR 1 tab per level); blank lines and
 * lines starting with "#" are ignored. An EMPTY outline clears the staged
 * tree (staging only — §36 frozen versions refuse the call entirely).
 */
export const importSyllabusOutlineSchema = z.object({
  outline: z.string().max(200_000),
})

export type ImportSyllabusOutlineInput = z.infer<typeof importSyllabusOutlineSchema>

/** Public syllabus read: current version by default, or an explicit started one. */
export const publicSyllabusQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  version: z.string().trim().min(5).optional(),
})

export type PublicSyllabusQuery = z.infer<typeof publicSyllabusQuerySchema>
