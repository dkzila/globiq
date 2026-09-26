/**
 * GlobIQ — Knowledge module: public DTOs
 * Master Plan §6 (KnowledgeUnit row), §7 (canonical semantic record),
 * §11 (dedup by canonical identity), §14/§15 (explicit country scope,
 * server-side enforcement), §22 (knowledge page: quick fact + deeper
 * explanation), §23 (content types), §36 (no silent edits), §37 (API DTOs).
 */

export type KnowledgeUnitTypePublic =
  | 'FACT'
  | 'CONCEPT'
  | 'TIMELINE'
  | 'PERSON_PROFILE'
  | 'PLACE_PROFILE'
  | 'ORGANISATION_PROFILE'
  | 'COMPARISON'

export type KnowledgeStatusPublic = 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'

export type KnowledgeDifficultyPublic = 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'

export type KnowledgeScopePublic = 'GLOBAL' | 'COUNTRY'

/** Lifecycle transition actions (§36; full editorial workflow lands P2-S4). */
export type KnowledgeTransitionAction =
  | 'submit_review' // DRAFT → IN_REVIEW
  | 'send_back' // IN_REVIEW → DRAFT
  | 'verify' // IN_REVIEW → VERIFIED (publicly visible from here)
  | 'flag_outdated' // VERIFIED → OUTDATED (correction cycle — reason required)
  | 'reverify' // OUTDATED → VERIFIED (after correction)
  | 'archive' // DRAFT/IN_REVIEW/VERIFIED/OUTDATED → ARCHIVED (end-of-life)

/** Which fields the current status allows to change (§36 no silent edits). */
export type KnowledgeEditability = 'full' | 'metadata' | 'none'

export interface KnowledgeValidity {
  from: string | null
  until: string | null
  /** True when the validity window (if any) covers now. */
  currentlyValid: boolean
}

/** Topic reference embedded in public payloads (resolved via taxonomy §13). */
export interface KnowledgeTopicRef {
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
}

/** List row — summary only; the body loads on detail (§22 quick fact first). */
export interface PublicKnowledgeUnitSummary {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: KnowledgeUnitTypePublic
  difficulty: KnowledgeDifficultyPublic
  scope: KnowledgeScopePublic
  countryIso: string | null
  orderIndex: number
  validity: KnowledgeValidity
  updatedAt: string
}

/** GET /api/knowledge/units/{slug} payload. */
export interface PublicKnowledgeUnitDetail extends PublicKnowledgeUnitSummary {
  canonicalBody: string
  createdAt: string
  topic: {
    slug: string
    canonicalName: string
    label: string
    labelLanguage: string
    path: Array<{ slug: string; canonicalName: string; label: string }>
  }
}

export interface KnowledgePagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface PublicKnowledgeListResult {
  units: PublicKnowledgeUnitSummary[]
  pagination: KnowledgePagination
  /** The topic the list hangs off (already country/language-resolved, §13). */
  topic: KnowledgeTopicRef & { path: Array<{ slug: string; canonicalName: string; label: string }> }
}

/** Admin row — all statuses; full canonical fields. */
export interface AdminKnowledgeUnit {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  canonicalBody: string
  type: KnowledgeUnitTypePublic
  status: KnowledgeStatusPublic
  difficulty: KnowledgeDifficultyPublic
  scope: KnowledgeScopePublic
  countryIso: string | null
  topic: { id: string; slug: string; canonicalName: string; status: string }
  validity: KnowledgeValidity
  notes: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
  /** Per-unit affordances from server truth (§20/§37) — server re-checks. */
  canEdit: boolean
  editability: KnowledgeEditability
  allowedTransitions: KnowledgeTransitionAction[]
}

export interface AdminKnowledgeListResult {
  units: AdminKnowledgeUnit[]
  pagination: KnowledgePagination
}

/** State machine map — single source for service + UI rendering. */
export const KNOWLEDGE_TRANSITIONS: Record<
  KnowledgeStatusPublic,
  Partial<Record<KnowledgeTransitionAction, KnowledgeStatusPublic>>
> = {
  DRAFT: { submit_review: 'IN_REVIEW', archive: 'ARCHIVED' },
  IN_REVIEW: { verify: 'VERIFIED', send_back: 'DRAFT', archive: 'ARCHIVED' },
  VERIFIED: { flag_outdated: 'OUTDATED', archive: 'ARCHIVED' },
  OUTDATED: { reverify: 'VERIFIED', archive: 'ARCHIVED' },
  ARCHIVED: {}, // end-of-life: read-only (§36, like RETIRED taxonomy nodes)
}

/** Field editability per status (§36: VERIFIED body is locked — corrections
 * go through flag_outdated → edit → reverify; audit diff is the history
 * until content revisions land in P2-S2). */
export const KNOWLEDGE_EDITABILITY: Record<KnowledgeStatusPublic, KnowledgeEditability> = {
  DRAFT: 'full',
  IN_REVIEW: 'full',
  OUTDATED: 'full',
  VERIFIED: 'metadata', // difficulty, validity window, notes, orderIndex only
  ARCHIVED: 'none',
}
