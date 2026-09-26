/**
 * GlobIQ — Knowledge: ContentItem + revision domain service (P2-S2)
 * Master Plan §6 (ContentItem row), §7 (representation of a canonical record —
 * the fact is NEVER re-entered, only rendered), §19 (published content is
 * immutable at the revision level; corrections create new revisions), §22
 * (knowledge-page rendering layers), §23 (representation formats with
 * per-format rules), §25/§36 (corrections carry provenance — changeSummary —
 * and preserve previous versions; no silent edits), §35 (language exposure is
 * per-country, enforced server-side), §14/§15 (country scope inherited from
 * the KnowledgeUnit — a representation is never more visible than its
 * canonical record), §37 (service-boundary authorization, deterministic
 * ordering), §38 (scoped admin), §43 (P2-S2 scope).
 *
 * Architecture: title/body on ContentItem are the WORKING COPY (editorial
 * staging). Public reads ALWAYS serve the live ContentRevision snapshot — so
 * staged corrections are invisible until a new revision is published. The
 * full editorial workflow (review roles, SCHEDULED state) lands in P2-S4.
 *
 * Caching note (§29): same decision as KnowledgeUnit — indexed DB queries
 * now; no snapshot cache for unbounded content volume.
 */
import type { Prisma, KnowledgeUnit } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  findActiveLanguageByCode,
  getPublicCountry,
  isLanguageConfiguredForCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import { getPublicTopic, getTopicIdentity, TaxonomyError } from '@/modules/taxonomy'
import { onUnitChanged } from '@/modules/search'

import type {
  AdminContentItem,
  AdminContentListResult,
  AdminContentRevisionListResult,
  ContentFormatPublic,
  ContentRevisionRef,
  ContentStatusPublic,
  ContentTransitionAction,
  PublicContentItemDetail,
  PublicContentItemSummary,
  PublicContentListResult,
} from './content-types'
import { CONTENT_EDITABILITY, CONTENT_TRANSITIONS, PUBLISH_GATED_ACTIONS } from './content-types'
import { getPublicSourcesForItem } from './source-service'
import type {
  AdminContentListQuery,
  ContentTransitionInput,
  CreateContentItemInput,
  PublicContentListQuery,
  UpdateContentItemInput,
} from './content-validation'
import { bodyFitsFormat } from './content-validation'
import { wireContentWorkflow, type ContentWorkflowEvent } from '@/modules/editorial'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type ContentErrorCode =
  | 'CONTENT_NOT_FOUND'
  | 'CONTENT_NOT_VISIBLE'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_ARCHIVED'
  | 'UNIT_NOT_VERIFIED'
  | 'REPRESENTATION_EXISTS'
  | 'LANGUAGE_NOT_FOUND'
  | 'LANGUAGE_NOT_AVAILABLE'
  | 'INVALID_TRANSITION'
  | 'STATE_LOCKED'
  | 'CHANGE_SUMMARY_REQUIRED'
  | 'NO_CHANGES'
  | 'FORMAT_BODY_INVALID'
  | 'COUNTRY_MISMATCH'
  | 'GLOBAL_CONTENT_ADMIN_ONLY'
  | 'LANGUAGE_SCOPE'
  | 'PUBLISH_NOT_PERMITTED'
  | 'SCHEDULED_FOR_REQUIRED'

const ERROR_STATUS: Record<ContentErrorCode, number> = {
  CONTENT_NOT_FOUND: 404,
  CONTENT_NOT_VISIBLE: 404,
  UNIT_NOT_FOUND: 404,
  UNIT_ARCHIVED: 400,
  UNIT_NOT_VERIFIED: 409,
  REPRESENTATION_EXISTS: 409,
  LANGUAGE_NOT_FOUND: 404,
  LANGUAGE_NOT_AVAILABLE: 400,
  INVALID_TRANSITION: 409,
  STATE_LOCKED: 409,
  CHANGE_SUMMARY_REQUIRED: 400,
  NO_CHANGES: 409,
  FORMAT_BODY_INVALID: 400,
  COUNTRY_MISMATCH: 403,
  GLOBAL_CONTENT_ADMIN_ONLY: 403,
  LANGUAGE_SCOPE: 403,
  PUBLISH_NOT_PERMITTED: 403,
  SCHEDULED_FOR_REQUIRED: 400,
}

export class ContentError extends Error {
  readonly code: ContentErrorCode
  readonly status: number

