/**
 * GlobIQ — Knowledge module: Source & provenance DTOs (P2-S3)
 * Master Plan §6 (Source row: id, publisher, URL, publication date, source
 * type), §24 (Source and Trust Model — publisher/name, URL, publication date,
 * retrieved/verified date, source category, editor verification state,
 * claim-level or content-level attribution), §26 (AI-assisted fields carry
 * provenance/status), §36 (no hard deletes — migration-safe), §37
 * (client-agnostic DTOs).
 */

/** §24 "source category" — what kind of evidence the record points at. */
export type SourceTypePublic =
  | 'OFFICIAL'
  | 'NEWS_MEDIA'
  | 'INSTITUTIONAL'
  | 'ACADEMIC'
  | 'DATA'
  | 'OTHER'

export const SOURCE_TYPES: SourceTypePublic[] = [
  'OFFICIAL',
  'NEWS_MEDIA',
  'INSTITUTIONAL',
  'ACADEMIC',
  'DATA',
  'OTHER',
]

/** §24 "Editor verification state". */
export type SourceVerificationPublic = 'UNVERIFIED' | 'VERIFIED' | 'UNRELIABLE'

export const SOURCE_VERIFICATIONS: SourceVerificationPublic[] = [
  'UNVERIFIED',
  'VERIFIED',
  'UNRELIABLE',
]

/** Verification workflow actions (§24 trust decision). */
export type SourceVerificationAction = 'verify' | 'reject' | 'recheck'

/**
 * Verification state machine — single source for service + UI, mirroring the
 * shared-state-machine pattern of KNOWLEDGE_TRANSITIONS / CONTENT_TRANSITIONS.
 *
 * - verify: an editor confirmed the evidence (UNVERIFIED → VERIFIED, sets verifiedAt)
 * - reject: trust revoked (→ UNRELIABLE — e.g. the source retracted or was
 *   found unreliable; links stay as preserved provenance history, §36)
 * - recheck: back under assessment (VERIFIED/UNRELIABLE → UNVERIFIED, clears
 *   verifiedAt — the OUTDATED-like "flagged for correction" cycle)
 */
export const SOURCE_VERIFICATION_TRANSITIONS: Record<
  SourceVerificationPublic,
  Partial<Record<SourceVerificationAction, SourceVerificationPublic>>
> = {
  UNVERIFIED: { verify: 'VERIFIED', reject: 'UNRELIABLE' },
  VERIFIED: { reject: 'UNRELIABLE', recheck: 'UNVERIFIED' },
  UNRELIABLE: { recheck: 'UNVERIFIED' },
}

/** Public provenance entry on a content object (§24 — what readers see). */
export interface PublicSourceRef {
  id: string
  title: string
  publisher: string
  url: string
  type: SourceTypePublic
  verification: SourceVerificationPublic
  /** When the underlying material was published (null = undated source). */
  publishedAt: string | null
  /** When GlobIQ editors retrieved it (§24 retrieved/verified date). */
  retrievedAt: string
  /** When an editor verified it (null = not currently verified). */
  verifiedAt: string | null
  /** Claim-level attribution (§24); null = content-level (backs the whole item). */
  claim: string | null
}

/** Admin registry row — evidence record + server-computed affordances (§37). */
export interface AdminSource {
  id: string
  title: string
  publisher: string
  url: string
  type: SourceTypePublic
  verification: SourceVerificationPublic
  publishedAt: string | null
  retrievedAt: string
  verifiedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  /** How many content items currently cite this source. */
  usageCount: number
  /** Verification affordances from server truth (§20) — filtered per state. */
  allowedTransitions: SourceVerificationAction[]
}

export interface SourcePagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AdminSourceListResult {
  sources: AdminSource[]
  pagination: SourcePagination
  /** Counts across the whole registry — powers the §24 trust overview. */
  summary: Record<SourceVerificationPublic, number>
}

/** Where a source is cited (admin detail). */
export interface AdminSourceUsage {
  itemId: string
  itemTitle: string
  format: string
  languageCode: string
  itemStatus: string
  unitSlug: string
  unitName: string
  claim: string | null
}

export interface AdminSourceDetail extends AdminSource {
  usage: AdminSourceUsage[]
}

/** Admin view of one link on a content item. */
export interface AdminContentSourceLink {
  id: string
  claim: string | null
  linkedAt: string
  source: {
    id: string
    title: string
    publisher: string
    url: string
    type: SourceTypePublic
    verification: SourceVerificationPublic
    publishedAt: string | null
    retrievedAt: string
    verifiedAt: string | null
  }
}

export interface AdminContentSourceListResult {
  itemId: string
  unit: { slug: string; canonicalName: string }
  format: string
  language: { code: string; name: string }
  links: AdminContentSourceLink[]
}
