/**
 * GlobIQ — Search module: input validation (P4-S1)
 * Master Plan §17 (search strategy), §37 (explicit validation errors,
 * pagination), §14/§15 (country/language context resolution delegated to the
 * country-locale module — the same parameters every public read accepts).
 */
import { z } from 'zod'

export const SEARCH_TYPE_FILTERS = ['all', 'units', 'exams', 'topics'] as const

export const searchQuerySchema = z.object({
  /** §17: the query text — exact/prefix/alias/typo-tolerant/full-text. */
  q: z.string().trim().min(1, 'Enter something to search for').max(200, 'Query is too long (200 characters max)'),
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  type: z.enum(SEARCH_TYPE_FILTERS).default('all'),
  /** §8 exam filter: restrict results to units in this exam's current syllabus
   * (§14 — validated inside the reader's country by the query service). */
  exam: z.string().trim().min(2).max(96).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
})

export type SearchQuery = z.infer<typeof searchQuerySchema>
