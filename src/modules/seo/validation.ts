/**
 * GlobIQ — SEO module: read query schemas (P4-S2)
 * Master Plan §37 (validate at the boundary), §14/§35 (country/language are
 * optional routing hints — the server resolves and scopes), §16 (object
 * identity by immutable slug).
 */
import { z } from 'zod'

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const CUID_PATTERN = /^c[a-z0-9]{20,}$/
export const REF_PATTERN = new RegExp(`${SLUG_PATTERN.source.slice(1, -1)}|${CUID_PATTERN.source}`)

/** GET /api/home query — ?country=&language= */
export const homepageQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export type HomepageQuery = z.infer<typeof homepageQuerySchema>

/** Topic reference: immutable kebab-case slug or canonical id. */
export const topicRefSchema = z
  .string()
  .trim()
  .min(2, 'A topic reference is required')
  .max(64, 'Topic reference is too long')
  .regex(REF_PATTERN, 'Topic reference must be a lowercase kebab-case slug')

/** GET /api/topics/{slug} query — ?country=&language=&page=&pageSize= */
export const topicLandingQuerySchema = z.object({
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
})

export type TopicLandingQuery = z.infer<typeof topicLandingQuerySchema>