  constructor(code: ContentErrorCode, message: string) {
    super(message)
    this.name = 'ContentError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown ContentError to envelope data (§37); null for others. */
export function toContentErrorResponse(
  error: unknown
): { message: string; code: ContentErrorCode; status: number } | null {
  if (error instanceof ContentError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

type ItemRow = Prisma.ContentItemGetPayload<{
  include: {
    knowledgeUnit: true
    language: true
    publishedRevision: { include: { publishedBy: true } }
    _count: { select: { revisions: true; sourceLinks: true } }
  }
}>

/** The provenance-bearing include used by every item read (§24). */
const ITEM_INCLUDE = {
  knowledgeUnit: true,
  language: true,
  publishedRevision: { include: { publishedBy: true } },
  _count: { select: { revisions: true, sourceLinks: true } },
} satisfies Prisma.ContentItemInclude

async function loadUnitByRef(ref: string): Promise<KnowledgeUnit | null> {
  return db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
}

async function loadItem(id: string): Promise<ItemRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.contentItem.findUnique({
    where: { id },
    include: ITEM_INCLUDE,
  })
}

/**
 * A representation's permission target: the OWNING unit's country scope (§14)
 * plus the item's language (the §20 WRITER language-scope dimension — ignored
 * by roles without a language scope).
 */
function targetOfUnit(
  unit: KnowledgeUnit,
  languageId?: string | null
): { countryId: string | null; languageId?: string | null } {
  return {
    countryId: unit.scope === 'COUNTRY' ? unit.countryId : null,
    ...(languageId !== undefined ? { languageId } : {}),
  }
}

/** The §19 workflow event payload for an item (task wiring). */
function workflowItemOf(item: ItemRow): ContentWorkflowEvent['item'] {
  const unit = item.knowledgeUnit
  return {
    id: item.id,
    unitSlug: unit.slug,
    countryId: unit.scope === 'COUNTRY' ? unit.countryId : null,
    languageId: item.languageId,
    languageCode: item.language.code,
    format: item.format,
    title: item.title,
  }
}

/** Working-copy snapshot for audit before/after (redaction truncates bodies). */
function snapshotOf(item: ItemRow) {
  return {
    unitSlug: item.knowledgeUnit.slug,
    languageCode: item.language.code,
    format: item.format,
    status: item.status,
    title: item.title,
    body: item.body,
    aiAssisted: item.aiAssisted,
    liveRevision: item.publishedRevision
      ? { number: item.publishedRevision.revisionNumber, title: item.publishedRevision.title }
      : null,
  }
}

/** Object-level permission check + denial audit (§20 signal — KU pattern). */
function assertCanManageContent(
  actor: Actor,
  item: ItemRow,
  operation: string,
  meta?: AuditRequestMeta
): void {
  if (can(actor, 'content:manage', targetOfUnit(item.knowledgeUnit, item.languageId))) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentDenied,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
    before: { status: item.status, unitScope: item.knowledgeUnit.scope },
    metadata: {
      attemptedOperation: operation,
      reason: contentDenialReason(actor, item.knowledgeUnit, item.languageId),
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (item.knowledgeUnit.scope === 'GLOBAL') {
      throw new ContentError(
        'GLOBAL_CONTENT_ADMIN_ONLY',
        'Country-scoped staff cannot manage representations of global knowledge units'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      item.languageId !== actor.languageScopeId
    ) {
      throw new ContentError(
        'LANGUAGE_SCOPE',
        'This representation is outside your language scope (§20 explicit staff scopes)'
      )
    }
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only manage content for your own country'
    )
  }
  throw new ContentError('COUNTRY_MISMATCH', 'You do not have permission to manage this content')
}

function contentDenialReason(
  actor: Actor,
  unit: KnowledgeUnit,
  languageId?: string | null
): string {
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    if (unit.scope === 'GLOBAL') return 'GLOBAL_CONTENT_ADMIN_ONLY'
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      languageId != null &&
      languageId !== actor.languageScopeId
    ) {
      return 'LANGUAGE_SCOPE'
    }
    return 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

/**
 * Admin read access (taxonomy/KU parity): ADMIN sees all; COUNTRY_ADMIN and
 * WRITER (P2-S4 §18) see global (read-only) + own-country content — a writer's
 * language scope narrows only what they may MANAGE, not what they may read
 * (seeing the board's context is part of working it).
 */
function canReadContent(actor: Actor, unit: KnowledgeUnit): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') {
    return unit.scope === 'GLOBAL' || unit.countryId === actor.countryId
  }
  return false
}

function toRevisionRef(
  revision: Prisma.ContentRevisionGetPayload<{ include: { publishedBy: true } }>
): ContentRevisionRef {
  return {
    id: revision.id,
    revisionNumber: revision.revisionNumber,
    title: revision.title,
    body: revision.body,
    changeSummary: revision.changeSummary,
    aiAssisted: revision.aiAssisted,
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: revision.publishedBy?.email ?? null,
  }
}

async function toAdminItem(actor: Actor, item: ItemRow): Promise<AdminContentItem> {
  const unit = item.knowledgeUnit
  const topic = await getTopicIdentity(unit.topicId)
  const canManage = can(actor, 'content:manage', targetOfUnit(unit, item.languageId))
  // §18 editorial gate: publish-class affordances only for content:publish
  // holders (ADMIN + COUNTRY_ADMIN — writers never see them).
  const canPublish = can(actor, 'content:publish', targetOfUnit(unit))
  const editability = CONTENT_EDITABILITY[item.status as ContentStatusPublic]
  const machineTransitions = Object.keys(
    CONTENT_TRANSITIONS[item.status as ContentStatusPublic]
  ) as ContentTransitionAction[]
  const transitions = machineTransitions.filter(
    (action) => !PUBLISH_GATED_ACTIONS.has(action) || canPublish
  )
  return {
    id: item.id,
    status: item.status as ContentStatusPublic,
    format: item.format as ContentFormatPublic,
    language: { code: item.language.code, name: item.language.name, nativeName: item.language.nativeName },
    title: item.title,
    body: item.body,
    unit: {
      id: unit.id,
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      status: unit.status,
      scope: unit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso: unit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
      topicSlug: topic?.slug ?? null,
    },
    liveRevision: item.publishedRevision ? toRevisionRef(item.publishedRevision) : null,
    revisionCount: item._count.revisions,
    aiAssisted: item.aiAssisted,
    sourceCount: item._count.sourceLinks,
    scheduledFor: item.scheduledForAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    canEdit: canManage && editability !== 'none',
    editability,
    // Affordances from server truth (§20) — non-managers see none; writers
    // never see publish-class actions (§18).
    allowedTransitions: canManage ? transitions : [],
    unitVerified: unit.status === 'VERIFIED',
  }
}

function toPublicSummary(item: ItemRow): PublicContentItemSummary | null {
  // Defense in depth: a PUBLISHED item must have a live revision to serve.
  if (!item.publishedRevision) return null
  return {
    id: item.id,
    format: item.format as ContentFormatPublic,
    language: {
      code: item.language.code,
      name: item.language.name,
      nativeName: item.language.nativeName,
    },
    title: item.publishedRevision.title,
    revision: {
      number: item.publishedRevision.revisionNumber,
      publishedAt: item.publishedRevision.publishedAt.toISOString(),
      changeSummary: item.publishedRevision.changeSummary,
    },
    updatedAt: item.updatedAt.toISOString(),
  }
}

/**
 * Resolves the locale + the country's configured language ids (§35 — content
 * in a language the country does not configure is never exposed there).
 */
async function resolveCountryLanguages(input: {
  country?: string
  language?: string
}): Promise<{ languageIds: string[]; requestedLanguageId: string | null }> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new ContentError('CONTENT_NOT_VISIBLE', error.message)
    }
    throw error
  }
  const country = await getPublicCountry(resolution.country.isoCode)
  if (!country) throw new ContentError('CONTENT_NOT_VISIBLE', 'Country not available')
  const languageIds: string[] = []
  for (const ref of country.languages) {
    const language = await findActiveLanguageByCode(ref.code)
    if (language) languageIds.push(language.id)
  }
  // When the caller asked for a specific language, the resolver has already
  // validated it is configured + active for this country.
  const requestedLanguageId = input.language
    ? (await findActiveLanguageByCode(resolution.language.code))?.id ?? null
    : null
  return { languageIds, requestedLanguageId }
}

