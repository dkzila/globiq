/**
 * GlobIQ — Knowledge: domain service
 * Master Plan §6 (KnowledgeUnit row), §7 (canonical semantic record — stored
 * once; representations arrive P2-S2+), §11 (dedup strictly by canonical
 * identity), §14/§15 (explicit country scope, enforced server-side on every
 * query — never by hiding UI), §22 (knowledge page contract), §23 (content
 * types), §36 (lifecycle + no silent edits: VERIFIED body locked, corrections
 * go through the OUTDATED cycle; audit diff is the interim history until
 * ContentItem revisions land in P2-S2), §37 (service-boundary authorization,
 * pagination, deterministic sorting), §38 (scoped admin), §43 (P2-S1 scope).
 *
 * Caching note (§29): unlike the taxonomy snapshot (small, read on every
 * page), KnowledgeUnit volume grows without bound — reads use indexed DB
 * queries (status/topic/scope+country/type). A cache abstraction is
 * introduced when measured requirements justify it, not before.
 */
import type { Prisma, KnowledgeUnit } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import { onUnitChanged } from '@/modules/search'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  findActiveCountryByIso,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import {
  getPublicTopic,
  getTopicIdentity,
  TaxonomyError,
  type TopicIdentity,
} from '@/modules/taxonomy'

import type {
  AdminKnowledgeListResult,
  AdminKnowledgeUnit,
  KnowledgeEditability,
  KnowledgeStatusPublic,
  KnowledgeTransitionAction,
  KnowledgeValidity,
  PublicKnowledgeListResult,
  PublicKnowledgeUnitDetail,
  PublicKnowledgeUnitSummary,
} from './types'
import { KNOWLEDGE_EDITABILITY, KNOWLEDGE_TRANSITIONS } from './types'
import type {
  AdminKnowledgeListQuery,
  CreateKnowledgeUnitInput,
  KnowledgeTransitionInput,
  PublicKnowledgeListQuery,
  UpdateKnowledgeUnitInput,
} from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type KnowledgeErrorCode =
  | 'KU_NOT_FOUND'
  | 'KU_NOT_VISIBLE'
  | 'SLUG_TAKEN'
  | 'DUPLICATE_IN_TOPIC'
  | 'TOPIC_NOT_FOUND'
  | 'TOPIC_NOT_ATTACHABLE'
  | 'TOPIC_SCOPE_MISMATCH'
  | 'COUNTRY_NOT_FOUND'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_UNITS_ADMIN_ONLY'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'REASON_REQUIRED'
  | 'VALIDITY_RANGE_INVALID'

const ERROR_STATUS: Record<KnowledgeErrorCode, number> = {
  KU_NOT_FOUND: 404,
  KU_NOT_VISIBLE: 404,
  SLUG_TAKEN: 409,
  DUPLICATE_IN_TOPIC: 409,
  TOPIC_NOT_FOUND: 404,
  TOPIC_NOT_ATTACHABLE: 400,
  TOPIC_SCOPE_MISMATCH: 400,
  COUNTRY_NOT_FOUND: 404,
  COUNTRY_MISMATCH: 403,
  GLOBAL_UNITS_ADMIN_ONLY: 403,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  REASON_REQUIRED: 400,
  VALIDITY_RANGE_INVALID: 400,
}

export class KnowledgeError extends Error {
  readonly code: KnowledgeErrorCode
  readonly status: number

