/**
 * GlobIQ — Exams & Syllabus: domain service (P3-S1)
 * Master Plan §6 (Exam/ExamVersion rows), §8 (the requirement layer this
 * anchors — ExamMapping arrives P3-S3), §11 (step 2: resolve each exam to its
 * active ExamVersion — `currentVersion` is that resolution), §14/§15 (every
 * exam belongs to exactly ONE country; scope enforced server-side on every
 * query, never by hiding UI), §16 (canonical exam URLs from country +
 * language + object identity), §18/§20 (exam operations are Country Admin /
 * Admin work — writers never manage exams), §36 (exam syllabus changes create
 * a NEW ExamVersion; windows immutable after create; old versions stay
 * historically queryable), §37 (service-boundary authorization, pagination,
 * deterministic sorting, explicit errors), §38 (editorial console + public
 * app), §43 (P3-S1 scope).
 *
 * Version model: windows are day-granular and non-overlapping. The CURRENT
 * version is the one whose [effectiveFrom, effectiveTo] contains now
 * (effectiveTo null = in effect until superseded). Creating a version closes
 * the open predecessor at (newFrom − 1 day). Windows are NEVER edited
 * afterwards — history is append-only (§36). A pre-effective LATEST version
 * may be removed as a correction (it never entered history), which reopens
 * the predecessor it had auto-closed.
 */
import type { Prisma, Exam, ExamVersion } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  buildCanonicalUrl,
  findActiveCountryByIso,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import type { PublicCountry } from '@/modules/country-locale'

import {
  EXAM_EDITABILITY,
  EXAM_TRANSITIONS,
  REASON_REQUIRED_TRANSITIONS,
} from './types'
import type {
  AdminExam,
  AdminExamDetail,
  AdminExamListResult,
  ExamEditability,
  ExamLevelPublic,
  ExamStatusPublic,
  ExamTransitionAction,
  ExamVersionRef,
  PublicExamDetail,
  PublicExamListResult,
  PublicExamSummary,
} from './types'
import type {
  AdminExamListQuery,
  CreateExamInput,
  CreateExamVersionInput,
  ExamTransitionInput,
  PublicExamListQuery,
  UpdateExamInput,
  UpdateExamVersionInput,
} from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type ExamErrorCode =
  | 'EXAM_NOT_FOUND'
  | 'SLUG_TAKEN'
  | 'CODE_TAKEN'
  | 'COUNTRY_NOT_FOUND'
  | 'COUNTRY_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'REASON_REQUIRED'
  | 'VERSION_NOT_FOUND'
  | 'VERSION_WINDOW_INVALID'
  | 'VERSION_OVERLAP'
  | 'VERSION_ALREADY_EFFECTIVE'
  | 'VERSION_NOT_LATEST'
  | 'VERSION_REFERENCED'
  // P3-S2 syllabus-tree codes (§6/§13/§36)
  | 'VERSION_FROZEN'
  | 'VERSION_NOT_STARTED'
  | 'NODE_NOT_FOUND'
  | 'PARENT_INVALID'
  | 'INVALID_MOVE'
  | 'NODE_HAS_CHILDREN'
  | 'TOPIC_NOT_FOUND'
  | 'TOPIC_COUNTRY_MISMATCH'
  | 'OUTLINE_INVALID'
  // P3-S3 reference guards (mappings are §36 history — nodes/trees carrying
  // them never disappear silently; see exam-mapping/mapping-service.ts)
  | 'NODE_HAS_MAPPINGS'
  | 'VERSION_HAS_MAPPINGS'

