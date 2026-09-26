/**
 * GlobIQ — Editorial module: EditorialTask DTOs (P2-S4)
 * Master Plan §6 (EditorialTask row: "id, country, language, type, object_id,
 * assignee, status"), §18 (editorial roles — writers work, editors manage),
 * §19 (workflow — every transition audited), §20 (explicit country/language
 * staff scopes, checked server-side on every operation), §37 (client-agnostic
 * DTOs), §38 (editorial console surface).
 */

/** §19 workflow steps a task can represent (configurable vocabulary). */
export type EditorialTaskTypePublic =
  | 'EDITORIAL_REVIEW'
  | 'FACT_CHECK'
  | 'LOCALISATION_REVIEW'
  | 'SEO_REVIEW'
  | 'EXAM_MAPPING_REVIEW'
  | 'CORRECTION'
  | 'GENERAL'

export const EDITORIAL_TASK_TYPES: EditorialTaskTypePublic[] = [
  'EDITORIAL_REVIEW',
  'FACT_CHECK',
  'LOCALISATION_REVIEW',
  'SEO_REVIEW',
  'EXAM_MAPPING_REVIEW',
  'CORRECTION',
  'GENERAL',
]

/** Human-readable labels + §19 step refs for UI rendering. */
export const EDITORIAL_TASK_TYPE_LABELS: Record<EditorialTaskTypePublic, string> = {
  EDITORIAL_REVIEW: 'Editorial review (§19 step 2)',
  FACT_CHECK: 'Fact / source check (§19 step 3)',
  LOCALISATION_REVIEW: 'Localisation review (§19 step 5)',
  SEO_REVIEW: 'SEO review (§19 step 6)',
  EXAM_MAPPING_REVIEW: 'Exam mapping review (§19 step 4 — used from P3)',
  CORRECTION: 'Correction (§19 step 9 / §25)',
  GENERAL: 'General work item',
}

export type EditorialTaskStatusPublic = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'

export const EDITORIAL_TASK_STATUSES: EditorialTaskStatusPublic[] = [
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'CANCELLED',
]

export type EditorialTaskPriorityPublic = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

export const EDITORIAL_TASK_PRIORITIES: EditorialTaskPriorityPublic[] = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
]

/** Board actions (the task's own small state machine, §19). */
export type EditorialTaskAction = 'start' | 'claim' | 'resolve' | 'cancel' | 'reopen'

export const EDITORIAL_TASK_ACTIONS: EditorialTaskAction[] = [
  'start',
  'claim',
  'resolve',
  'cancel',
  'reopen',
]

/** State machine map — single source for service + UI rendering. */
export const EDITORIAL_TASK_TRANSITIONS: Record<
  EditorialTaskStatusPublic,
  Partial<Record<EditorialTaskAction, EditorialTaskStatusPublic>>
> = {
  OPEN: { start: 'IN_PROGRESS', claim: 'IN_PROGRESS', cancel: 'CANCELLED' },
  IN_PROGRESS: { resolve: 'RESOLVED', cancel: 'CANCELLED', reopen: 'OPEN' },
  RESOLVED: { reopen: 'OPEN' },
  CANCELLED: { reopen: 'OPEN' },
}

/**
 * Board-management actions reserved for editors (ADMIN + COUNTRY_ADMIN) —
 * §18: writers create/edit assigned content; abandoning or reopening work
 * items and reassigning them is an editorial decision.
 */
export const EDITOR_ONLY_TASK_ACTIONS: ReadonlySet<EditorialTaskAction> = new Set([
  'cancel',
  'reopen',
])

/** Assignable staff member (§20 — the workspace assignment directory). */
export interface AssignableStaff {
  id: string
  email: string
  name: string | null
  role: 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'
  homeCountryIso: string | null
  /** Staff language scope (§18/§20) — null = all languages in scope. */
  languageScopeCode: string | null
}

/** List row — everything the board renders, no joins needed client-side. */
export interface EditorialTask {
  id: string
  type: EditorialTaskTypePublic
  status: EditorialTaskStatusPublic
  priority: EditorialTaskPriorityPublic
  countryIso: string | null // null = platform/global task (ADMIN-only board)
  language: { code: string; name: string } | null
  objectType: string
  objectId: string
  objectLabel: string
  title: string
  notes: string | null
  resolutionNote: string | null
  assignee: { id: string; email: string; name: string | null } | null
  dueAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  resolvedBy: string | null // email snapshot
  createdAt: string
  updatedAt: string
  /** Server-driven affordances (§20/§37) — the server re-checks every action. */
  allowedActions: EditorialTaskAction[]
  /** Whether the actor may manage the task (editors: reassign/edit/cancel). */
  canManage: boolean
}

export interface EditorialTaskPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface EditorialTaskListResult {
  tasks: EditorialTask[]
  pagination: EditorialTaskPagination
  /** Filter-coherent status counts within the caller's scope (ignores the
   * status filter itself, like the audit summary). */
  summary: { total: number; open: number; inProgress: number; resolved: number; cancelled: number }
  /** Distinct task types present in scope — powers the filter dropdown. */
  facets: { types: EditorialTaskTypePublic[] }
}

/**
 * The event content-service sends on every content transition so the workflow
 * wiring (§19) stays inside the caller's transaction. `languageId` is the
 * ContentItem's language row id; `countryId` is the owning unit's country
 * (null for GLOBAL units → a platform/global task). `actorId` is the
 * transitioning user — recorded as the auto-opened review task's creator so
 * the §19 separation-of-duties guard can block self-reviews.
 */
export interface ContentWorkflowEvent {
  action: 'submit_review' | 'send_back' | 'schedule' | 'publish' | 'retire'
  actorId: string | null
  item: {
    id: string
    unitSlug: string
    countryId: string | null
    languageId: string
    languageCode: string
    format: string
    title: string
  }
}