/** Public visibility chain: unit VERIFIED + country-visible + topic-visible
 * (§14/§15) — a representation is never more visible than its record. */
async function assertUnitPubliclyVisible(
  unit: KnowledgeUnit,
  countryId: string,
  country?: string
): Promise<void> {
  if (unit.status !== 'VERIFIED') {
    throw new ContentError('CONTENT_NOT_VISIBLE', 'This content is not available')
  }
  if (unit.scope === 'COUNTRY' && unit.countryId !== countryId) {
    throw new ContentError('CONTENT_NOT_VISIBLE', 'This content is not available in the selected country')
  }
  try {
    await getPublicTopic(unit.topicId, { country })
  } catch (error) {
    if (error instanceof TaxonomyError) {
      throw new ContentError('CONTENT_NOT_VISIBLE', 'This content is not available in the selected country')
    }
    throw error
  }
}

// ---------- §19 step 7: scheduled-release materialization (P2-S4) ----------

/**
 * Publishes ONE due SCHEDULED item atomically. The conditional claim
 * (`updateMany` on status + time) makes concurrent reads safe: exactly one
 * materialization wins; the losers see count 0 and skip. The published body
 * is the locked working copy — exactly what review approved (§19).
 */
async function materializeScheduledItem(itemId: string): Promise<void> {
  const item = await loadItem(itemId)
  if (
    !item ||
    item.status !== 'SCHEDULED' ||
    !item.scheduledForAt ||
    item.scheduledForAt.getTime() > Date.now()
  ) {
    return
  }
  // §14 guard: a representation is never more visible than its record.
  if (item.knowledgeUnit.status !== 'VERIFIED') return

  const nextNumber = await db.$transaction(async (tx) => {
    const claimed = await tx.contentItem.updateMany({
      where: {
        id: item.id,
        status: 'SCHEDULED',
        scheduledForAt: { lte: new Date() },
      },
      data: { status: 'PUBLISHED', scheduledForAt: null },
    })
    if (claimed.count === 0) return null // a concurrent read materialized it
    const aggregate = await tx.contentRevision.aggregate({
      where: { contentItemId: item.id },
      _max: { revisionNumber: true },
    })
    const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
    const revision = await tx.contentRevision.create({
      data: {
        contentItemId: item.id,
        revisionNumber,
        title: item.title,
        body: item.body,
        aiAssisted: item.aiAssisted,
        changeSummary: 'Scheduled release (§19 step 7) — published automatically at the scheduled time',
        publishedById: null, // system publish
      },
    })
    await tx.contentItem.update({
      where: { id: item.id },
      data: { publishedRevisionId: revision.id },
    })
    await wireContentWorkflow(tx, {
      action: 'publish',
      actorId: null,
      item: workflowItemOf(item),
    })
    return revisionNumber
  })
  if (nextNumber == null) return

  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.contentItemTransition,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
    before: { status: 'SCHEDULED', scheduledFor: item.scheduledForAt.toISOString() },
    after: { status: 'PUBLISHED', revision: nextNumber },
    metadata: { action: 'publish', scheduled: true, materialized: 'lazy-read' },
  })

  // P4-S1 §17/§19: the scheduled release just became a public surface — its
  // language variant joins the search index now, not on the next full reindex.
  await onUnitChanged(item.knowledgeUnit.slug)
}

