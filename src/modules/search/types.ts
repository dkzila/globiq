/**
 * GlobIQ — Search module: public contract types (P4-S1)
 * Master Plan §17 (Search Strategy), §29 (vendor-neutral abstraction), §16
 * (canonical URLs from identity — never concatenated), §37 (client-agnostic
 * DTOs, deterministic ordering, explicit errors).
 */

/** §6/§16 public surfaces that exist to be searched today. */
export type SearchObjectTypePublic = 'KNOWLEDGE_UNIT' | 'EXAM' | 'TOPIC'

/** User-facing type filter (§37 — stable query vocabulary). */
export type SearchTypeFilter = 'all' | 'units' | 'exams' | 'topics'

/**
 * §17 matched-by vocabulary — how a result matched the query. One value per
 * result (the strongest tier); `matchReasons` carries the full explanation.
 */
export type SearchMatchedVia =
  | 'exact_title'
  | 'exact_alias'
  | 'title_prefix'
  | 'alias_prefix'
  | 'title_contains'
  | 'full_text'
  | 'fuzzy'
  | 'neutral_full_text'
  | 'neutral_prefix'
  | 'neutral_fuzzy'

/**
 * §7/§35 presentation mode: `reader_language` = the document in the reader's
 * resolved language matched with its full localised text; `canonical_fallback`
 * = no published surface exists in the reader's language — the object matched
 * through its language-neutral canonical name/aliases and is presented from
 * the canonical record (the §22 page's canonical-summary behaviour).
 */
export type SearchPresentedFrom = 'reader_language' | 'canonical_fallback'

/** §37 validated query (see validation.ts). */
export interface SearchQueryInput {
  q: string
  country?: string
  language?: string
  type: SearchTypeFilter
  exam?: string
  page: number
  pageSize: number
}

/** An exam whose CURRENT §36 version requires a unit (§8/§17 explanation). */
export interface SearchResultExamRef {
  slug: string
  name: string
  code: string
}

/** One search result — a canonical object presented once (§17 dedup rule). */
export interface SearchResultItem {
  objectType: SearchObjectTypePublic
  /** Public slug — the §37 stable identifier clients use for deep reads. */
  ref: string
  title: string
  summary: string | null
  /** Language of the matched document. */
  languageCode: string
  presentedFrom: SearchPresentedFrom
  /** §16 canonical path in the READER'S resolved language (never concatenated). */
  urlPath: string
  topicSlug: string | null
  topicLabel: string | null
  unitType: string | null
  difficulty: string | null
  /** Reader-country exams whose current syllabus includes this unit (§14 —
   * never other countries' exams, §17 exam-aware explanation). */
  exams: SearchResultExamRef[]
  matchedVia: SearchMatchedVia
  /** §17 "explain why an item is relevant" — human-readable reasons. */
  matchReasons: string[]
  /** Dev-facing ranking transparency (the foundation page surfaces it). */
  score: number
}

export interface SearchPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

/** Index health echoed on every search response (§29 engine identity). */
export interface SearchIndexMeta {
  engine: string
  documents: number
  lastIndexedAt: string | null
  tookMs: number
}

export interface SearchResponse {
  query: {
    q: string
    country: { isoCode: string; name: string }
    language: { code: string; name: string; nativeName: string | null }
    type: SearchTypeFilter
    /** The active §8 exam filter (§14: validated inside the reader's country). */
    exam: SearchResultExamRef | null
  }
  results: SearchResultItem[]
  pagination: SearchPagination
  index: SearchIndexMeta
}

/** Admin index statistics (§38 admin console; GET /api/search/admin). */
export interface SearchAdminStats {
  engine: string
  documents: number
  byType: Array<{ objectType: SearchObjectTypePublic; count: number }>
  byLanguage: Array<{ languageCode: string; count: number }>
  lastIndexedAt: string | null
  /** Live FTS config resolution (§17 language-aware tokenisation). */
  ftsConfigs: Array<{ languageCode: string; config: string }>
}

/** Reindex result (POST /api/search/admin/reindex — ADMIN only, audited). */
export interface SearchReindexResult {
  unitsIndexed: number
  topicsIndexed: number
  examsIndexed: number
  documentsWritten: number
  documentsRemoved: number
  tookMs: number
}
