/**
 * GlobIQ — Knowledge module: Source input validation (P2-S3)
 * Master Plan §24 (provenance fields: publisher, URL, publication date,
 * retrieved/verified date, category; claim/content-level attribution), §37
 * (explicit validation errors), §30 (URL sanity — http(s) only).
 *
 * The URL is the source's canonical identity: it is normalized (lowercase
 * host, fragment dropped, single trailing slash stripped) before the unique
 * constraint applies, so the same evidence never registers twice.
 */
import { z } from 'zod'

import type { SourceTypePublic, SourceVerificationPublic } from './source-types'
import { SOURCE_TYPES, SOURCE_VERIFICATIONS } from './source-types'

/**
 * Normalizes an http(s) URL for identity/dedup: lowercase protocol+host,
 * drop the fragment, strip one trailing slash on non-root paths. Returns
 * null when the value is not a usable http(s) URL.
 */
export function normalizeSourceUrl(raw: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname.includes('.')) return null // reject "http://localhost"-style hosts
  parsed.hash = ''
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1)
  }
  return parsed.toString()
}

/** Accepts YYYY-MM-DD or full ISO-8601; refined to a Date in the service. */
const dateLike = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: 'Enter a valid date (YYYY-MM-DD or ISO)',
  })

export const createSourceSchema = z.object({
  title: z.string().trim().min(3, 'Title must be at least 3 characters').max(300),
  publisher: z.string().trim().min(2, 'Publisher must be at least 2 characters').max(200),
  url: z
    .string()
    .trim()
    .min(8, 'A source URL is required')
    .max(2000)
    .refine((value) => normalizeSourceUrl(value) !== null, {
      message: 'Enter a valid http(s) URL',
    }),
  type: z.enum(SOURCE_TYPES),
  /** When the underlying material was published (§24) — optional (undated data sources exist). */
  publishedAt: dateLike.optional(),
  /** When GlobIQ editors retrieved it (§24) — defaults to now in the service. */
  retrievedAt: dateLike.optional(),
  notes: z.string().trim().max(2000).optional(),
})

export type CreateSourceInput = z.infer<typeof createSourceSchema>

/** Metadata edits (§36: corrections are edits, never deletes). URL and type are
 * part of the record's identity-facing metadata and stay patchable so factual
 * corrections remain possible — every edit is audited. */
export const updateSourceSchema = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  publisher: z.string().trim().min(2).max(200).optional(),
  url: z
    .string()
    .trim()
    .min(8)
    .max(2000)
    .refine((value) => normalizeSourceUrl(value) !== null, {
      message: 'Enter a valid http(s) URL',
    })
    .optional(),
  type: z.enum(SOURCE_TYPES).optional(),
  publishedAt: dateLike.nullable().optional(),
  retrievedAt: dateLike.optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
})

export type UpdateSourceInput = z.infer<typeof updateSourceSchema>

export const sourceVerificationSchema = z.object({
  action: z.enum(['verify', 'reject', 'recheck']),
})

export type SourceVerificationInput = z.infer<typeof sourceVerificationSchema>

export const adminSourceListQuerySchema = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  type: z.enum(SOURCE_TYPES).optional(),
  verification: z.enum(SOURCE_VERIFICATIONS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminSourceListQuery = z.infer<typeof adminSourceListQuerySchema>

/** §24 claim/content-level attribution on the link. */
export const linkSourceSchema = z.object({
  source: z.string().trim().min(1, 'Pick a source to cite'),
  claim: z.string().trim().min(3, 'A claim needs at least 3 characters').max(500).optional(),
})

export type LinkSourceInput = z.infer<typeof linkSourceSchema>

export const updateSourceLinkSchema = z.object({
  claim: z.string().trim().min(3).max(500).nullable().optional(),
})

export type UpdateSourceLinkInput = z.infer<typeof updateSourceLinkSchema>

/** Re-exported for route handlers that validate query enums. */
export const SOURCE_TYPE_ENUMS = SOURCE_TYPES as [SourceTypePublic, ...SourceTypePublic[]]
export const SOURCE_VERIFICATION_ENUMS = SOURCE_VERIFICATIONS as [
  SourceVerificationPublic,
  ...SourceVerificationPublic[],
]
