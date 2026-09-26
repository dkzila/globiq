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