/**
 * Publishes due SCHEDULED items lazily — the modular monolith's scheduler is
 * "the first read after the scheduled time" (no background jobs needed).
 * Public and admin reads both call this, scoped to what they are reading so
 * per-request work stays bounded (§37).
 */
export async function materializeDueScheduledContent(
  scope?: { unitId?: string; itemId?: string }
): Promise<void> {
  const due = await db.contentItem.findMany({
    where: {
      status: 'SCHEDULED',
      scheduledForAt: { lte: new Date() },
      ...(scope?.unitId ? { knowledgeUnitId: scope.unitId } : {}),
      ...(scope?.itemId ? { id: scope.itemId } : {}),
    },
    select: { id: true },
    take: 25, // bounded per read
  })
  for (const row of due) await materializeScheduledItem(row.id)
}

// ---------- Public reads ----------

/** Lists the PUBLISHED representations of one unit in the resolved country
 * (§7 — one record, many renderings; §35 — only languages the country configures). */
export async function getPublicContentItems(
  query: PublicContentListQuery
): Promise<PublicContentListResult> {
  const unit = await loadUnitByRef(query.unit)
  if (!unit) throw new ContentError('UNIT_NOT_FOUND', 'Knowledge unit not found')

  const { languageIds, requestedLanguageId } = await resolveCountryLanguages({
    country: query.country,
    language: query.language,
  })

  // Country id for the scope check (§14/§15).
  const resolution = await resolveLocaleContext({ country: query.country })
  const countryRow = await db.country.findFirst({
    where: { isoCode: resolution.country.isoCode },
    select: { id: true },
  })
  if (!countryRow) throw new ContentError('CONTENT_NOT_VISIBLE', 'Country not available')
  await assertUnitPubliclyVisible(unit, countryRow.id, query.country)

  // §19 step 7: due scheduled releases go live before serving the list.
  await materializeDueScheduledContent({ unitId: unit.id })

  const items = await db.contentItem.findMany({
    where: {
      knowledgeUnitId: unit.id,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      languageId: { in: requestedLanguageId ? [requestedLanguageId] : languageIds },
    },
    include: ITEM_INCLUDE,
  })

  // All configured languages that carry at least one published representation
  // (informational — powers "also available in …" affordances).
  const allCountryItems = requestedLanguageId
    ? await db.contentItem.findMany({
        where: {
          knowledgeUnitId: unit.id,
          status: 'PUBLISHED',
          publishedRevisionId: { not: null },
          languageId: { in: languageIds },
        },
        select: { languageId: true },
      })
    : items
  const languagesAvailable = [...new Set(allCountryItems.map((row) => row.languageId))].map(
    (id) => items.find((row) => row.languageId === id)?.language.code ?? null
  ).filter((code): code is string => code != null)

  const topic = await getTopicIdentity(unit.topicId)

  return {
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      canonicalSummary: unit.canonicalSummary,
      type: unit.type,
      difficulty: unit.difficulty,
      scope: unit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso: unit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
    },
    items: items
      .map(toPublicSummary)
      .filter((entry): entry is PublicContentItemSummary => entry != null)
      .sort(
        (a, b) =>
          a.language.code.localeCompare(b.language.code) || a.format.localeCompare(b.format)
      ),
    languagesAvailable: languagesAvailable.sort(),
  }
}