  constructor(code: KnowledgeErrorCode, message: string) {
    super(message)
    this.name = 'KnowledgeError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown KnowledgeError to envelope data (§37); null for others. */
export function toKnowledgeErrorResponse(
  error: unknown
): { message: string; code: KnowledgeErrorCode; status: number } | null {
  if (error instanceof KnowledgeError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

type UnitRow = KnowledgeUnit

function validityOf(unit: UnitRow): KnowledgeValidity {
  const now = Date.now()
  const fromOk = !unit.validFrom || unit.validFrom.getTime() <= now
  const untilOk = !unit.validUntil || unit.validUntil.getTime() >= now
  return {
    from: unit.validFrom?.toISOString() ?? null,
    until: unit.validUntil?.toISOString() ?? null,
    currentlyValid: fromOk && untilOk,
  }
}

/** Audit/admin snapshot of a unit (§13 topic ref included; audit redaction
 * truncates long bodies automatically). */
function snapshotOf(unit: UnitRow, topic: TopicIdentity | null) {
  return {
    slug: unit.slug,
    canonicalName: unit.canonicalName,
    canonicalSummary: unit.canonicalSummary,
    canonicalBody: unit.canonicalBody,
    type: unit.type,
    status: unit.status,
    difficulty: unit.difficulty,
    scope: unit.scope,
    countryIso: topic && unit.scope === 'COUNTRY' ? topic.countryIso : null,
    topicSlug: topic?.slug ?? null,
    validFrom: unit.validFrom?.toISOString() ?? null,
    validUntil: unit.validUntil?.toISOString() ?? null,
    orderIndex: unit.orderIndex,
    notes: unit.notes,
  }
}

/** Target for the shared permission layer: null countryId = global unit. */
function targetOf(unit: UnitRow): { countryId: string | null } {
  return { countryId: unit.scope === 'COUNTRY' ? unit.countryId : null }
}

async function loadTopicIdentity(topicId: string): Promise<TopicIdentity | null> {
  return getTopicIdentity(topicId)
}

/** Object-level permission check + denial audit (§20 signal). */
function assertCanManageUnit(
  actor: Actor,
  unit: UnitRow,
  topic: TopicIdentity | null,
  operation: string,
  meta?: AuditRequestMeta
): void {
  if (can(actor, 'knowledge:manage', targetOf(unit))) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.knowledgeDenied,
    objectType: AUDIT_OBJECT_TYPES.knowledgeUnit,
    objectId: unit.id,
    objectLabel: unit.slug,
    before: { slug: unit.slug, status: unit.status, scope: unit.scope },
    metadata: {
      attemptedOperation: operation,
      reason: denialReason(actor, unit),
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  if (actor.role === 'COUNTRY_ADMIN') {
    if (unit.scope === 'GLOBAL') {
      throw new KnowledgeError(
        'GLOBAL_UNITS_ADMIN_ONLY',
        'Country admins cannot modify global knowledge units'
      )
    }
    throw new KnowledgeError(
      'COUNTRY_MISMATCH',
      'You can only manage knowledge units for your own country'
    )
  }
  throw new KnowledgeError('COUNTRY_MISMATCH', 'You do not have permission to manage this unit')
}

function denialReason(actor: Actor, unit: UnitRow): string {
  if (actor.role === 'COUNTRY_ADMIN') {
    return unit.scope === 'GLOBAL' ? 'GLOBAL_UNITS_ADMIN_ONLY' : 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

/** Admin read access (taxonomy parity): ADMIN sees all; COUNTRY_ADMIN sees
 * global (read-only) + own-country units. */
function canReadUnit(actor: Actor, unit: UnitRow): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN') {
    return unit.scope === 'GLOBAL' || unit.countryId === actor.countryId
  }
  return false
}

async function toAdminUnit(actor: Actor, unit: UnitRow): Promise<AdminKnowledgeUnit> {
  const topic = await loadTopicIdentity(unit.topicId)
  const editability = KNOWLEDGE_EDITABILITY[unit.status as KnowledgeStatusPublic]
  const canManage = can(actor, 'knowledge:manage', targetOf(unit))
  return {
    id: unit.id,
    slug: unit.slug,
    canonicalName: unit.canonicalName,
    canonicalSummary: unit.canonicalSummary,
    canonicalBody: unit.canonicalBody,
    type: unit.type as AdminKnowledgeUnit['type'],
    status: unit.status as KnowledgeStatusPublic,
    difficulty: unit.difficulty as AdminKnowledgeUnit['difficulty'],
    scope: unit.scope as AdminKnowledgeUnit['scope'],
    countryIso:
      unit.scope === 'COUNTRY' && topic ? topic.countryIso : unit.scope === 'COUNTRY' ? '??' : null,
    topic: topic
      ? { id: topic.id, slug: topic.slug, canonicalName: topic.canonicalName, status: topic.status }
      : { id: unit.topicId, slug: unit.slug, canonicalName: 'Unknown topic', status: 'RETIRED' },
    validity: validityOf(unit),
    notes: unit.notes,
    orderIndex: unit.orderIndex,
    createdAt: unit.createdAt.toISOString(),
    updatedAt: unit.updatedAt.toISOString(),
    canEdit: canManage && editability !== 'none',
    editability,
    allowedTransitions: Object.keys(
      KNOWLEDGE_TRANSITIONS[unit.status as KnowledgeStatusPublic]
    ) as KnowledgeTransitionAction[],
  }
}

function toPublicSummary(unit: UnitRow): PublicKnowledgeUnitSummary {
  return {
    id: unit.id,
    slug: unit.slug,
    canonicalName: unit.canonicalName,
    canonicalSummary: unit.canonicalSummary,
    type: unit.type as PublicKnowledgeUnitSummary['type'],
    difficulty: unit.difficulty as PublicKnowledgeUnitSummary['difficulty'],
    scope: unit.scope as PublicKnowledgeUnitSummary['scope'],
    countryIso: null, // filled by the caller from the topic identity (no join needed)
    orderIndex: unit.orderIndex,
    validity: validityOf(unit),
    updatedAt: unit.updatedAt.toISOString(),
  }
}

/** Public scope rule (§14/§15): GLOBAL units are visible everywhere;
 * COUNTRY units only in their own country. */
function isVisibleInCountry(unit: UnitRow, countryId: string): boolean {
  if (unit.status !== 'VERIFIED') return false
  if (unit.scope === 'GLOBAL') return true
  return unit.countryId === countryId
}

async function resolveCountryId(input: { country?: string }): Promise<{
  isoCode: string
  countryId: string
}> {
  // Unknown/inactive countries must surface as clean 404s, not 500s (§37 —
  // explicit validation errors on every public path).
  try {
    const resolution = await resolveLocaleContext(input)
    const country = await findActiveCountryByIso(resolution.country.isoCode)
    if (!country) {
      throw new KnowledgeError('COUNTRY_NOT_FOUND', `Country "${resolution.country.isoCode}" is not available`)
    }
    return { isoCode: country.isoCode, countryId: country.id }
  } catch (error) {
    if (error instanceof KnowledgeError) throw error
    if (error instanceof LocaleError) {
      throw new KnowledgeError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }
}

// ---------- Public reads ----------

/** Lists VERIFIED units under one visible topic (§5 hierarchy). */
export async function getPublicKnowledgeUnits(
  query: PublicKnowledgeListQuery
): Promise<PublicKnowledgeListResult> {
  // Resolve the country first so an unknown/inactive country surfaces as a
  // clean 404 (§37) — the taxonomy's LocaleError must never leak as a 500.
  const { countryId } = await resolveCountryId({ country: query.country })

  // Topic visibility (ACTIVE chain + country scope) is the taxonomy's call —
  // a unit can never be more visible than its canonical topic.
  let topicDetail
  try {
    topicDetail = await getPublicTopic(query.topic, {
      country: query.country,
      language: query.language,
    })
  } catch (error) {
    if (error instanceof TaxonomyError) {
      throw new KnowledgeError(
        'KU_NOT_VISIBLE',
        `No knowledge is available for this topic in the selected country`
      )
    }
    throw error
  }

  const where: Prisma.KnowledgeUnitWhereInput = {
    topicId: topicDetail.node.id,
    status: 'VERIFIED',
    OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId }],
    ...(query.type ? { type: query.type } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
  }

  const [rows, total] = await Promise.all([
    db.knowledgeUnit.findMany({
      where,
      orderBy: [{ orderIndex: 'asc' }, { canonicalName: 'asc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.knowledgeUnit.count({ where }),
  ])

  const topicIdentity = await loadTopicIdentity(topicDetail.node.id)
  const units = rows.map((row) => ({
    ...toPublicSummary(row),
    countryIso: row.scope === 'COUNTRY' ? topicIdentity?.countryIso ?? null : null,
  }))

  return {
    units,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    topic: {
      slug: topicDetail.node.slug,
      canonicalName: topicDetail.node.canonicalName,
      label: topicDetail.node.label,
      labelLanguage: topicDetail.node.labelLanguage,
      path: topicDetail.path,
    },
  }
}

/** Public detail by slug or id — VERIFIED, country-visible, topic-visible. */
export async function getPublicKnowledgeUnit(
  ref: string,
  input: { country?: string; language?: string }
): Promise<PublicKnowledgeUnitDetail> {
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
  if (!unit) throw new KnowledgeError('KU_NOT_FOUND', 'Knowledge unit not found')

  const { countryId } = await resolveCountryId({ country: input.country })
  if (!isVisibleInCountry(unit, countryId)) {
    throw new KnowledgeError('KU_NOT_FOUND', 'Knowledge unit not found')
  }

  // Topic must be publicly visible in the same country (ACTIVE chain, §13).
  let topicDetail
  try {
    topicDetail = await getPublicTopic(unit.topicId, {
      country: input.country,
      language: input.language,
    })
  } catch (error) {
    if (error instanceof TaxonomyError) {
      throw new KnowledgeError('KU_NOT_VISIBLE', 'This knowledge unit is not available in the selected country')
    }
    throw error
  }

  const topicIdentity = await loadTopicIdentity(unit.topicId)
  return {
    ...toPublicSummary(unit),
    countryIso: unit.scope === 'COUNTRY' ? topicIdentity?.countryIso ?? null : null,
    canonicalBody: unit.canonicalBody,
    createdAt: unit.createdAt.toISOString(),
    topic: {
      slug: topicDetail.node.slug,
      canonicalName: topicDetail.node.canonicalName,
      label: topicDetail.node.label,
      labelLanguage: topicDetail.node.labelLanguage,
      path: topicDetail.path,
    },
  }
}

// ---------- Admin reads ----------

export async function getAdminKnowledgeUnits(
  actor: Actor,
  query: AdminKnowledgeListQuery
): Promise<AdminKnowledgeListResult> {
  assertCan(actor, 'knowledge:manage')

  // COUNTRY_ADMIN: global (read-only) + own-country units — taxonomy parity.
  const countryFilter: Prisma.KnowledgeUnitWhereInput['OR'] =
    actor.role === 'ADMIN'
      ? undefined
      : [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }]

  let topicId: string | undefined
  if (query.topic) {
    const topic = await getTopicIdentity(query.topic)
    if (!topic) throw new KnowledgeError('TOPIC_NOT_FOUND', `Unknown topic "${query.topic}"`)
    topicId = topic.id
  }

  const where: Prisma.KnowledgeUnitWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(topicId ? { topicId } : {}),
    ...(query.q
      ? {
          OR: [
            { canonicalName: { contains: query.q, mode: 'insensitive' } },
            { slug: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
    ...(countryFilter ? { OR: countryFilter } : {}),
  }

  const [rows, total] = await Promise.all([
    db.knowledgeUnit.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.knowledgeUnit.count({ where }),
  ])

  const units: AdminKnowledgeUnit[] = []
  for (const row of rows) {
    if (canReadUnit(actor, row)) units.push(await toAdminUnit(actor, row))
  }

  return {
    units,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function getAdminKnowledgeUnit(actor: Actor, id: string): Promise<AdminKnowledgeUnit> {
  assertCan(actor, 'knowledge:manage')
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(id) ? { id } : { slug: id.toLowerCase() },
  })
  if (!unit) throw new KnowledgeError('KU_NOT_FOUND', 'Knowledge unit not found')
  if (!canReadUnit(actor, unit)) {
    throw new KnowledgeError('COUNTRY_MISMATCH', 'You can only view global units and your own country units')
  }
  return toAdminUnit(actor, unit)
}

// ---------- Admin writes ----------

export async function createKnowledgeUnit(
  actor: Actor,
  input: CreateKnowledgeUnitInput,
  meta: AuditRequestMeta = {}
): Promise<AdminKnowledgeUnit> {
  assertCan(actor, 'knowledge:manage')

  // Canonical topic (§13) — must exist and be attachable (ACTIVE).
  const topic = await getTopicIdentity(input.topic)
  if (!topic) throw new KnowledgeError('TOPIC_NOT_FOUND', `Unknown topic "${input.topic}"`)
  if (topic.status !== 'ACTIVE') {
    throw new KnowledgeError(
      'TOPIC_NOT_ATTACHABLE',
      `Topic "${topic.slug}" is ${topic.status.toLowerCase()} — knowledge units attach only to active topics`
    )
  }

  // Country scope resolution (§14: explicit, never inferred — except a country
  // admin's own home country, which may be implied like taxonomy P1-S4).
  let countryId: string | null = null
  if (input.scope === 'COUNTRY') {
    if (input.country) {
      const country = await findActiveCountryByIso(input.country)
      if (!country) throw new KnowledgeError('COUNTRY_NOT_FOUND', `Unknown or inactive country "${input.country}"`)
      if (actor.role === 'COUNTRY_ADMIN' && country.id !== actor.countryId) {
        await noteDenied(actor, 'create', 'COUNTRY_MISMATCH', null, input.slug, meta)
        throw new KnowledgeError(
          'COUNTRY_MISMATCH',
          'You can only create knowledge units for your own country'
        )
      }
      countryId = country.id
    } else if (actor.role === 'COUNTRY_ADMIN' && actor.countryId) {
      countryId = actor.countryId
    } else {
      throw new KnowledgeError('COUNTRY_NOT_FOUND', 'Country is required for country-scoped units')
    }
  } else if (actor.role === 'COUNTRY_ADMIN') {
    await noteDenied(actor, 'create', 'GLOBAL_UNITS_ADMIN_ONLY', null, input.slug, meta)
    throw new KnowledgeError(
      'GLOBAL_UNITS_ADMIN_ONLY',
      'Country admins can only create country-scoped knowledge units'
    )
  }

  // Scope-vs-topic invariant: a unit under a country-scoped topic is that
  // country's knowledge (mirrors taxonomy containment rules, §13/§14).
  if (topic.scope === 'COUNTRY') {
    if (input.scope !== 'COUNTRY' || countryId !== topic.countryId) {
      throw new KnowledgeError(
        'TOPIC_SCOPE_MISMATCH',
        `Topic "${topic.slug}" is scoped to ${topic.countryIso} — units under it must share that country scope`
      )
    }
  }

  // Dedup by canonical identity (§11): one canonical name per topic; unique slug.
  const slugTaken = await db.knowledgeUnit.findUnique({ where: { slug: input.slug }, select: { id: true } })
  if (slugTaken) {
    throw new KnowledgeError('SLUG_TAKEN', `Slug "${input.slug}" is already in use`)
  }
  const nameTaken = await db.knowledgeUnit.findFirst({
    where: { topicId: topic.id, canonicalName: input.canonicalName },
    select: { id: true },
  })
  if (nameTaken) {
    throw new KnowledgeError(
      'DUPLICATE_IN_TOPIC',
      `A knowledge unit named "${input.canonicalName}" already exists under this topic — deduplication is by canonical identity (§11)`
    )
  }

  const created = await db.knowledgeUnit.create({
    data: {
      slug: input.slug,
      canonicalName: input.canonicalName,
      canonicalSummary: input.canonicalSummary ?? null,
      canonicalBody: input.canonicalBody,
      type: input.type,
      status: 'DRAFT',
      difficulty: input.difficulty,
      scope: input.scope,
      countryId,
      topicId: topic.id,
      validFrom: input.validFrom ?? null,
      validUntil: input.validUntil ?? null,
      notes: input.notes ?? null,
      orderIndex: input.orderIndex ?? 0,
      createdById: actor.userId,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.knowledgeUnitCreate,
    objectType: AUDIT_OBJECT_TYPES.knowledgeUnit,
    objectId: created.id,
    objectLabel: created.slug,
    after: snapshotOf(created, topic),
    metadata: { scope: input.scope, topicSlug: topic.slug },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17: keep the search index coherent with the lifecycle (no-op for
  // a DRAFT create; re-projects the moment a unit becomes public).
  await onUnitChanged(created.slug)

  return toAdminUnit(actor, created)
}

export async function updateKnowledgeUnit(
  actor: Actor,
  id: string,
  input: UpdateKnowledgeUnitInput,
  meta: AuditRequestMeta = {}
): Promise<AdminKnowledgeUnit> {
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(id) ? { id } : { slug: id.toLowerCase() },
  })
  if (!unit) throw new KnowledgeError('KU_NOT_FOUND', 'Knowledge unit not found')
  const topic = await loadTopicIdentity(unit.topicId)
  assertCanManageUnit(actor, unit, topic, 'update', meta)

  const editability = KNOWLEDGE_EDITABILITY[unit.status as KnowledgeStatusPublic]
  if (editability === 'none') {
    throw new KnowledgeError(
      'STATE_LOCKED',
      'Archived units are read-only (§36) — create a new unit if the knowledge is needed again'
    )
  }
  if (editability === 'metadata') {
    const contentFields = (['canonicalName', 'canonicalSummary', 'canonicalBody'] as const).filter(
      (field) => input[field] !== undefined
    )
    if (contentFields.length > 0) {
      throw new KnowledgeError(
        'STATE_LOCKED',
        'Verified units are locked (§36 — no silent edits). Flag the unit as outdated to open the correction cycle, then re-verify.'
      )
    }
  }

  // §11 dedup guard when the canonical name changes.
  if (input.canonicalName && input.canonicalName !== unit.canonicalName) {
    const nameTaken = await db.knowledgeUnit.findFirst({
      where: {
        topicId: unit.topicId,
        canonicalName: input.canonicalName,
        id: { not: unit.id },
      },
      select: { id: true },
    })
    if (nameTaken) {
      throw new KnowledgeError(
        'DUPLICATE_IN_TOPIC',
        `A knowledge unit named "${input.canonicalName}" already exists under this topic (§11)`
      )
    }
  }

  // Validity window re-check after merge (zod only sees the patch, not the merge).
  const validFrom = input.validFrom !== undefined ? input.validFrom : unit.validFrom
  const validUntil = input.validUntil !== undefined ? input.validUntil : unit.validUntil
  if (validFrom && validUntil && validUntil < validFrom) {
    throw new KnowledgeError('VALIDITY_RANGE_INVALID', 'validUntil must not be before validFrom')
  }

  const before = snapshotOf(unit, topic)
  const updated = await db.knowledgeUnit.update({
    where: { id: unit.id },
    data: {
      ...(input.canonicalName !== undefined ? { canonicalName: input.canonicalName } : {}),
      ...(input.canonicalSummary !== undefined ? { canonicalSummary: input.canonicalSummary ?? null } : {}),
      ...(input.canonicalBody !== undefined ? { canonicalBody: input.canonicalBody } : {}),
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      ...(input.validFrom !== undefined ? { validFrom: input.validFrom ?? null } : {}),
      ...(input.validUntil !== undefined ? { validUntil: input.validUntil ?? null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.knowledgeUnitUpdate,
    objectType: AUDIT_OBJECT_TYPES.knowledgeUnit,
    objectId: unit.id,
    objectLabel: unit.slug,
    before,
    after: snapshotOf(updated, topic),
    metadata: { changedFields: Object.keys(input) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17: canonical name/summary changes re-project the unit's documents.
  await onUnitChanged(updated.slug)

  return toAdminUnit(actor, updated)
}

export async function transitionKnowledgeUnit(
  actor: Actor,
  id: string,
  input: KnowledgeTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminKnowledgeUnit> {
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(id) ? { id } : { slug: id.toLowerCase() },
  })
  if (!unit) throw new KnowledgeError('KU_NOT_FOUND', 'Knowledge unit not found')
  const topic = await loadTopicIdentity(unit.topicId)
  assertCanManageUnit(actor, unit, topic, `transition:${input.action}`, meta)

  if (input.action === 'flag_outdated' && !input.reason?.trim()) {
    throw new KnowledgeError(
      'REASON_REQUIRED',
      'Flagging a verified unit as outdated requires a reason (§36 correction provenance)'
    )
  }

  const target =
    KNOWLEDGE_TRANSITIONS[unit.status as KnowledgeStatusPublic][input.action]
  if (!target) {
    throw new KnowledgeError(
      'INVALID_TRANSITION',
      `"${input.action}" is not a valid transition from ${unit.status}`
    )
  }

  const updated = await db.knowledgeUnit.update({
    where: { id: unit.id },
    data: { status: target },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.knowledgeUnitTransition,
    objectType: AUDIT_OBJECT_TYPES.knowledgeUnit,
    objectId: unit.id,
    objectLabel: unit.slug,
    before: { status: unit.status },
    after: { status: target },
    metadata: { action: input.action, reason: input.reason ?? null },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17/§36: a lifecycle transition changes public visibility — verify
  // adds the unit to the index, archive/outdated removes it.
  await onUnitChanged(updated.slug)

  return toAdminUnit(actor, updated)
}

/** Denial audit for create-level attempts (no unit row exists yet). */
async function noteDenied(
  actor: Actor,
  operation: string,
  reason: string,
  topic: TopicIdentity | null,
  slug: string | null,
  meta: AuditRequestMeta
): Promise<void> {
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.knowledgeDenied,
    objectType: AUDIT_OBJECT_TYPES.knowledgeUnit,
    objectId: null,
    objectLabel: slug,
    before: topic ? { topicSlug: topic.slug, scope: topic.scope } : null,
    metadata: { attemptedOperation: operation, reason },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
}
