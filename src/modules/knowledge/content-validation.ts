/**
 * GlobIQ — Knowledge module: ContentItem input validation (P2-S2)
 * Master Plan §23 ("each type has its own schema and validation rules — avoid
 * a single unstructured blob"), §35 (language is a code, validated against
 * the country-locale module in the service), §36 (changeSummary provenance on
 * corrections), §37 (explicit validation errors).
 *
 * Identity fields (unit, language, format) are create-time decisions and
 * immutable afterwards — the same migration-safe philosophy as the KU slug
 * (§36). Only title/body (the working copy) are patchable.
 */
import { z } from 'zod'

import type { ContentFormatPublic } from './content-types'

export const CONTENT_FORMATS = [
  'FACT_CARD',
  'EXPLAINER',
  'REVISION_NOTE',
  'CURRENT_EVENT_UPDATE',
  'TIMELINE',
  'PROFILE',
  'COMPARISON',
] as const

export const CONTENT_TRANSITION_ACTIONS = [
  'submit_review',
  'send_back',
  'publish',
  'retire',
] as const

/**
 * §23 per-format body rules — each representation format has its own shape.
 * These bounds are the format's "own schema": a fact card is deliberately
 * short (the §22 quick-fact layer), an explainer demands article depth, a
 * timeline is line-oriented.
 */
export const FORMAT_BODY_RULES: Record<
  ContentFormatPublic,
  { min: number; max: number; hint: string }
> = {
  FACT_CARD: {
    min: 20,
    max: 1500,
    hint: 'A fact card is one crisp paragraph — the quick-fact layer (§22)',
  },
  EXPLAINER: {
    min: 300,
    max: 50_000,
    hint: 'An explainer is a full article (at least 300 characters)',
  },
  REVISION_NOTE: {
    min: 60,
    max: 10_000,
    hint: 'Revision notes are compact, structured takeaways',
  },
  CURRENT_EVENT_UPDATE: {
    min: 120,
    max: 20_000,
    hint: 'A source-backed update summarising what changed (Source links land in P2-S3)',
  },
  TIMELINE: {
    min: 100,
    max: 30_000,
    hint: 'Timeline entries — one event per line: “date — event”',
  },
  PROFILE: {
    min: 120,
    max: 30_000,
    hint: 'A structured profile of the person/place/organisation',
  },
  COMPARISON: {
    min: 120,
    max: 30_000,
    hint: 'A side-by-side comparison with the distinguishing axes',
  },
}

/** Shared body check — used by create (schema) and update/publish (service,
 * where the format comes from the stored item, not the patch). */
export function bodyFitsFormat(
  format: ContentFormatPublic,
  body: string
): { ok: true } | { ok: false; message: string } {
  const rules = FORMAT_BODY_RULES[format]
  const length = body.trim().length
  if (length < rules.min || length > rules.max) {
    return {
      ok: false,
      message: `${format} body must be ${rules.min}–${rules.max} characters (got ${length}) — ${rules.hint}`,
    }
  }
  return { ok: true }
}

export const createContentItemSchema = z
  .object({
    /** KnowledgeUnit ref (slug or id) — the canonical record being represented (§7). */
    unit: z.string().trim().min(1, 'A knowledge unit is required'),
    /** Language code (validated against country-locale in the service, §35). */
    language: z.string().trim().min(2).max(8),
    format: z.enum(CONTENT_FORMATS),
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(200),
    body: z.string().trim().min(1, 'Body is required'),
    /** §24/§26 AI-provenance flag — marks AI-assisted drafting; snapshotted
     * onto the published revision (§26 review gate = the workflow itself). */
    aiAssisted: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    const check = bodyFitsFormat(data.format, data.body)
    if (!check.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: check.message })
    }
  })

export type CreateContentItemInput = z.infer<typeof createContentItemSchema>

export const updateContentItemSchema = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  body: z.string().trim().min(1).optional(),
  aiAssisted: z.boolean().optional(),
  // Format rules are re-checked in the service against the item's IMMUTABLE
  // format — the patch alone doesn't know which format it belongs to.
})

export type UpdateContentItemInput = z.infer<typeof updateContentItemSchema>

export const contentTransitionSchema = z.object({
  action: z.enum(CONTENT_TRANSITION_ACTIONS),
  /**
   * Why this revision exists (§25/§36 provenance). Required by the service on
   * re-publish (correction cycle); optional on first publish.
   */
  changeSummary: z.string().trim().max(500).optional(),
})

export type ContentTransitionInput = z.infer<typeof contentTransitionSchema>

/** Public list: representations of one unit, country/language-scoped (§14/§15/§35). */
export const publicContentListQuerySchema = z.object({
  unit: z.string().trim().min(1, 'A knowledge unit is required'),
  country: z.string().trim().min(2).max(8).optional(),
  language: z.string().trim().min(2).max(8).optional(),
})

export type PublicContentListQuery = z.infer<typeof publicContentListQuerySchema>

export const adminContentListQuerySchema = z.object({
  unit: z.string().trim().min(1).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED']).optional(),
  language: z.string().trim().min(2).max(8).optional(),
  format: z.enum(CONTENT_FORMATS).optional(),
  q: z.string().trim().min(1).max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export type AdminContentListQuery = z.infer<typeof adminContentListQuerySchema>
