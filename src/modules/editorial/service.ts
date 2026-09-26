/**
 * GlobIQ — Editorial module: domain service (P2-S4)
 * Master Plan §6 (EditorialTask row), §18 (roles: writers work assigned
 * content, editors manage the board; writers never publish), §19 (workflow —
 * review tasks open on submit, resolve on publish/schedule, cancel on retire;
 * every transition audited), §20 (explicit country/language staff scopes
 * enforced server-side on EVERY operation — never by hiding UI), §36 (tasks
 * are never deleted), §37 (service-boundary authorization, deterministic
 * ordering), §38 (editorial console), §43 (P2-S4 scope).
 *
 * Scope model (§20):
 * - ADMIN: the whole board (global + every country).
 * - COUNTRY_ADMIN: own-country workspace — the §14 rule "every editorial
 *   workspace belongs to a country" applied to tasks. Global tasks (platform
 *   work on GLOBAL-unit content) are ADMIN-only, mirroring content parity.
 * - WRITER: own-country tasks narrowed by the language scope when set;
 *   may claim unassigned tasks, start/resolve THEIR tasks; board management
 *   (create/cancel/reopen/reassign) is editor-only (§18).
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import type {
  AssignableStaff,
  ContentWorkflowEvent,
  EditorialTask,
  EditorialTaskAction,
  EditorialTaskListResult,
  EditorialTaskPriorityPublic,
  EditorialTaskStatusPublic,
  EditorialTaskTypePublic,
} from './types'
import {
  EDITORIAL_TASK_TRANSITIONS,
  EDITOR_ONLY_TASK_ACTIONS,
} from './types'
import type {
  CreateEditorialTaskInput,
  EditorialTaskListQuery,
  EditorialTaskTransitionInput,
  UpdateEditorialTaskInput,
} from './validation'

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

// ---------- Errors (§37 — stable API codes) ----------

export type EditorialErrorCode =
  | 'TASK_NOT_FOUND'
  | 'TASK_NOT_VISIBLE'
  | 'EDITOR_ONLY'
  | 'WRITER_ACTION_FORBIDDEN'
  | 'GLOBAL_TASK_ADMIN_ONLY'
  | 'COUNTRY_MISMATCH'
  | 'LANGUAGE_SCOPE'
  | 'TASK_ASSIGNED_TO_OTHER'
  | 'TASK_UNASSIGNED'
  | 'INVALID_TASK_TRANSITION'
  | 'OBJECT_NOT_FOUND'
  | 'ASSIGNEE_NOT_STAFF'
  | 'ASSIGNEE_SCOPE_MISMATCH'
  | 'CANNOT_REVIEW_OWN_SUBMISSION'

const ERROR_STATUS: Record<EditorialErrorCode, number> = {
  TASK_NOT_FOUND: 404,
  TASK_NOT_VISIBLE: 403,
  EDITOR_ONLY: 403,
  WRITER_ACTION_FORBIDDEN: 403,
  GLOBAL_TASK_ADMIN_ONLY: 403,
  COUNTRY_MISMATCH: 403,
  LANGUAGE_SCOPE: 403,
  TASK_ASSIGNED_TO_OTHER: 409,
  TASK_UNASSIGNED: 409,
  INVALID_TASK_TRANSITION: 409,
  OBJECT_NOT_FOUND: 404,
  ASSIGNEE_NOT_STAFF: 400,
  ASSIGNEE_SCOPE_MISMATCH: 400,
  CANNOT_REVIEW_OWN_SUBMISSION: 400,
}

export class EditorialError extends Error {
  readonly code: EditorialErrorCode
  readonly status: number

  constructor(code: EditorialErrorCode, message: string) {
    super(message)
    this.name = 'EditorialError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown EditorialError to envelope data (§37); null for others. */