const ERROR_STATUS: Record<ExamErrorCode, number> = {
  EXAM_NOT_FOUND: 404,
  SLUG_TAKEN: 409,
  CODE_TAKEN: 409,
  COUNTRY_NOT_FOUND: 404,
  COUNTRY_MISMATCH: 403,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  REASON_REQUIRED: 400,
  VERSION_NOT_FOUND: 404,
  VERSION_WINDOW_INVALID: 400,
  VERSION_OVERLAP: 409,
  VERSION_ALREADY_EFFECTIVE: 409,
  VERSION_NOT_LATEST: 409,
  VERSION_REFERENCED: 409,
  VERSION_FROZEN: 409,
  VERSION_NOT_STARTED: 404,
  NODE_NOT_FOUND: 404,
  PARENT_INVALID: 400,
  INVALID_MOVE: 409,
  NODE_HAS_CHILDREN: 409,
  TOPIC_NOT_FOUND: 404,
  TOPIC_COUNTRY_MISMATCH: 400,
  OUTLINE_INVALID: 400,
  NODE_HAS_MAPPINGS: 409,
  VERSION_HAS_MAPPINGS: 409,
}

export class ExamError extends Error {
  readonly code: ExamErrorCode
  readonly status: number

  constructor(code: ExamErrorCode, message: string) {
    super(message)
    this.name = 'ExamError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown ExamError to envelope data (§37); null for others. */
export function toExamErrorResponse(
  error: unknown
): { message: string; code: ExamErrorCode; status: number } | null {
  if (error instanceof ExamError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Day-window helpers (§36 day-granular effective windows) ----------

const DAY_MS = 24 * 60 * 60 * 1000

/** Truncates to the UTC midnight of that day (windows are day-granular). */
function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** True when the window [from, to|null] contains `now` (inclusive ends). */
export function windowContains(
  version: { effectiveFrom: Date; effectiveTo: Date | null },
  now = Date.now()
): boolean {
  const fromOk = version.effectiveFrom.getTime() <= now
  // effectiveTo is the inclusive LAST DAY — effective through its end (23:59:59).
  const toOk = version.effectiveTo == null || now < version.effectiveTo.getTime() + DAY_MS
  return fromOk && toOk
}

/** Interval overlap with null = open-ended (+∞). Both ends inclusive. */
function windowsOverlap(
  from: Date,
  to: Date | null,
  otherFrom: Date,
  otherTo: Date | null
): boolean {
  const a = from.getTime()
  const b = to ? to.getTime() : Number.POSITIVE_INFINITY
  const c = otherFrom.getTime()
  const d = otherTo ? otherTo.getTime() : Number.POSITIVE_INFINITY
  return a <= d && c <= b
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** Version + denormalised reference counts (nodes P3-S2, mappings P3-S3). */
export type VersionWithCount = ExamVersion & {
  _count: { syllabusNodes: number; examMappings: number }
}
export type ExamRow = Exam & { versions: VersionWithCount[] }

export async function findExam(ref: string): Promise<ExamRow | null> {
  return db.exam.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
    include: {
      versions: { include: { _count: { select: { syllabusNodes: true, examMappings: true } } } },
    },
  })
}

/** Audit snapshot of an exam (§6 field row). */
function examSnapshot(exam: Exam) {
  return {
    slug: exam.slug,
    code: exam.code,
    name: exam.name,
    organiser: exam.organiser,
    level: exam.level,
    status: exam.status,
    countryId: exam.countryId,
    description: exam.description,
    notes: exam.notes,
  }
}

function versionSnapshot(version: ExamVersion) {
  return {
    id: version.id,
    label: version.label,
    effectiveFrom: version.effectiveFrom.toISOString(),
    effectiveTo: version.effectiveTo?.toISOString() ?? null,
    source: version.source,
    notes: version.notes,
  }
}

export function toVersionRef(version: VersionWithCount): ExamVersionRef {
  return {
    id: version.id,
    label: version.label,
    effectiveFrom: version.effectiveFrom.toISOString(),
    effectiveTo: version.effectiveTo?.toISOString() ?? null,
    source: version.source,
    notes: version.notes,
    isCurrent: windowContains(version),
    isUpcoming: version.effectiveFrom.getTime() > Date.now(),
    nodeCount: version._count.syllabusNodes,
    /** Mappings pinned to this version (§6 — P3-S3 requirement layer). */
    mappingCount: version._count.examMappings,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  }
}

/** The §11 "active ExamVersion" — the window containing now, if any. */
export function currentVersionOf(versions: VersionWithCount[]) {
  const current = versions.find((version) => windowContains(version)) ?? null
  if (!current) return null
  return {
    id: current.id,
    label: current.label,
    effectiveFrom: current.effectiveFrom.toISOString(),
    effectiveTo: current.effectiveTo?.toISOString() ?? null,
  }
}

/** Sorted newest-effective-first (deterministic §37; history reads top-down). */
function sortedVersions(versions: VersionWithCount[]): VersionWithCount[] {
  return [...versions].sort(
    (a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime() || a.id.localeCompare(b.id)
  )
}

/** §16 exam path: …/exams/{exam-slug}/ under the locale prefix. */
function examPath(
  country: PublicCountry,
  languageCode: string,
  examSlug: string
): string {
  return buildCanonicalUrl(
    { slug: country.slug, isDefault: country.isDefault },
    { code: languageCode },
    country.defaultLanguage.code,
    ['exams', examSlug]
  )
}

/** Object-level permission check + denial audit (§20 signal). */
export function assertCanManageExam(actor: Actor, exam: Exam, operation: string, meta?: AuditRequestMeta): void {
  if (can(actor, 'exam:manage', { countryId: exam.countryId })) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examDenied,
    objectType: AUDIT_OBJECT_TYPES.exam,
    objectId: exam.id,
    objectLabel: exam.slug,
    before: { slug: exam.slug, status: exam.status },
    metadata: { attemptedOperation: operation, reason: 'COUNTRY_MISMATCH' },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined)
  throw new ExamError(
    'COUNTRY_MISMATCH',
    actor.role === 'COUNTRY_ADMIN'
      ? 'You can only manage exams for your own country'
      : 'You do not have permission to manage exams'
  )
}

/**
 * Resolves an ACTIVE country + its public shape + the requested language for
 * public reads. Unknown/inactive countries surface as clean 404s (§37) —
 * LocaleError never leaks as a 500.
 */
export async function resolvePublicContext(input: { country?: string; language?: string }): Promise<{
  countryRow: { id: string; isoCode: string }
  country: PublicCountry
  languageCode: string
}> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new ExamError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }
  const [country, countryRow] = await Promise.all([
    getPublicCountry(resolution.country.isoCode),
    findActiveCountryByIso(resolution.country.isoCode),
  ])
  if (!country || !countryRow) {
    throw new ExamError('COUNTRY_NOT_FOUND', `Country "${resolution.country.isoCode}" is not available`)
  }
  return { countryRow, country, languageCode: resolution.language.code }
}

function toPublicSummary(
  exam: ExamRow,
  countryIso: string,
  path: string
): PublicExamSummary {
  return {
    id: exam.id,
    slug: exam.slug,
    name: exam.name,
    code: exam.code,
    organiser: exam.organiser,
    level: exam.level as ExamLevelPublic,
    description: exam.description,
    countryIso,
    currentVersion: currentVersionOf(exam.versions),
    versionCount: exam.versions.length,
    canonicalPath: path,
  }
}

async function toAdminExam(exam: ExamRow): Promise<AdminExam> {
  const country = await db.country.findUnique({
    where: { id: exam.countryId },
    select: { isoCode: true, name: true },
  })
  const editability = EXAM_EDITABILITY[exam.status as ExamStatusPublic]
  return {
    id: exam.id,
    slug: exam.slug,
    code: exam.code,
    name: exam.name,
    organiser: exam.organiser,
    level: exam.level as ExamLevelPublic,
    status: exam.status as ExamStatusPublic,
    countryIso: country?.isoCode ?? '??',
    countryName: country?.name ?? 'Unknown country',
    description: exam.description,
    notes: exam.notes,
    currentVersion: currentVersionOf(exam.versions),
    versionCount: exam.versions.length,
    createdAt: exam.createdAt.toISOString(),
    updatedAt: exam.updatedAt.toISOString(),
    canEdit: editability !== 'none',
    editability,
    allowedTransitions: Object.keys(
      EXAM_TRANSITIONS[exam.status as ExamStatusPublic]
    ) as ExamTransitionAction[],
  }
}

async function toAdminDetail(exam: ExamRow): Promise<AdminExamDetail> {
  return {
    ...(await toAdminExam(exam)),
    versions: sortedVersions(exam.versions).map(toVersionRef),
  }
}

// ---------- Public reads (§38 public app; §14/§15 server-side scope) ----------

/** Country exam directory: ACTIVE exams of one ACTIVE country (§38). */
export async function getPublicExams(query: PublicExamListQuery): Promise<PublicExamListResult> {
  const { countryRow, country, languageCode } = await resolvePublicContext(query)

  const where: Prisma.ExamWhereInput = {
    countryId: countryRow.id,
    status: 'ACTIVE',
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { code: { contains: query.q, mode: 'insensitive' } },
            { organiser: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    db.exam.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { versions: { include: { _count: { select: { syllabusNodes: true, examMappings: true } } } } },
    }),
    db.exam.count({ where }),
  ])

  return {
    exams: rows.map((row) =>
      toPublicSummary(row, countryRow.isoCode, examPath(country, languageCode, row.slug))
    ),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    country: { isoCode: countryRow.isoCode, name: country.name },
  }
}

