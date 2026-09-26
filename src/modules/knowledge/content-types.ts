/**
 * GlobIQ — Knowledge module: ContentItem + revision DTOs (P2-S2)
 * Master Plan §6 (ContentItem row: knowledge_unit_id, language, format, title,
 * body, status), §7 (representation of a canonical record — never re-entered
 * facts), §19 (published content immutable at the revision level), §22
 * (knowledge-page rendering layers), §23 (representation formats), §35
 * (language exposure is per-country), §36 (revisions preserve previous
 * versions; corrections are never silent edits), §37 (client-agnostic DTOs).
 */

/** §23 representation formats (HOW the canonical record renders). */
export type ContentFormatPublic =
  | 'FACT_CARD'
  | 'EXPLAINER'
  | 'REVISION_NOTE'
  | 'CURRENT_EVENT_UPDATE'
  | 'TIMELINE'
  | 'PROFILE'
  | 'COMPARISON'

export type ContentStatusPublic = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'RETIRED'

/**
 * Lifecycle transitions (§19 workflow, minimal until the editorial workspace
 * lands in P2-S4 — SCHEDULED joins there). `publish` from PUBLISHED is the
 * correction path: it appends a new immutable revision (§36) — the status
 * stays PUBLISHED and the live pointer moves.
 */
export type ContentTransitionAction =
  | 'submit_review' // DRAFT → IN_REVIEW
  | 'send_back' // IN_REVIEW → DRAFT
  | 'publish' // IN_REVIEW → PUBLISHED (first publish) · PUBLISHED → PUBLISHED (new revision)
  | 'retire' // any live status → RETIRED (withdraw/archive, §19 step 10)

/** State machine map — single source for service + UI rendering. */
export const CONTENT_TRANSITIONS: Record<
  ContentStatusPublic,
  Partial<Record<ContentTransitionAction, ContentStatusPublic>>
> = {
  DRAFT: { submit_review: 'IN_REVIEW', retire: 'RETIRED' },
  IN_REVIEW: { publish: 'PUBLISHED', send_back: 'DRAFT', retire: 'RETIRED' },
  // Re-publish = correction: new revision, same status (§36).
  PUBLISHED: { publish: 'PUBLISHED', retire: 'RETIRED' },
  RETIRED: {}, // end-of-life: read-only (like ARCHIVED units, §36)
}

/**
 * Working-copy editability per status. RETIRED is read-only. Every live
 * status may edit the working copy — for PUBLISHED items those edits are
 * STAGED: public reads always serve the live revision snapshot until a new
 * revision is published (§19 "immutable at the revision level").
 */
export const CONTENT_EDITABILITY: Record<ContentStatusPublic, 'full' | 'none'> = {
  DRAFT: 'full',
  IN_REVIEW: 'full',
  PUBLISHED: 'full', // staging edits — invisible publicly until re-published
  RETIRED: 'none',
}

/** Immutable published snapshot (§36). */
export interface ContentRevisionRef {
  id: string
  revisionNumber: number
  title: string
  body: string
  changeSummary: string | null
  publishedAt: string
  publishedBy: string | null // publisher email snapshot
}

/** Public list row — content ALWAYS from the live revision, never the working copy. */
export interface PublicContentItemSummary {
  id: string
  format: ContentFormatPublic
  language: { code: string; name: string; nativeName: string | null }
  title: string
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  updatedAt: string
}

/** GET /api/content/items/{id} payload. */
export interface PublicContentItemDetail extends PublicContentItemSummary {
  body: string
  revisionCount: number
  /** The canonical record this item represents (§7 — the link is mandatory). */
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
  }
}

export interface PublicContentListResult {
  /** The canonical unit whose representations these are. */
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
  }
  items: PublicContentItemSummary[]
  /** Language codes with at least one published representation of this unit. */
  languagesAvailable: string[]
}

/** Admin row — working copy + live revision + server-computed affordances. */
export interface AdminContentItem {
  id: string
  status: ContentStatusPublic
  format: ContentFormatPublic
  language: { code: string; name: string; nativeName: string | null }
  title: string // working copy (editorial staging)
  body: string // working copy
  unit: {
    id: string
    slug: string
    canonicalName: string
    status: string // KnowledgeStatus — publishing requires VERIFIED
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
    topicSlug: string | null
  }
  liveRevision: ContentRevisionRef | null
  revisionCount: number
  createdAt: string
  updatedAt: string
  /** Per-item affordances from server truth (§20/§37) — server re-checks. */
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: ContentTransitionAction[]
  /** Whether the owning unit is VERIFIED — the publish precondition. */
  unitVerified: boolean
}

export interface ContentPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminContentListResult {
  items: AdminContentItem[]
  pagination: ContentPagination
}

/** Admin revision history (§36 — the preserved versions, newest first). */
export interface AdminContentRevisionListResult {
  itemId: string
  unit: { slug: string; canonicalName: string }
  language: { code: string; name: string }
  format: ContentFormatPublic
  revisions: ContentRevisionRef[]
}