export function toEditorialErrorResponse(
  error: unknown
): { code: string; message: string; status: number } | null {
  if (error instanceof EditorialError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return null
}

// ---------- Row shape + scope helpers ----------

const TASK_INCLUDE = {
  country: true,
  language: true,
  assignee: true,
  resolvedBy: true,
  createdBy: true,
} satisfies Prisma.EditorialTaskInclude

type TaskRow = Prisma.EditorialTaskGetPayload<{ include: typeof TASK_INCLUDE }>

/** Board editors — §18 Country Admin (own country) + Global Admin. */
function isEditor(actor: Actor): boolean {
  return actor.role === 'ADMIN' || actor.role === 'COUNTRY_ADMIN'
}

/** §20 visibility: the workspace a task belongs to (ADMIN sees all). */
function canSeeTask(
  actor: Actor,
  task: Pick<TaskRow, 'countryId' | 'languageId'>
): boolean {
  if (actor.role === 'ADMIN') return true
  // Global tasks (platform work on GLOBAL-unit content) are ADMIN-only —
  // scoped staff cannot act on the underlying content (§14/§38 parity).
  if (task.countryId == null) return false
  if (task.countryId !== actor.countryId) return false
  if (
    actor.role === 'WRITER' &&
    actor.languageScopeId &&
    task.languageId != null &&
    task.languageId !== actor.languageScopeId
  ) {
    return false
  }
  return true
}

/** Object-level check + denial audit (the §20 signal — content-module pattern). */
function assertTaskVisible(actor: Actor, task: TaskRow, meta?: AuditRequestMeta): void {
  if (canSeeTask(actor, task)) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.editorialTaskDenied,
    objectType: AUDIT_OBJECT_TYPES.editorialTask,
    objectId: task.id,
    objectLabel: task.title,
    before: { status: task.status, countryId: task.countryId, languageId: task.languageId },
    metadata: {
      reason:
        task.countryId == null
          ? 'GLOBAL_TASK_ADMIN_ONLY'
          : task.countryId !== actor.countryId
            ? 'COUNTRY_MISMATCH'
            : 'LANGUAGE_SCOPE',
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined)
  if (task.countryId == null) {
    throw new EditorialError(
      'GLOBAL_TASK_ADMIN_ONLY',
      'Global tasks are platform-admin only (§38) — they reference content outside country workspaces'
    )
  }
  if (task.countryId !== actor.countryId) {
    throw new EditorialError('COUNTRY_MISMATCH', 'This task belongs to another country workspace')
  }
  throw new EditorialError(
    'LANGUAGE_SCOPE',
    'This task is outside your language scope (§20 explicit staff scopes)'
  )
}

/** Server-driven affordances (§20/§37) — the server re-checks every action. */
function allowedActionsFor(
  actor: Actor,
  task: Pick<TaskRow, 'status' | 'assigneeId'>
): EditorialTaskAction[] {
  const machine = Object.keys(
    EDITORIAL_TASK_TRANSITIONS[task.status as EditorialTaskStatusPublic]
  ) as EditorialTaskAction[]
  const editor = isEditor(actor)
  const mine = task.assigneeId === actor.userId
  return machine.filter((action) => {
    if (EDITOR_ONLY_TASK_ACTIONS.has(action)) return editor
    switch (action) {
      case 'claim':
        return task.assigneeId == null || mine
      case 'start':
      case 'resolve':
        return mine || editor
      default:
        return false
    }
  })
}

function toTaskDto(actor: Actor, task: TaskRow): EditorialTask {
  return {
    id: task.id,
    type: task.type as EditorialTaskTypePublic,
    status: task.status as EditorialTaskStatusPublic,
    priority: task.priority as EditorialTaskPriorityPublic,
    countryIso: task.country?.isoCode ?? null,
    language: task.language ? { code: task.language.code, name: task.language.name } : null,
    objectType: task.objectType,
    objectId: task.objectId,
    objectLabel: task.objectLabel,
    title: task.title,
    notes: task.notes,
    resolutionNote: task.resolutionNote,
    assignee: task.assignee
      ? { id: task.assignee.id, email: task.assignee.email, name: task.assignee.name }
      : null,
    dueAt: task.dueAt?.toISOString() ?? null,
    startedAt: task.startedAt?.toISOString() ?? null,
    resolvedAt: task.resolvedAt?.toISOString() ?? null,
    resolvedBy: task.resolvedBy?.email ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    allowedActions: allowedActionsFor(actor, task),
    canManage: isEditor(actor) && canSeeTask(actor, task),
  }
}

/** The scope filter for list reads (§20). */
function taskScopeWhere(actor: Actor): Prisma.EditorialTaskWhereInput {
  if (actor.role === 'ADMIN') return {}
  if (actor.role === 'COUNTRY_ADMIN') return { countryId: actor.countryId }
  // WRITER: own country, narrowed by the language scope (§18/§20). Tasks
  // without a language dimension stay visible.
  return actor.languageScopeId
    ? {
        countryId: actor.countryId,
        OR: [{ languageId: null }, { languageId: actor.languageScopeId }],
      }
    : { countryId: actor.countryId }
}

async function loadTask(id: string): Promise<TaskRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.editorialTask.findUnique({ where: { id }, include: TASK_INCLUDE })
}