/** Public detail by id — ALWAYS the live revision snapshot, never the working copy. */
export async function getPublicContentItem(
  id: string,
  input: { country?: string }
): Promise<PublicContentItemDetail> {
  // §19 step 7: a due scheduled release goes live before serving the detail.
  await materializeDueScheduledContent({ itemId: id })
  const item = await loadItem(id)
  if (!item || item.status !== 'PUBLISHED' || !item.publishedRevision) {
    throw new ContentError('CONTENT_NOT_FOUND', 'Content not found')
  }
  const unit = item.knowledgeUnit

  const resolution = await resolveLocaleContext({ country: input.country })
  const countryRow = await db.country.findFirst({
    where: { isoCode: resolution.country.isoCode },
    select: { id: true },
  })
  if (!countryRow) throw new ContentError('CONTENT_NOT_VISIBLE', 'Country not available')
  await assertUnitPubliclyVisible(unit, countryRow.id, input.country)

  const summary = toPublicSummary(item)
  if (!summary) throw new ContentError('CONTENT_NOT_FOUND', 'Content not found')

  const topic = await getTopicIdentity(unit.topicId)
  // §24 provenance surface: current evidence links with verification states.
  // Provenance rides the already-verified visibility chain above.
  const sources = await getPublicSourcesForItem(item.id)

  return {
    ...summary,
    body: item.publishedRevision.body,
    revisionCount: item._count.revisions,
    // §24/§26 — the live revision's immutable AI-provenance snapshot.
    aiAssisted: item.publishedRevision.aiAssisted,
    sources,
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      canonicalSummary: unit.canonicalSummary,
      type: unit.type,
      difficulty: unit.difficulty,
      scope: unit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso: unit.scope === 'COUNTRY' ? topic?.countryIso ?? null : null,
    },
  }
}

// ---------- Admin reads ----------

export async function getAdminContentItems(
  actor: Actor,
  query: AdminContentListQuery
): Promise<AdminContentListResult> {
  assertCan(actor, 'content:manage')

  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledContent()

  let unitId: string | undefined
  if (query.unit) {
    const unit = await loadUnitByRef(query.unit)
    if (!unit) throw new ContentError('UNIT_NOT_FOUND', `Unknown unit "${query.unit}"`)
    unitId = unit.id
  }

  let languageId: string | undefined
  if (query.language) {
    const language = await findActiveLanguageByCode(query.language)
    if (!language) throw new ContentError('LANGUAGE_NOT_FOUND', `Unknown language "${query.language}"`)
    languageId = language.id
  }

  // COUNTRY_ADMIN + WRITER (P2-S4 §18): global (read-only) + own-country
  // content — KU parity. The scope lives on the owning unit, so the filter
  // rides the relation.
  const unitScope: Prisma.KnowledgeUnitWhereInput | undefined =
    actor.role === 'ADMIN'
      ? undefined
      : { OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: actor.countryId }] }

  const where: Prisma.ContentItemWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(unitId ? { knowledgeUnitId: unitId } : {}),
    ...(languageId ? { languageId } : {}),
    ...(query.format ? { format: query.format } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: 'insensitive' } },
            { knowledgeUnit: { canonicalName: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
    ...(unitScope ? { knowledgeUnit: unitScope } : {}),
  }

  const [rows, total] = await Promise.all([
    db.contentItem.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: ITEM_INCLUDE,
    }),
    db.contentItem.count({ where }),
  ])

  const items: AdminContentItem[] = []
  for (const row of rows) {
    if (canReadContent(actor, row.knowledgeUnit)) items.push(await toAdminItem(actor, row))
  }

  return {
    items,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
  }
}