/** Public exam detail by slug or id — ACTIVE exams only, own country only. */
export async function getPublicExam(
  ref: string,
  input: { country?: string; language?: string }
): Promise<PublicExamDetail> {
  const exam = await findExam(ref)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')

  const { countryRow, country, languageCode } = await resolvePublicContext(input)
  // §14: an exam is only visible inside its owning country's context.
  if (exam.countryId !== countryRow.id || exam.status !== 'ACTIVE') {
    throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  }

  return {
    ...toPublicSummary(exam, countryRow.isoCode, examPath(country, languageCode, exam.slug)),
    versions: sortedVersions(exam.versions).map(toVersionRef),
    language: {
      code: languageCode,
      name: country.defaultLanguage.code === languageCode
        ? country.defaultLanguage.name
        : country.languages.find((l) => l.code === languageCode)?.name ?? languageCode,
      nativeName: country.languages.find((l) => l.code === languageCode)?.nativeName ?? null,
    },
  }
}

// ---------- Admin reads (§38 editorial console; §20 scope on every call) ----------

export async function getAdminExams(
  actor: Actor,
  query: AdminExamListQuery
): Promise<AdminExamListResult> {
  assertCan(actor, 'exam:manage')

  // Exams are ALWAYS country-owned (§14) — a Country Admin's board is their
  // country only (no global fallback, unlike knowledge units).
  let countryId: string | undefined
  if (actor.role === 'COUNTRY_ADMIN') {
    if (!actor.countryId) throw new ExamError('COUNTRY_MISMATCH', 'No country scope on your account')
    countryId = actor.countryId
  } else if (query.country) {
    // Admin may inspect ANY existing country — including COMING_SOON markets
    // (exam config precedes market launch; the public surface enforces ACTIVE).
    const country = await db.country.findUnique({
      where: { isoCode: query.country.toUpperCase() },
      select: { id: true },
    })
    if (!country) throw new ExamError('COUNTRY_NOT_FOUND', `Unknown country "${query.country}"`)
    countryId = country.id
  }

  const where: Prisma.ExamWhereInput = {
    ...(countryId ? { countryId } : {}),
    ...(query.status ? { status: query.status } : {}),
    ...(query.level ? { level: query.level } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { code: { contains: query.q, mode: 'insensitive' } },
            { organiser: { contains: query.q, mode: 'insensitive' } },
            { slug: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  }

  const [rows, total] = await Promise.all([
    db.exam.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { versions: { include: { _count: { select: { syllabusNodes: true, examMappings: true } } } } },
    }),
    db.exam.count({ where }),
  ])

  const exams: AdminExam[] = []
  for (const row of rows) exams.push(await toAdminExam(row))

  return {
    exams,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function getAdminExam(actor: Actor, id: string): Promise<AdminExamDetail> {
  assertCan(actor, 'exam:manage')
  const exam = await findExam(id)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'read')
  return toAdminDetail(exam)
}

// ---------- Admin writes: exam ----------

export async function createExam(
  actor: Actor,
  input: CreateExamInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamDetail> {
  assertCan(actor, 'exam:manage')

  // §14: the owning country — explicit, never inferred. Admin operations may
  // target any EXISTING country (COMING_SOON included — exam configuration
  // precedes market launch, P9); the public surface enforces ACTIVE (§15).
  const country = await db.country.findUnique({
    where: { isoCode: input.country.toUpperCase() },
    select: { id: true, isoCode: true, name: true },
  })
  if (!country) {
    throw new ExamError('COUNTRY_NOT_FOUND', `Unknown country "${input.country}"`)
  }
  if (actor.role === 'COUNTRY_ADMIN' && country.id !== actor.countryId) {
    void recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.examDenied,
      objectType: AUDIT_OBJECT_TYPES.exam,
      objectLabel: input.slug,
      metadata: { attemptedOperation: 'create', reason: 'COUNTRY_MISMATCH', requestedCountry: input.country },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new ExamError('COUNTRY_MISMATCH', 'You can only create exams for your own country')
  }

  // Stable identity (§37): unique slug globally, unique code within country.
  const slugTaken = await db.exam.findUnique({ where: { slug: input.slug }, select: { id: true } })
  if (slugTaken) throw new ExamError('SLUG_TAKEN', `Slug "${input.slug}" is already in use`)
  const codeTaken = await db.exam.findFirst({
    where: { countryId: country.id, code: input.code },
    select: { id: true },
  })
  if (codeTaken) {
    throw new ExamError(
      'CODE_TAKEN',
      `Code "${input.code}" is already used by another exam in ${country.name}`
    )
  }

  const created = await db.exam.create({
    data: {
      slug: input.slug,
      code: input.code,
      name: input.name,
      organiser: input.organiser,
      level: input.level,
      status: 'DRAFT',
      countryId: country.id,
      description: input.description ?? null,
      notes: input.notes ?? null,
      createdById: actor.userId,
    },
    include: { versions: { include: { _count: { select: { syllabusNodes: true, examMappings: true } } } } },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examCreate,
    objectType: AUDIT_OBJECT_TYPES.exam,
    objectId: created.id,
    objectLabel: created.slug,
    before: null,
    after: examSnapshot(created),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminDetail(created)
}

export async function updateExam(
  actor: Actor,
  id: string,
  input: UpdateExamInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamDetail> {
  const exam = await findExam(id)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'update', meta)

  const editability = EXAM_EDITABILITY[exam.status as ExamStatusPublic]
  if (editability === 'none') {
    throw new ExamError('STATE_LOCKED', 'Retired exams are read-only (§36)')
  }
  // slug/code/country are immutable identity — not in the update schema at all.

  const updated = await db.exam.update({
    where: { id: exam.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.organiser !== undefined ? { organiser: input.organiser } : {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
    include: { versions: { include: { _count: { select: { syllabusNodes: true, examMappings: true } } } } },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examUpdate,
    objectType: AUDIT_OBJECT_TYPES.exam,
    objectId: exam.id,
    objectLabel: exam.slug,
    before: examSnapshot(exam),
    after: examSnapshot(updated),
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminDetail(updated)
}

export async function transitionExam(
  actor: Actor,
  id: string,
  input: ExamTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamDetail> {
  const exam = await findExam(id)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'transition', meta)

  const from = exam.status as ExamStatusPublic
  const to = EXAM_TRANSITIONS[from][input.action]
  if (!to) {
    throw new ExamError(
      'INVALID_TRANSITION',
      `"${input.action}" is not a valid transition from ${from}`
    )
  }
  if (REASON_REQUIRED_TRANSITIONS.has(input.action) && !input.reason?.trim()) {
    throw new ExamError('REASON_REQUIRED', 'A reason is required to retire an exam (§36 provenance)')
  }

  const updated = await db.exam.update({
    where: { id: exam.id },
    data: { status: to },
    include: { versions: { include: { _count: { select: { syllabusNodes: true, examMappings: true } } } } },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examTransition,
    objectType: AUDIT_OBJECT_TYPES.exam,
    objectId: exam.id,
    objectLabel: exam.slug,
    before: { status: from },
    after: { status: to },
    metadata: { action: input.action, reason: input.reason ?? null },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminDetail(updated)
}

// ---------- Admin writes: versions (§36 append-only history) ----------

/**
 * Creates a new ExamVersion — §36: "Exam syllabus changes create a new
 * ExamVersion." The new window must not overlap any existing window; the
 * currently OPEN version (effectiveTo null) is auto-closed at
 * (newFrom − 1 day). Windows are immutable afterwards.
 */
export async function createExamVersion(
  actor: Actor,
  examId: string,
  input: CreateExamVersionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamDetail> {
  const exam = await findExam(examId)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'version.create', meta)

  if (exam.status === 'RETIRED') {
    throw new ExamError('STATE_LOCKED', 'Retired exams are read-only — no new versions (§36)')
  }

  const from = input.effectiveFrom ? utcDay(input.effectiveFrom) : utcDay(new Date())
  const to = input.effectiveTo ? utcDay(input.effectiveTo) : null
  if (to && to < from) {
    throw new ExamError('VERSION_WINDOW_INVALID', 'effectiveTo must not be before effectiveFrom')
  }

  const versions = exam.versions
  const open = versions.find((version) => version.effectiveTo == null) ?? null
  if (open && from.getTime() <= open.effectiveFrom.getTime()) {
    throw new ExamError(
      'VERSION_WINDOW_INVALID',
      'The new version must start after the currently open version begins'
    )
  }
  // Overlap against every version EXCEPT the open one (it gets auto-closed).
  for (const version of versions) {
    if (open && version.id === open.id) continue
    if (windowsOverlap(from, to, version.effectiveFrom, version.effectiveTo)) {
      throw new ExamError(
        'VERSION_OVERLAP',
        `The window overlaps version "${version.label}" (${version.effectiveFrom.toISOString().slice(0, 10)} → ${version.effectiveTo?.toISOString().slice(0, 10) ?? 'open'}) — version windows never overlap (§36)`
      )
    }
  }

  // Close the open predecessor at (newFrom − 1 day) — the supersede step.
  if (open) {
    await db.examVersion.update({
      where: { id: open.id },
      data: { effectiveTo: addDays(from, -1) },
    })
  }

  const created = await db.examVersion.create({
    data: {
      examId: exam.id,
      label: input.label,
      effectiveFrom: from,
      effectiveTo: to,
      source: input.source ?? null,
      notes: input.notes ?? null,
      createdById: actor.userId,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examVersionCreate,
    objectType: AUDIT_OBJECT_TYPES.examVersion,
    objectId: created.id,
    objectLabel: `${exam.slug} · ${created.label}`,
    before: open ? versionSnapshot(open) : null,
    after: versionSnapshot(created),
    metadata: {
      examSlug: exam.slug,
      supersededOpenVersion: open
        ? { id: open.id, label: open.label, closedAt: addDays(from, -1).toISOString() }
        : null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const fresh = await findExam(exam.slug)
  return toAdminDetail(fresh ?? exam)
}

/** Metadata-only edits (label/source/notes) — windows are immutable (§36). */
export async function updateExamVersion(
  actor: Actor,
  examId: string,
  versionId: string,
  input: UpdateExamVersionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminExamDetail> {
  const exam = await findExam(examId)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'version.update', meta)

  const version = exam.versions.find((row) => row.id === versionId)
  if (!version) {
    throw new ExamError('VERSION_NOT_FOUND', 'Exam version not found on this exam')
  }

  await db.examVersion.update({
    where: { id: version.id },
    data: {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examVersionUpdate,
    objectType: AUDIT_OBJECT_TYPES.examVersion,
    objectId: version.id,
    objectLabel: `${exam.slug} · ${version.label}`,
    before: versionSnapshot(version),
    after: {
      label: input.label ?? version.label,
      source: input.source !== undefined ? input.source : version.source,
      notes: input.notes !== undefined ? input.notes : version.notes,
    },
    metadata: { examSlug: exam.slug, windowImmutable: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const fresh = await findExam(exam.slug)
  return toAdminDetail(fresh ?? exam)
}

/**
 * Removes a version as a CORRECTION — allowed only when the version never
 * entered history: it must still be pre-effective (future start), be the
 * latest, and carry no references (SyllabusNode/ExamMapping guards land in
 * P3-S2/S3 — versions hold none yet). If it had auto-closed a predecessor,
 * that predecessor is reopened. §36 history is otherwise append-only.
 */
export async function removeExamVersion(
  actor: Actor,
  examId: string,
  versionId: string,
  meta: AuditRequestMeta = {}
): Promise<AdminExamDetail> {
  const exam = await findExam(examId)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'version.remove', meta)

  const version = exam.versions.find((row) => row.id === versionId)
  if (!version) {
    throw new ExamError('VERSION_NOT_FOUND', 'Exam version not found on this exam')
  }
  if (version.effectiveFrom.getTime() <= Date.now()) {
    throw new ExamError(
      'VERSION_ALREADY_EFFECTIVE',
      'Only future-dated versions can be removed — this one is already (or was) in effect (§36 append-only history)'
    )
  }
  const latest = sortedVersions(exam.versions)[0]
  if (!latest || latest.id !== version.id) {
    throw new ExamError('VERSION_NOT_LATEST', 'Only the latest version can be removed as a correction')
  }
  // P3-S2/S3 guards: a version carrying SyllabusNodes OR ExamMappings is
  // referenced — it holds staged/historical structure and is therefore §36
  // history. The pre-effective correction path only exists for unreferenced
  // versions (a mapping-bearing tree must be unmapped node by node first —
  // removing mappings is an explicit, audited editorial act).
  const nodeCount = await db.syllabusNode.count({ where: { examVersionId: version.id } })
  if (nodeCount > 0) {
    throw new ExamError(
      'VERSION_REFERENCED',
      `This version carries ${nodeCount} syllabus node${nodeCount === 1 ? '' : 's'} — clear its tree first (a referenced version is §36 history)`
    )
  }
  const mappingCount = await db.examMapping.count({ where: { examVersionId: version.id } })
  if (mappingCount > 0) {
    throw new ExamError(
      'VERSION_REFERENCED',
      `This version carries ${mappingCount} exam mapping${mappingCount === 1 ? '' : 's'} — remove them first (a referenced version is §36 history)`
    )
  }

  // Reopen the predecessor this version had auto-closed (deterministic: the
  // one whose effectiveTo is exactly newFrom − 1 day).
  const closedAt = addDays(version.effectiveFrom, -1)
  const predecessor = exam.versions.find(
    (row) => row.id !== version.id && row.effectiveTo?.getTime() === closedAt.getTime()
  )

  if (predecessor) {
    await db.examVersion.update({
      where: { id: predecessor.id },
      data: { effectiveTo: null },
    })
  }

  await db.examVersion.delete({ where: { id: version.id } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examVersionRemove,
    objectType: AUDIT_OBJECT_TYPES.examVersion,
    objectId: version.id,
    objectLabel: `${exam.slug} · ${version.label}`,
    before: versionSnapshot(version),
    after: null,
    metadata: {
      examSlug: exam.slug,
      reason: 'pre-effective correction',
      reopenedPredecessor: predecessor
        ? { id: predecessor.id, label: predecessor.label }
        : null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  const fresh = await findExam(exam.slug)
  return toAdminDetail(fresh ?? exam)
}
