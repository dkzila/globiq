/**
 * GlobIQ — Exam Mapping module: input validation (P3-S3)
 * Master Plan §6 (ExamMapping field row), §8 (requirement-layer semantics),
 * §14 (unit scope is enforced in the service — it needs DB state), §37
 * (explicit field errors), §36 (effective_period: day-granular, inclusive).
 *
 * Identity is anchor-time: unitRef + nodeId select the (unit, node) pair;
 * updates may never re-anchor a mapping (remove + re-create instead, both
 * audited — §36 history discipline).
 */
import { z } from 'zod'

// ---------- §8 vocabulary ----------

export const MAPPING_RELEVANCE = ['DIRECT', 'PARTIAL', 'CONTEXTUAL'] as const
export const MAPPING_PRIORITIES = ['CORE', 'SUPPORTING', 'LOW'] as const
export const REQUIRED_DEPTHS = ['ONE_LINE', 'FACT', 'CONCEPT', 'DETAILED', 'ANALYTICAL'] as const
export const QUESTION_LIKELIHOOD = ['HIGH', 'MEDIUM', 'LOW'] as const

// ---------- Mapping CRUD ----------

/** Unit reference — canonical slug or internal id (console picker supplies it). */
const unitRef = z
  .string()
  .trim()
  .min(2, 'Pick a knowledge unit first')
  .max(170, 'Unit reference is too long')

/** §8 effective_period — day-granular, inclusive; null = whole version window. */
const effectiveFromField = z.coerce.date().nullable().optional()
const effectiveToField = z.coerce.date().nullable().optional()

function refineWindow(
  data: { effectiveFrom?: Date | null; effectiveTo?: Date | null },
  ctx: z.RefinementCtx
): void {
  const from = data.effectiveFrom instanceof Date ? data.effectiveFrom : null
  const to = data.effectiveTo instanceof Date ? data.effectiveTo : null
  if (from && to && to < from) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effectiveTo'],
      message: 'effectiveTo must not be before effectiveFrom',
    })
  }
}

export const createExamMappingSchema = z.object({
  /** §7 canonical record — slug or id (service resolves + country-guards, §14). */
  unitRef,
  /** The SyllabusNode anchor (§6/§13) — must belong to the same version. */
  nodeId: z.string().trim().min(5, 'Pick a syllabus node'),
  relevance: z.enum(MAPPING_RELEVANCE).default('DIRECT'),
  priority: z.enum(MAPPING_PRIORITIES).default('SUPPORTING'),
  requiredDepth: z.enum(REQUIRED_DEPTHS).default('CONCEPT'),
  questionLikelihood: z.enum(QUESTION_LIKELIHOOD).default('MEDIUM'),
  /** §8 "what portion/aspect is actually relevant". */
  expectedScope: z.string().trim().max(500, 'Expected scope must be at most 500 characters').optional().nullable(),
  /** §8 "why the mapping exists" — notification section, PYQ pattern, editor judgement. */
  sourceBasis: z.string().trim().max(500, 'Source basis must be at most 500 characters').optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  effectiveFrom: effectiveFromField,
  effectiveTo: effectiveToField,
}).superRefine(refineWindow)

export type CreateExamMappingInput = z.infer<typeof createExamMappingSchema>

/** Metadata edits only — anchors (unit/node) are immutable identity. */
export const updateExamMappingSchema = z.object({
  relevance: z.enum(MAPPING_RELEVANCE).optional(),
  priority: z.enum(MAPPING_PRIORITIES).optional(),
  requiredDepth: z.enum(REQUIRED_DEPTHS).optional(),
  questionLikelihood: z.enum(QUESTION_LIKELIHOOD).optional(),
  expectedScope: z.string().trim().max(500).nullable().optional(),
  sourceBasis: z.string().trim().max(500).nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  effectiveFrom: z.coerce.date().nullable().optional(),
  effectiveTo: z.coerce.date().nullable().optional(),
}).superRefine((data, ctx) => {
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

export type UpdateExamMappingInput = z.infer<typeof updateExamMappingSchema>

// ---------- Unit search (console picker) ----------

export const mappingUnitSearchSchema = z.object({
  q: z.string().trim().min(2, 'Type at least 2 characters to search units').max(200),
})

export type MappingUnitSearchQuery = z.infer<typeof mappingUnitSearchSchema>

// ---------- Public coverage read ----------

/** Mirrors the public syllabus read semantics (§36 historical query). */
export const publicCoverageQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  version: z.string().trim().min(5).optional(),
})

export type PublicCoverageQuery = z.infer<typeof publicCoverageQuerySchema>

// ---------- §11 combined queue (P3-S4) ----------

/** §11 step 1 input cap — a learner's realistic simultaneous exam set. */
export const MAX_COMBINED_EXAMS = 8

/** Exam reference — canonical slug or internal id (§37 stable identifiers). */
const examRef = z
  .string()
  .trim()
  .min(2, 'Exam reference is too short')
  .max(170, 'Exam reference is too long')

/** GET /api/exams/combined query — the explicit exam set (until P5-S1 wires
 * follows, the client passes the set; single-exam mode is one ref, §11). */
export const combinedQueueQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  exams: z
    .array(examRef)
    .min(1, 'Pick at least one exam to combine')
    .max(MAX_COMBINED_EXAMS, `Combine at most ${MAX_COMBINED_EXAMS} exams at once`),
})

export type CombinedQueueQuery = z.infer<typeof combinedQueueQuerySchema>

/**
 * Splits raw `?exams=` values (comma-separated and/or repeated parameters)
 * into unique refs, preserving first occurrence. Case-insensitive dedup —
 * slugs are stored lowercase and ids are lowercase cuids, so "UPSC-Civil-Services"
 * and "upsc-civil-services" are the same exam (§11 step 1 collects a set).
 */
export function parseCombinedExamRefs(values: string[]): string[] {
  const seen = new Set<string>()
  const refs: string[] = []
  for (const value of values) {
    for (const raw of value.split(',')) {
      const ref = raw.trim()
      if (ref.length === 0) continue
      const key = ref.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs
}