export async function getAdminContentItem(actor: Actor, id: string): Promise<AdminContentItem> {
  assertCan(actor, 'content:manage')
  // §19 step 7: due scheduled releases materialize on the workspace read too.
  await materializeDueScheduledContent({ itemId: id })
  const item = await loadItem(id)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  if (!canReadContent(actor, item.knowledgeUnit)) {
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only view global content and your own country content'
    )
  }
  return toAdminItem(actor, item)
}

/** Full revision history of one item — the §36 preserved versions (admin). */
export async function listContentRevisions(
  actor: Actor,
  itemId: string
): Promise<AdminContentRevisionListResult> {
  assertCan(actor, 'content:manage')
  const item = await loadItem(itemId)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  if (!canReadContent(actor, item.knowledgeUnit)) {
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only view revisions of global content and your own country content'
    )
  }

  const revisions = await db.contentRevision.findMany({
    where: { contentItemId: item.id },
    orderBy: { revisionNumber: 'desc' }, // deterministic (§37)
    include: { publishedBy: true },
  })

  return {
    itemId: item.id,
    unit: { slug: item.knowledgeUnit.slug, canonicalName: item.knowledgeUnit.canonicalName },
    language: { code: item.language.code, name: item.language.name },
    format: item.format as ContentFormatPublic,
    revisions: revisions.map(toRevisionRef),
  }
}

// ---------- Admin writes ----------

