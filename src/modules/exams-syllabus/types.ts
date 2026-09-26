/**
 * GlobIQ — Exams & Syllabus module: public DTOs (P3-S1)
 * Master Plan §6 (Exam/ExamVersion rows), §8 (the requirement layer — mappings
 * arrive P3-S3), §11 (engine resolves each exam to its active ExamVersion),
 * §14 (every exam belongs to exactly one country), §16 (canonical exam URLs),
 * §36 (versioned syllabus — changes create a NEW ExamVersion), §37
 * (client-agnostic shapes), §38 (editorial exam operations).
 */

export type ExamStatusPublic = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
export type ExamLevelPublic = 'NATIONAL' | 'STATE' | 'REGIONAL'

export type ExamTransitionAction =
  | 'activate'
  | 'deactivate'
  | 'reactivate'
  | 'retire'

/** Which fields remain editable per lifecycle state (§36 — RETIRED locks all). */
export type ExamEditability = 'full' | 'metadata' | 'none'

/**
 * Exam lifecycle state machine. Exams are configuration, not content — they do
 * not ride the §19 review workflow. A DRAFT exam is being provisioned; ACTIVE
 * lists it publicly; INACTIVE hides it temporarily; RETIRED is end-of-life
 * (reason required — §36 provenance). There is deliberately NO delete: history
 * is preserved (§36 migration-safe philosophy).
 */
export const EXAM_TRANSITIONS: Record<ExamStatusPublic, Partial<Record<ExamTransitionAction, ExamStatusPublic>>> = {
  DRAFT: { activate: 'ACTIVE' },
  ACTIVE: { deactivate: 'INACTIVE', retire: 'RETIRED' },
  INACTIVE: { reactivate: 'ACTIVE', retire: 'RETIRED' },
  RETIRED: {},
}

/** Editability per status: RETIRED is fully read-only (§36). */
export const EXAM_EDITABILITY: Record<ExamStatusPublic, ExamEditability> = {
  DRAFT: 'full',
  ACTIVE: 'metadata',
  INACTIVE: 'metadata',
  RETIRED: 'none',
}

/** Transitions that require an explicit reason (audit provenance — §36). */
export const REASON_REQUIRED_TRANSITIONS: ReadonlySet<ExamTransitionAction> = new Set(['retire'])

/** A version as exposed on public/admin exam payloads. */
export interface ExamVersionRef {
  id: string
  label: string
  effectiveFrom: string // ISO date — inclusive first day
  effectiveTo: string | null // inclusive last day; null = in effect until superseded
  source: string | null
  notes: string | null
  /** True when this version's window contains now (§11 engine's "active ExamVersion"). */
  isCurrent: boolean
  /** True when effectiveFrom is still in the future (not yet in effect). */
  isUpcoming: boolean
  /** Syllabus nodes pinned to this version (§6 — P3-S2 trees). */
  nodeCount: number
  /** Exam mappings pinned to this version (§6/§8 — P3-S3 requirement layer). */
  mappingCount: number
  createdAt: string
  updatedAt: string
}

/** Public exam summary (§38 public app directory). */
export interface PublicExamSummary {
  id: string
  slug: string
  name: string
  code: string
  organiser: string
  level: ExamLevelPublic
  description: string | null
  countryIso: string
  /** The currently effective version, if any (§11 step 2). */
  currentVersion: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  versionCount: number
  /** §16 canonical exam path in the resolved language context. */
  canonicalPath: string
}

export interface PublicExamDetail extends PublicExamSummary {
  /** Full version history, newest-effective-first (§36 old versions stay queryable). */
  versions: ExamVersionRef[]
  language: { code: string; name: string; nativeName: string | null }
}

export interface PublicExamListResult {
  exams: PublicExamSummary[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  country: { isoCode: string; name: string }
}

/** Admin-facing exam record (all lifecycle statuses, scoped per §38). */
export interface AdminExam {
  id: string
  slug: string
  code: string
  name: string
  organiser: string
  level: ExamLevelPublic
  status: ExamStatusPublic
  countryIso: string
  countryName: string
  description: string | null
  notes: string | null
  currentVersion: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  versionCount: number
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: ExamEditability
  allowedTransitions: ExamTransitionAction[]
}

export interface AdminExamDetail extends AdminExam {
  versions: ExamVersionRef[]
}

export interface AdminExamListResult {
  exams: AdminExam[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

// ---------- P3-S2: SyllabusNode trees (§6, §13, §16, §36) ----------

/**
 * Tree editability (§36): a version's syllabus tree is staging until the
 * version enters history — then it never mutates again.
 * - `staged`: DRAFT exam (private provisioning) or a future-dated version.
 * - `frozen`: the version's window has started on a non-DRAFT exam — §36 history.
 * - `locked`: RETIRED exam — everything read-only.
 */
export type SyllabusEditability = 'staged' | 'frozen' | 'locked'

/** A syllabus node on the PUBLIC tree (§38 — no ids leaked beyond what the
 * client needs; topic link resolved in the requested language §35). */
export interface PublicSyllabusNode {
  name: string
  depth: number
  priority: number
  notes: string | null
  /** Canonical taxonomy link (§13) — resolved label + canonical name. */
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  /** §16 syllabus-topic path in the resolved locale context (topic-linked nodes only). */
  canonicalPath: string | null
  children: PublicSyllabusNode[]
}

export interface PublicExamSyllabus {
  exam: { id: string; slug: string; name: string; code: string; level: ExamLevelPublic }
  /** The version whose tree is returned — current by default (§11 step 2),
   * or an explicitly requested STARTED version (§36 historical query). */
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null; isCurrent: boolean } | null
  editability: SyllabusEditability
  nodeCount: number
  nodes: PublicSyllabusNode[]
  language: { code: string; name: string; nativeName: string | null }
}

/** Admin-facing node (console needs ids, parentId and topic ids for editing). */
export interface AdminSyllabusNode {
  id: string
  parentId: string | null
  name: string
  topicId: string | null
  topic: { slug: string; canonicalName: string } | null
  depth: number
  priority: number
  notes: string | null
  childCount: number
  children: AdminSyllabusNode[]
  createdAt: string
  updatedAt: string
}

export interface AdminVersionTree {
  exam: {
    id: string
    slug: string
    name: string
    code: string
    status: ExamStatusPublic
    countryIso: string
    countryName: string
  }
  version: ExamVersionRef
  /** Whether this tree may be edited right now (§36) + why. */
  editability: SyllabusEditability
  editabilityReason: string
  nodeCount: number
  tree: AdminSyllabusNode[]
}