// ---------- Reads ----------

export async function getEditorialTasks(
  actor: Actor,
  query: EditorialTaskListQuery
): Promise<EditorialTaskListResult> {
  if (!can(actor, 'editorial:work')) {
    throw new EditorialError('EDITOR_ONLY', 'The editorial workspace requires staff access')
  }

  // ADMIN country filter: ISO code or 'global' (platform tasks).
  let countryFilter: Prisma.EditorialTaskWhereInput | undefined
  if (actor.role === 'ADMIN' && query.country) {
    countryFilter =
      query.country === 'global'
        ? { countryId: null }
        : { country: { isoCode: query.country.toUpperCase() } }
  }

  const scope = taskScopeWhere(actor)
  const filters: Prisma.EditorialTaskWhereInput = {
    ...scope,
    ...(countryFilter ?? {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.priority ? { priority: query.priority } : {}),
    ...(query.assignee
      ? query.assignee === 'me'
        ? { assigneeId: actor.userId }
        : query.assignee === 'unassigned'
          ? { assigneeId: null }
          : { assigneeId: query.assignee }
      : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { objectLabel: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const where = { ...scope, ...(countryFilter ?? {}) }
  const [rows, total, statusGroups, typeGroups] = await Promise.all([
    db.editorialTask.findMany({
      where: filters,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: TASK_INCLUDE,
    }),
    db.editorialTask.count({ where: filters }),
    db.editorialTask.groupBy({
      by: ['status'],
      where, // summary ignores the status filter (audit-summary parity)
      _count: { _all: true },
    }),
    db.editorialTask.groupBy({
      by: ['type'],
      where,
      _count: { _all: true },
    }),
  ])

  const byStatus = (status: EditorialTaskStatusPublic): number =>
    statusGroups.find((group) => group.status === status)?._count._all ?? 0

  return {
    tasks: rows.map((row) => toTaskDto(actor, row)),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary: {
      total: statusGroups.reduce((sum, group) => sum + group._count._all, 0),
      open: byStatus('OPEN'),
      inProgress: byStatus('IN_PROGRESS'),
      resolved: byStatus('RESOLVED'),
      cancelled: byStatus('CANCELLED'),
    },
    facets: {
      types: typeGroups
        .map((group) => group.type as EditorialTaskTypePublic)
        .sort((a, b) => a.localeCompare(b)),
    },
  }
}

export async function getEditorialTask(actor: Actor, id: string): Promise<EditorialTask> {
  const task = await loadTask(id)
  if (!task) throw new EditorialError('TASK_NOT_FOUND', 'Editorial task not found')
  assertTaskVisible(actor, task)
  return toTaskDto(actor, task)
}

// ---------- Assignee directory (§20 — workspace assignment) ----------

export async function listAssignableStaff(actor: Actor): Promise<AssignableStaff[]> {
  if (!isEditor(actor)) {
    throw new EditorialError('EDITOR_ONLY', 'Assignment is an editorial action (§18)')
  }
  const where: Prisma.UserWhereInput =
    actor.role === 'ADMIN'
      ? { status: 'ACTIVE', role: { in: ['WRITER', 'COUNTRY_ADMIN', 'ADMIN'] } }
      : // COUNTRY_ADMIN assigns within their workspace: own-country staff plus
        // platform admins (who can act on any task).
        {
          status: 'ACTIVE',
          OR: [
            { role: 'ADMIN' },
            { role: 'WRITER', homeCountryId: actor.countryId },
            { role: 'COUNTRY_ADMIN', homeCountryId: actor.countryId },
          ],
        }

  const staff = await db.user.findMany({
    where,
    include: { homeCountry: true, languageScope: true },
    orderBy: [{ role: 'asc' }, { email: 'asc' }], // deterministic (§37)
  })

  return staff.map((user) => ({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role as AssignableStaff['role'],
    homeCountryIso: user.homeCountry?.isoCode ?? null,
    languageScopeCode: user.languageScope?.code ?? null,
  }))
}

// ---------- Writes ----------

/** Validates that `assigneeId` is ACTIVE staff scope-compatible with the task (§20). */
async function assertAssignable(
  assigneeId: string,
  task: { countryId: string | null; languageId: string | null }
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: assigneeId },
    include: { homeCountry: true, languageScope: true },
  })
  if (!user || user.status !== 'ACTIVE' || !['WRITER', 'COUNTRY_ADMIN', 'ADMIN'].includes(user.role)) {
    throw new EditorialError(
      'ASSIGNEE_NOT_STAFF',
      'Tasks can only be assigned to active staff accounts (WRITER, COUNTRY_ADMIN or ADMIN — §20)'
    )
  }
  if (user.role === 'ADMIN') return // platform admins fit any workspace
  if (task.countryId == null || user.homeCountryId !== task.countryId) {
    throw new EditorialError(
      'ASSIGNEE_SCOPE_MISMATCH',
      'That staff member is not scoped to this task\u2019s country workspace (§20)'
    )
  }
  if (
    user.role === 'WRITER' &&
    user.languageScopeId &&
    task.languageId != null &&
    user.languageScopeId !== task.languageId
  ) {
    throw new EditorialError(
      'ASSIGNEE_SCOPE_MISMATCH',
      'That writer is language-scoped elsewhere (§18/§20 — explicit language scopes)'
    )
  }
}

export async function createEditorialTask(
  actor: Actor,
  input: CreateEditorialTaskInput,
  meta: AuditRequestMeta = {}
): Promise<EditorialTask> {
  if (!isEditor(actor)) {
    throw new EditorialError(
      'EDITOR_ONLY',
      'Creating work items is an editorial action — writers work assigned tasks (§18)'
    )
  }

  // The work object (§6 object_id): today always a ContentItem.
  if (!CUID_PATTERN.test(input.objectId)) {
    throw new EditorialError('OBJECT_NOT_FOUND', 'Unknown work object')
  }
  const item = await db.contentItem.findUnique({
    where: { id: input.objectId },
    include: { knowledgeUnit: true, language: true },
  })
  if (!item) {
    throw new EditorialError('OBJECT_NOT_FOUND', 'Content item not found')
  }

  // The task inherits the work object's scope (§14/§20): the owning unit's
  // country — GLOBAL units produce platform (global) tasks.
  const countryId = item.knowledgeUnit.scope === 'COUNTRY' ? item.knowledgeUnit.countryId : null
  const languageId = item.languageId
  if (actor.role === 'COUNTRY_ADMIN') {
    if (countryId == null) {
      throw new EditorialError(
        'GLOBAL_TASK_ADMIN_ONLY',
        'Tasks on global-unit content are platform-admin only (§38 content parity)'
      )
    }
    if (countryId !== actor.countryId) {
      throw new EditorialError('COUNTRY_MISMATCH', 'This content belongs to another country workspace')
    }
  }

  if (input.assigneeId) {
    await assertAssignable(input.assigneeId, { countryId, languageId })
  }

  const objectLabel = `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`
  const created = await db.editorialTask.create({
    data: {
      type: input.type,
      status: 'OPEN',
      priority: input.priority ?? 'MEDIUM',
      countryId,
      languageId,
      objectType: 'ContentItem',
      objectId: item.id,
      objectLabel,
      title: input.title,
      notes: input.notes ?? null,
      assigneeId: input.assigneeId ?? null,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      createdById: actor.userId,
    },
    include: TASK_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.editorialTaskCreate,
    objectType: AUDIT_OBJECT_TYPES.editorialTask,
    objectId: created.id,
    objectLabel: created.title,
    after: {
      type: created.type,
      status: created.status,
      priority: created.priority,
      countryId,
      languageId,
      objectType: created.objectType,
      objectId: created.objectId,
      assigneeId: created.assigneeId,
      dueAt: created.dueAt?.toISOString() ?? null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toTaskDto(actor, created)
}

export async function updateEditorialTask(
  actor: Actor,
  id: string,
  input: UpdateEditorialTaskInput,
  meta: AuditRequestMeta = {}
): Promise<EditorialTask> {
  if (!isEditor(actor)) {
    throw new EditorialError(
      'EDITOR_ONLY',
      'Editing work items is an editorial action — writers work assigned tasks (§18)'
    )
  }
  const task = await loadTask(id)
  if (!task) throw new EditorialError('TASK_NOT_FOUND', 'Editorial task not found')
  assertTaskVisible(actor, task, meta)

  if (input.assigneeId !== undefined && input.assigneeId !== null && input.assigneeId !== task.assigneeId) {
    await assertAssignable(input.assigneeId, {
      countryId: task.countryId,
      languageId: task.languageId,
    })
  }

  const before = {
    title: task.title,
    notes: task.notes,
    priority: task.priority,
    dueAt: task.dueAt?.toISOString() ?? null,
    assigneeId: task.assigneeId,
    status: task.status,
  }
  const updated = await db.editorialTask.update({
    where: { id: task.id },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
      ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
    },
    include: TASK_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.editorialTaskUpdate,
    objectType: AUDIT_OBJECT_TYPES.editorialTask,
    objectId: task.id,
    objectLabel: task.title,
    before,
    after: {
      title: updated.title,
      notes: updated.notes,
      priority: updated.priority,
      dueAt: updated.dueAt?.toISOString() ?? null,
      assigneeId: updated.assigneeId,
      status: updated.status,
    },
    metadata: { changedFields: Object.keys(input) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toTaskDto(actor, updated)
}

export async function transitionEditorialTask(
  actor: Actor,
  id: string,
  input: EditorialTaskTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<EditorialTask> {
  const task = await loadTask(id)
  if (!task) throw new EditorialError('TASK_NOT_FOUND', 'Editorial task not found')
  assertTaskVisible(actor, task, meta)

  const status = task.status as EditorialTaskStatusPublic
  const target = EDITORIAL_TASK_TRANSITIONS[status][input.action]
  if (!target) {
    throw new EditorialError(
      'INVALID_TASK_TRANSITION',
      `"${input.action}" is not a valid action from ${status}`
    )
  }

  const mine = task.assigneeId === actor.userId
  const editor = isEditor(actor)

  // §19 separation of duties comes FIRST (the most specific rule): the WRITER
  // who submitted content must not work its auto-opened review task — no
  // claim/start/resolve path, whatever the assignment state.
  if (
    (input.action === 'claim' || input.action === 'start' || input.action === 'resolve') &&
    actor.role === 'WRITER' &&
    task.type === 'EDITORIAL_REVIEW' &&
    task.createdById === actor.userId
  ) {
    throw new EditorialError(
      'CANNOT_REVIEW_OWN_SUBMISSION',
      'You cannot review content you submitted (§19 separation of duties) — an editor works the review task'
    )
  }

  // §18 role rules — writers work THEIR tasks; board management is editorial.
  if (EDITOR_ONLY_TASK_ACTIONS.has(input.action) && !editor) {
    void recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.editorialTaskDenied,
      objectType: AUDIT_OBJECT_TYPES.editorialTask,
      objectId: task.id,
      objectLabel: task.title,
      before: { status: task.status, assigneeId: task.assigneeId },
      metadata: { attemptedAction: input.action, reason: 'WRITER_ACTION_FORBIDDEN' },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new EditorialError(
      'WRITER_ACTION_FORBIDDEN',
      'Cancelling/reopening work items is an editorial action (§18) — ask a country or platform admin'
    )
  }
  // Ownership rules (§18), most-specific first: an unassigned task cannot be
  // started (claim it first); claim only fails when someone else holds the
  // task; start/resolve require ownership (editors may act on any task).
  if (input.action === 'start' && task.assigneeId == null && !editor) {
    throw new EditorialError(
      'TASK_UNASSIGNED',
      'Claim the task first — unassigned tasks cannot be started (claim assigns it to you)'
    )
  }
  if (input.action === 'claim' && task.assigneeId != null && !mine) {
    throw new EditorialError(
      'TASK_ASSIGNED_TO_OTHER',
      'This task is already claimed — an editor can reassign it if needed'
    )
  }
  if ((input.action === 'start' || input.action === 'resolve') && !mine && !editor) {
    throw new EditorialError(
      'TASK_ASSIGNED_TO_OTHER',
      'This task is assigned to another staff member — claim an unassigned task instead'
    )
  }

  const now = new Date()
  const updated = await db.editorialTask.update({
    where: { id: task.id },
    data: {
      status: target,
      ...(input.action === 'claim' ? { assigneeId: actor.userId } : {}),
      ...(input.action === 'start' ? { startedAt: task.startedAt ?? now } : {}),
      ...(input.action === 'resolve'
        ? {
            resolvedAt: now,
            resolvedById: actor.userId,
            resolutionNote: input.resolutionNote?.trim() ?? task.resolutionNote,
          }
        : {}),
      ...(input.action === 'reopen'
        ? { startedAt: null, resolvedAt: null, resolvedById: null, resolutionNote: null }
        : {}),
    },
    include: TASK_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.editorialTaskTransition,
    objectType: AUDIT_OBJECT_TYPES.editorialTask,
    objectId: task.id,
    objectLabel: task.title,
    before: { status: task.status, assigneeId: task.assigneeId },
    after: {
      status: updated.status,
      assigneeId: updated.assigneeId,
      resolvedAt: updated.resolvedAt?.toISOString() ?? null,
      resolutionNote: updated.resolutionNote,
    },
    metadata: {
      action: input.action,
      resolutionNote: input.resolutionNote?.trim() ?? null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toTaskDto(actor, updated)
}

// ---------- §19 workflow wiring (called from content-service) ----------

/**
 * The single hook the knowledge module calls inside its content-transition
 * transactions, keeping task state and content state consistent (§19):
 * - submit_review → auto-open an EDITORIAL_REVIEW task (one per cycle).
 * - publish/schedule → resolve the item's open tasks (work complete).
 * - send_back → resolve open tasks (cycle aborted; re-submit opens a new one).
 * - retire → cancel open tasks (withdrawn content).
 *
 * Audit note (documented trade-off, P1-S5 pattern): recordAudit is a separate
 * best-effort write outside the caller's transaction.
 */
export async function wireContentWorkflow(
  tx: Prisma.TransactionClient,
  event: ContentWorkflowEvent
): Promise<void> {
  const { item } = event
  const objectLabel = `${item.unitSlug}/${item.languageCode}/${item.format}`

  if (event.action === 'submit_review') {
    // One live review task per item cycle: send_back/publish resolve the
    // previous one, so a duplicate here only guards double-submits.
    const existing = await tx.editorialTask.findFirst({
      where: {
        objectType: 'ContentItem',
        objectId: item.id,
        type: 'EDITORIAL_REVIEW',
        status: { in: ['OPEN', 'IN_PROGRESS'] },
      },
      select: { id: true },
    })
    if (!existing) {
      const created = await tx.editorialTask.create({
        data: {
          type: 'EDITORIAL_REVIEW',
          status: 'OPEN',
          priority: 'MEDIUM',
          countryId: item.countryId,
          languageId: item.languageId,
          objectType: 'ContentItem',
          objectId: item.id,
          objectLabel,
          title: `Editorial review — ${item.title}`,
          // The submitter becomes the task's creator — the §19
          // separation-of-duties guard uses this to block self-reviews.
          createdById: event.actorId,
        },
      })
      void recordAudit({
        actor: null,
        action: AUDIT_ACTIONS.editorialTaskCreate,
        objectType: AUDIT_OBJECT_TYPES.editorialTask,
        objectId: created.id,
        objectLabel: created.title,
        after: { type: created.type, status: created.status, countryId: item.countryId },
        metadata: { auto: 'submit_review', item: objectLabel },
      }).catch(() => undefined)
    }
    return
  }

  const outcome =
    event.action === 'retire'
      ? { status: 'CANCELLED' as const, note: 'Content retired — open work items cancelled (§19 step 10)' }
      : event.action === 'schedule'
        ? { status: 'RESOLVED' as const, note: 'Content scheduled for release — review complete (§19 step 7)' }
        : event.action === 'send_back'
          ? { status: 'RESOLVED' as const, note: 'Content sent back to draft — re-submit opens a fresh review' }
          : { status: 'RESOLVED' as const, note: 'Content published — open work items resolved' }

  const open = await tx.editorialTask.findMany({
    where: {
      objectType: 'ContentItem',
      objectId: item.id,
      status: { in: ['OPEN', 'IN_PROGRESS'] },
    },
    select: { id: true, title: true },
  })
  if (open.length === 0) return

  const now = new Date()
  for (const row of open) {
    await tx.editorialTask.update({
      where: { id: row.id },
      data: {
        status: outcome.status,
        resolutionNote: outcome.note,
        resolvedAt: now,
        resolvedById: null, // system resolution (§19 wiring)
      },
    })
    void recordAudit({
      actor: null,
      action: AUDIT_ACTIONS.editorialTaskTransition,
      objectType: AUDIT_OBJECT_TYPES.editorialTask,
      objectId: row.id,
      objectLabel: row.title,
      before: { status: open.length > 0 ? 'OPEN/IN_PROGRESS' : null },
      after: { status: outcome.status, resolutionNote: outcome.note },
      metadata: { auto: event.action, item: objectLabel },
    }).catch(() => undefined)
  }
}
