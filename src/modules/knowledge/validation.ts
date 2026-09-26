/**
 * GlobIQ — Knowledge module: input validation
 * Master Plan §6 (fields), §11 (dedup by canonical identity), §14 (explicit
 * country scope), §23 (content types), §36 (immutable slug — URL-stable),
 * §37 (explicit validation errors).
 *
 * Slug/scope/type/topic are create-time decisions and immutable afterwards
 * (same migration-safe philosophy as taxonomy, §36).
 */
import { z } from 'zod'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const kuSlugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters')
  .max(96, 'Slug must be at most 96 characters')
  .regex(SLUG_PATTERN, 'Slug must be lowercase kebab-case (letters, digits, single hyphens)')

export const KNOWLEDGE_UNIT_TYPES = [
  'FACT',
  'CONCEPT',
  'TIMELINE',
  'PERSON_PROFILE',
  'PLACE_PROFILE',
  'ORGANISATION_PROFILE',
  'COMPARISON',
] as const

export const KNOWLEDGE_DIFFICULTIES = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const

export const KNOWLEDGE_SCOPES = ['GLOBAL', 'COUNTRY'] as const

export const KNOWLEDGE_TRANSITION_ACTIONS = [
  'submit_review',
  'send_back',
  'verify',
  'flag_outdated',
  'reverify',
  'archive',
] as const

function validityRefine(
  data: { validFrom?: unknown; validUntil?: unknown },
  ctx: z.RefinementCtx
): void {
  const from = data.validFrom instanceof Date ? data.validFrom : null
  const until = data.validUntil instanceof Date ? data.validUntil : null
  if (from && until && until < from) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['validUntil'],
      message: 'validUntil must not be before validFrom',
    })
  }
}

export const createKnowledgeUnitSchema = z
  .object({
    canonicalName: z
      .string()
      .trim()
      .min(3, 'Canonical name must be at least 3 characters')
      .max(160),
    slug: kuSlugSchema,
    canonicalSummary: z.string().trim().max(500).optional(),
    canonicalBody: z
      .string()
      .trim()
      .min(20, 'Canonical body must be at least 20 characters — a Knowledge Unit is the full semantic record (§7)')
      .max(20_000),
    type: z.enum(KNOWLEDGE_UNIT_TYPES),
    difficulty: z.enum(KNOWLEDGE_DIFFICULTIES).default('BASIC'),
    scope: z.enum(KNOWLEDGE_SCOPES).default('GLOBAL'),
    /** ISO code of the owning country — required when scope = COUNTRY (§14). */
    country: z.string().trim().min(2).max(2).optional(),
    /** Canonical taxonomy topic ref (slug or id, §13). */
    topic: z.string().trim().min(1, 'A canonical topic is required'),
    validFrom: z.coerce.date().optional(),
    validUntil: z.coerce.date().optional(),
    notes: z.string().trim().max(2000).optional(),
    orderIndex: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine(validityRefine)
  // GLOBAL units must not carry a country (role-independent invariant). The
  // COUNTRY+missing-country case is enforced in the service, where a country
  // admin's home country can be implied.
  .superRefine((data, ctx) => {
    if (data.scope === 'GLOBAL' && data.country) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['country'],
        message: 'Global units must not specify a country',
      })
    }
  })

export type CreateKnowledgeUnitInput = z.infer<typeof createKnowledgeUnitSchema>

export const updateKnowledgeUnitSchema = z
  .object({
    canonicalName: z.string().trim().min(3).max(160).optional(),
    canonicalSummary: z.string().trim().max(500).nullable().optional(),
    canonicalBody: z.string().trim().min(20).max(20_000).optional(),
    difficulty: z.enum(KNOWLEDGE_DIFFICULTIES).optional(),
    validFrom: z.coerce.date().nullable().optional(),
    validUntil: z.coerce.date().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    orderIndex: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine(validityRefine)

export type UpdateKnowledgeUnitInput = z.infer<typeof updateKnowledgeUnitSchema>

export const knowledgeTransitionSchema = z.object({
  action: z.enum(KNOWLEDGE_TRANSITION_ACTIONS),
  /** Required for flag_outdated (§25/§36 correction provenance), optional elsewhere. */
  reason: z.string().trim().max(1000).optional(),
})

export type KnowledgeTransitionInput = z.infer<typeof knowledgeTransitionSchema>

/** Public list: topic-scoped browse (§5 hierarchy Topic → KnowledgeUnit). */
export const publicKnowledgeListQuerySchema = z.object({
  topic: z.string().trim().min(1, 'A topic is required'),
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  type: z.enum(KNOWLEDGE_UNIT_TYPES).optional(),
  difficulty: z.enum(KNOWLEDGE_DIFFICULTIES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

export type PublicKnowledgeListQuery = z.infer<typeof publicKnowledgeListQuerySchema>

export const adminKnowledgeListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'IN_REVIEW', 'VERIFIED', 'OUTDATED', 'ARCHIVED']).optional(),
  topic: z.string().trim().min(1).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminKnowledgeListQuery = z.infer<typeof adminKnowledgeListQuerySchema>
