/**
 * GlobIQ — Taxonomy module: input validation
 * Master Plan §13 (node fields), §37 (explicit validation errors).
 *
 * Slugs are immutable and URL-stable (§16/§36) — they are validated strictly
 * here and can never be changed after creation. Scope/type are likewise
 * create-time decisions (structural reclassification = new node, §36).
 */
import { z } from 'zod'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const topicSlugSchema = z
  .string()
  .trim()
  .min(2, 'Slug must be at least 2 characters')
  .max(64, 'Slug must be at most 64 characters')
  .regex(SLUG_PATTERN, 'Slug must be lowercase kebab-case (letters, digits, single hyphens)')

export const TOPIC_TYPES = ['DOMAIN', 'BRANCH', 'TOPIC'] as const
export const TOPIC_SCOPES = ['GLOBAL', 'COUNTRY'] as const

export const topicLabelInputSchema = z.object({
  language: z.string().trim().min(2).max(8).toLowerCase(),
  name: z.string().trim().min(1, 'Label name is required').max(160),
  description: z.string().trim().max(2000).optional(),
})

export const topicAliasInputSchema = z.object({
  value: z.string().trim().min(1, 'Alias value is required').max(120),
  language: z.string().trim().min(2).max(8).toLowerCase().optional(),
})

export const createTopicSchema = z
  .object({
    canonicalName: z.string().trim().min(2, 'Canonical name must be at least 2 characters').max(120),
    slug: topicSlugSchema,
    description: z.string().trim().max(2000).optional(),
    type: z.enum(TOPIC_TYPES),
    scope: z.enum(TOPIC_SCOPES).default('GLOBAL'),
    /** ISO code (or slug) of the owning country — required when scope = COUNTRY (§14 explicit scope). */
    country: z.string().trim().min(2).max(2).optional(),
    /** Parent reference (slug). Omitted ⇒ root domain node. */
    parent: z.string().trim().min(1).max(64).optional(),
    orderIndex: z.number().int().min(0).max(9999).optional(),
  })
  .superRefine((data, ctx) => {
    // GLOBAL nodes must not carry a country (role-independent invariant). The
    // COUNTRY+missing-country case is enforced in the service, where the actor
    // context allows a country admin's home country to be implied.
    if (data.scope === 'GLOBAL' && data.country) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['country'],
        message: 'Global nodes must not specify a country',
      })
    }
  })

export type CreateTopicInput = z.infer<typeof createTopicSchema>

export const updateTopicSchema = z
  .object({
    canonicalName: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    orderIndex: z.number().int().min(0).max(9999).optional(),
    /** ACTIVE ↔ INACTIVE only. Retirement is DELETE (explicit intent); slug/scope/type are immutable. */
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
    /** Move the node under a new parent (slug). Domains are fixed roots — root moves are not possible. */
    parent: z.string().trim().min(1).max(64).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Provide at least one field to update',
  })

export type UpdateTopicInput = z.infer<typeof updateTopicSchema>

export const setTopicLabelsSchema = z.object({
  labels: z.array(topicLabelInputSchema).max(20, 'At most 20 labels per node'),
})

export type SetTopicLabelsInput = z.infer<typeof setTopicLabelsSchema>

export const setTopicAliasesSchema = z.object({
  aliases: z.array(topicAliasInputSchema).max(20, 'At most 20 aliases per node'),
})

export type SetTopicAliasesInput = z.infer<typeof setTopicAliasesSchema>

// ---------- Read query schemas ----------

export const topicTreeQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export const topicSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query is required').max(100),
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
})