export async function createContentItem(
  actor: Actor,
  input: CreateContentItemInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentItem> {
  assertCan(actor, 'content:manage')

  // The canonical record (§7) — representations attach to it, never re-enter it.
  const unit = await loadUnitByRef(input.unit)
  if (!unit) throw new ContentError('UNIT_NOT_FOUND', `Unknown knowledge unit "${input.unit}"`)
  if (unit.status === 'ARCHIVED') {
    throw new ContentError(
      'UNIT_ARCHIVED',
      'Archived units cannot receive new representations — create a new unit instead (§36)'
    )
  }

  // Language (§35): must be ACTIVE; for country-scoped units it must be
  // configured for that unit's country (enforced server-side, never by UI).
  const language = await findActiveLanguageByCode(input.language.toLowerCase())
  if (!language) {
    throw new ContentError('LANGUAGE_NOT_FOUND', `Unknown or inactive language "${input.language}"`)
  }
  if (unit.scope === 'COUNTRY' && unit.countryId) {
    const configured = await isLanguageConfiguredForCountry(unit.countryId, language.id)
    if (!configured) {
      throw new ContentError(
        'LANGUAGE_NOT_AVAILABLE',
        `Language "${language.code}" is not configured for this unit's country market (§35 — per-country language exposure)`
      )
    }
  }

  // Object-level scope: a representation inherits its unit's country scope,
  // and a language-scoped WRITER may only create in their language (§20).
  if (!can(actor, 'content:manage', targetOfUnit(unit, language.id))) {
    const reason = contentDenialReason(actor, unit, language.id)
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentDenied,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: null,
      objectLabel: `${unit.slug}/${language.code}/${input.format}`,
      before: { unitSlug: unit.slug, unitScope: unit.scope },
      metadata: { attemptedOperation: 'create', reason },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    if ((actor.role === 'COUNTRY_ADMIN' || actor.role === 'WRITER') && unit.scope === 'GLOBAL') {
      throw new ContentError(
        'GLOBAL_CONTENT_ADMIN_ONLY',
        'Country-scoped staff can only create content for their own country\u2019s units'
      )
    }
    if (
      actor.role === 'WRITER' &&
      actor.languageScopeId &&
      language.id !== actor.languageScopeId
    ) {
      throw new ContentError(
        'LANGUAGE_SCOPE',
        'You are language-scoped to your assigned language (§20 explicit staff scopes) — this representation is outside it'
      )
    }
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only create content for your own country\u2019s units'
    )
  }

  // §7/§11 identity: one representation per (unit, language, format).
  const existing = await db.contentItem.findFirst({
    where: { knowledgeUnitId: unit.id, languageId: language.id, format: input.format },
    select: { id: true, status: true },
  })
  if (existing) {
    throw new ContentError(
      'REPRESENTATION_EXISTS',
      `A ${input.format} representation in "${language.code}" already exists for this unit (status: ${existing.status}) — one rendering per unit + language + format (§7)`
    )
  }

  const created = await db.contentItem.create({
    data: {
      knowledgeUnitId: unit.id,
      languageId: language.id,
      format: input.format,
      status: 'DRAFT',
      title: input.title,
      body: input.body,
      aiAssisted: input.aiAssisted ?? false,
      createdById: actor.userId,
    },
    include: ITEM_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentItemCreate,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: created.id,
    objectLabel: `${unit.slug}/${language.code}/${input.format}`,
    after: snapshotOf(created),
    metadata: { unitSlug: unit.slug, languageCode: language.code, format: input.format },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminItem(actor, created)
}

export async function updateContentItem(
  actor: Actor,
  id: string,
  input: UpdateContentItemInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentItem> {
  const item = await loadItem(id)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  assertCanManageContent(actor, item, 'update', meta)

  const editability = CONTENT_EDITABILITY[item.status as ContentStatusPublic]
  if (editability === 'none') {
    throw new ContentError(
      'STATE_LOCKED',
      'Retired items are read-only (§36) — create a new representation if the content is needed again'
    )
  }

  // Working-copy merge + per-format rules (§23 — the item's format is immutable).
  const title = input.title ?? item.title
  const body = input.body ?? item.body
  const formatCheck = bodyFitsFormat(item.format as ContentFormatPublic, body)
  if (!formatCheck.ok) {
    throw new ContentError('FORMAT_BODY_INVALID', formatCheck.message)
  }

  const before = snapshotOf(item)
  const updated = await db.contentItem.update({
    where: { id: item.id },
    data: {
      ...(input.title !== undefined ? { title } : {}),
      ...(input.body !== undefined ? { body } : {}),
      ...(input.aiAssisted !== undefined ? { aiAssisted: input.aiAssisted } : {}),
    },
    include: ITEM_INCLUDE,
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentItemUpdate,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
    before,
    after: snapshotOf(updated),
    metadata: {
      changedFields: Object.keys(input),
      note:
        item.status === 'PUBLISHED'
          ? 'Working-copy edit — staged, not public. Public reads serve the live revision until a new revision is published (§36).'
          : null,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminItem(actor, updated)
}

export async function transitionContentItem(
  actor: Actor,
  id: string,
  input: ContentTransitionInput,
  meta: AuditRequestMeta = {}
): Promise<AdminContentItem> {
  const item = await loadItem(id)
  if (!item) throw new ContentError('CONTENT_NOT_FOUND', 'Content item not found')
  assertCanManageContent(actor, item, `transition:${input.action}`, meta)

  // §18 editorial gate: publish/schedule/retire are editorial decisions —
  // writers create, edit and submit, but never publish (§18 "cannot publish
  // unless granted"). Denied here with an audit trail (§20/§30).
  if (
    PUBLISH_GATED_ACTIONS.has(input.action) &&
    !can(actor, 'content:publish', targetOfUnit(item.knowledgeUnit))
  ) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentDenied,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: item.id,
      objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
      before: { status: item.status },
      metadata: {
        attemptedOperation: `transition:${input.action}`,
        reason: 'PUBLISH_NOT_PERMITTED',
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    }).catch(() => undefined)
    throw new ContentError(
      'PUBLISH_NOT_PERMITTED',
      'Writers create and edit content but cannot publish (§18) — ask an editor to publish, schedule or retire'
    )
  }

  const status = item.status as ContentStatusPublic
  const target = CONTENT_TRANSITIONS[status][input.action]
  if (!target) {
    throw new ContentError(
      'INVALID_TRANSITION',
      `"${input.action}" is not a valid transition from ${status}`
    )
  }

  // ---------- publish: append an immutable revision (§19/§36) ----------
  if (input.action === 'publish') {
    if (item.knowledgeUnit.status !== 'VERIFIED') {
      throw new ContentError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${item.knowledgeUnit.status} — content can only be published on VERIFIED units (a representation is never more visible than its record)`
      )
    }
    const formatCheck = bodyFitsFormat(item.format as ContentFormatPublic, item.body)
    if (!formatCheck.ok) {
      throw new ContentError('FORMAT_BODY_INVALID', formatCheck.message)
    }

    const isRepublish = item.publishedRevisionId != null
    if (isRepublish) {
      if (!input.changeSummary?.trim()) {
        throw new ContentError(
          'CHANGE_SUMMARY_REQUIRED',
          'Publishing a new revision of live content requires a change summary (§25/§36 — corrections are never silent)'
        )
      }
      if (
        item.title === item.publishedRevision?.title &&
        item.body === item.publishedRevision?.body
      ) {
        throw new ContentError(
          'NO_CHANGES',
          'The working copy is identical to the live revision — nothing to publish'
        )
      }
    }

    // Append revision N+1 and move the live pointer atomically. The unique
    // (contentItemId, revisionNumber) guards against concurrent double-publish.
    const nextNumber = await db.$transaction(async (tx) => {
      const aggregate = await tx.contentRevision.aggregate({
        where: { contentItemId: item.id },
        _max: { revisionNumber: true },
      })
      const revisionNumber = (aggregate._max.revisionNumber ?? 0) + 1
      const revision = await tx.contentRevision.create({
        data: {
          contentItemId: item.id,
          revisionNumber,
          title: item.title,
          body: item.body,
          // §24/§26 — the revision freezes the AI-provenance flag at publish time.
          aiAssisted: item.aiAssisted,
          changeSummary: input.changeSummary?.trim() ?? null,
          publishedById: actor.userId,
        },
      })
      await tx.contentItem.update({
        where: { id: item.id },
        data: {
          status: 'PUBLISHED',
          publishedRevisionId: revision.id,
          scheduledForAt: null, // publishing (incl. publish-now from SCHEDULED) clears the marker
        },
      })
      // §19 wiring: resolve the item's open work items inside the same
      // transaction so board state never lags content state.
      await wireContentWorkflow(tx, {
        action: 'publish',
        actorId: actor.userId,
        item: workflowItemOf(item),
      })
      return revisionNumber
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentItemTransition,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: item.id,
      objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
      before: { status: item.status, liveRevision: item.publishedRevision?.revisionNumber ?? null },
      after: { status: 'PUBLISHED', revision: nextNumber },
      metadata: {
        action: 'publish',
        revisionNumber: nextNumber,
        changeSummary: input.changeSummary?.trim() ?? null,
        republished: isRepublish,
        aiAssisted: item.aiAssisted,
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    // P4-S1 §17: a published/republished representation re-projects the unit's
    // documents (new language variant, new title/body text, new freshness).
    await onUnitChanged(item.knowledgeUnit.slug)

    const refreshed = await loadItem(item.id)
    return toAdminItem(actor, refreshed!)
  }

  // ---------- schedule: approve for future release (§19 step 7) ----------
  if (input.action === 'schedule') {
    const when = input.scheduledFor ? new Date(input.scheduledFor) : null
    if (!when || Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
      throw new ContentError(
        'SCHEDULED_FOR_REQUIRED',
        'A valid future release time is required to schedule content (§19 step 7)'
      )
    }
    if (item.knowledgeUnit.status !== 'VERIFIED') {
      throw new ContentError(
        'UNIT_NOT_VERIFIED',
        `The owning unit is ${item.knowledgeUnit.status} — only VERIFIED units' content can be scheduled (a representation is never more visible than its record)`
      )
    }
    const formatCheck = bodyFitsFormat(item.format as ContentFormatPublic, item.body)
    if (!formatCheck.ok) {
      throw new ContentError('FORMAT_BODY_INVALID', formatCheck.message)
    }

    const updatedSchedule = await db.$transaction(async (tx) => {
      const row = await tx.contentItem.update({
        where: { id: item.id },
        data: { status: 'SCHEDULED', scheduledForAt: when },
        include: ITEM_INCLUDE,
      })
      // §19 wiring: the review cycle is complete (approval happened here);
      // open work items resolve as "scheduled".
      await wireContentWorkflow(tx, {
        action: 'schedule',
        actorId: actor.userId,
        item: workflowItemOf(item),
      })
      return row
    })

    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.contentItemTransition,
      objectType: AUDIT_OBJECT_TYPES.contentItem,
      objectId: item.id,
      objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
      before: { status: item.status },
      after: { status: 'SCHEDULED', scheduledFor: when.toISOString() },
      metadata: { action: 'schedule', scheduledFor: when.toISOString() },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    return toAdminItem(actor, updatedSchedule)
  }

  // ---------- simple transitions (submit_review / send_back / retire) ----------
  const updated = await db.$transaction(async (tx) => {
    const row = await tx.contentItem.update({
      where: { id: item.id },
      data: {
        status: target,
        // send_back from SCHEDULED cancels the pending release (§19).
        ...(input.action === 'send_back' ? { scheduledForAt: null } : {}),
      },
      include: ITEM_INCLUDE,
    })
    // §19 wiring: submit_review opens the review task; send_back resolves the
    // cycle; retire cancels open work — all inside the same transaction.
    await wireContentWorkflow(tx, {
      action: input.action,
      actorId: actor.userId,
      item: workflowItemOf(item),
    })
    return row
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentItemTransition,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
    before: { status: item.status },
    after: {
      status: target,
      ...(input.action === 'send_back' && item.scheduledForAt
        ? { scheduledForCleared: item.scheduledForAt.toISOString() }
        : {}),
    },
    metadata: { action: input.action },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17/§19 step 10: retiring withdraws a public representation — the
  // unit's documents are re-projected (and a unit whose last representation
  // in a language retired loses that language's document, §35).
  if (input.action === 'retire') {
    await onUnitChanged(item.knowledgeUnit.slug)
  }

  return toAdminItem(actor, updated)
}
