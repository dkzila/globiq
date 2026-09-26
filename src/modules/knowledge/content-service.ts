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
import { CONTENT_EDITABILITY, CONTENT_TRANSITIONS } from './content-types'
import type {
  AdminContentListQuery,
  ContentTransitionInput,
  CreateContentItemInput,
  PublicContentListQuery,
  UpdateContentItemInput,
} from './content-validation'
import { bodyFitsFormat } from './content-validation'

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
    _count: { select: { revisions: true } }
  }
}>

async function loadUnitByRef(ref: string): Promise<KnowledgeUnit | null> {
  return db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
}

async function loadItem(id: string): Promise<ItemRow | null> {
  if (!CUID_PATTERN.test(id)) return null
  return db.contentItem.findUnique({
    where: { id },
    include: {
      knowledgeUnit: true,
      language: true,
      publishedRevision: { include: { publishedBy: true } },
      _count: { select: { revisions: true } },
    },
  })
}

/** A representation's permission target: the OWNING unit's country scope (§14). */
function targetOfUnit(unit: KnowledgeUnit): { countryId: string | null } {
  return { countryId: unit.scope === 'COUNTRY' ? unit.countryId : null }
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
  if (can(actor, 'content:manage', targetOfUnit(item.knowledgeUnit))) return
  void recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentDenied,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
    before: { status: item.status, unitScope: item.knowledgeUnit.scope },
    metadata: {
      attemptedOperation: operation,
      reason: contentDenialReason(actor, item.knowledgeUnit),
    },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  }).catch(() => undefined) // best-effort; recordAudit itself never throws
  if (actor.role === 'COUNTRY_ADMIN') {
    if (item.knowledgeUnit.scope === 'GLOBAL') {
      throw new ContentError(
        'GLOBAL_CONTENT_ADMIN_ONLY',
        'Country admins cannot manage representations of global knowledge units'
      )
    }
    throw new ContentError(
      'COUNTRY_MISMATCH',
      'You can only manage content for your own country'
    )
  }
  throw new ContentError('COUNTRY_MISMATCH', 'You do not have permission to manage this content')
}

function contentDenialReason(actor: Actor, unit: KnowledgeUnit): string {
  if (actor.role === 'COUNTRY_ADMIN') {
    return unit.scope === 'GLOBAL' ? 'GLOBAL_CONTENT_ADMIN_ONLY' : 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

/** Admin read access (taxonomy/KU parity): ADMIN sees all; COUNTRY_ADMIN sees
 * global (read-only) + own-country content. */
function canReadContent(actor: Actor, unit: KnowledgeUnit): boolean {
  if (actor.role === 'ADMIN') return true
  if (actor.role === 'COUNTRY_ADMIN') {
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
    publishedAt: revision.publishedAt.toISOString(),
    publishedBy: revision.publishedBy?.email ?? null,
  }
}

async function toAdminItem(actor: Actor, item: ItemRow): Promise<AdminContentItem> {
  const unit = item.knowledgeUnit
  const topic = await getTopicIdentity(unit.topicId)
  const canManage = can(actor, 'content:manage', targetOfUnit(unit))
  const editability = CONTENT_EDITABILITY[item.status as ContentStatusPublic]
  const transitions = Object.keys(
    CONTENT_TRANSITIONS[item.status as ContentStatusPublic]
  ) as ContentTransitionAction[]
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
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    canEdit: canManage && editability !== 'none',
    editability,
    // Affordances from server truth (§20) — non-managers see none.
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

  const items = await db.contentItem.findMany({
    where: {
      knowledgeUnitId: unit.id,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      languageId: { in: requestedLanguageId ? [requestedLanguageId] : languageIds },
    },
    include: {
      language: true,
      publishedRevision: { include: { publishedBy: true } },
      knowledgeUnit: true,
      _count: { select: { revisions: true } },
    },
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

  return {
    ...summary,
    body: item.publishedRevision.body,
    revisionCount: item._count.revisions,
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

  // COUNTRY_ADMIN: global (read-only) + own-country content — KU parity. The
  // scope lives on the owning unit, so the filter rides the relation.
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
      include: {
        knowledgeUnit: true,
        language: true,
        publishedRevision: { include: { publishedBy: true } },
        _count: { select: { revisions: true } },
      },
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

  // Object-level scope: a representation inherits its unit's country scope.
  if (!can(actor, 'content:manage', targetOfUnit(unit))) {
    const reason = contentDenialReason(actor, unit)
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
    if (actor.role === 'COUNTRY_ADMIN' && unit.scope === 'GLOBAL') {
      throw new ContentError(
        'GLOBAL_CONTENT_ADMIN_ONLY',
        'Country admins can only create content for their own country\u2019s units'
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
      createdById: actor.userId,
    },
    include: {
      knowledgeUnit: true,
      language: true,
      publishedRevision: { include: { publishedBy: true } },
      _count: { select: { revisions: true } },
    },
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
    },
    include: {
      knowledgeUnit: true,
      language: true,
      publishedRevision: { include: { publishedBy: true } },
      _count: { select: { revisions: true } },
    },
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
          changeSummary: input.changeSummary?.trim() ?? null,
          publishedById: actor.userId,
        },
      })
      await tx.contentItem.update({
        where: { id: item.id },
        data: { status: 'PUBLISHED', publishedRevisionId: revision.id },
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
      },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })

    const refreshed = await loadItem(item.id)
    return toAdminItem(actor, refreshed!)
  }

  // ---------- non-publish transitions (submit_review / send_back / retire) ----------
  const updated = await db.contentItem.update({
    where: { id: item.id },
    data: { status: target },
    include: {
      knowledgeUnit: true,
      language: true,
      publishedRevision: { include: { publishedBy: true } },
      _count: { select: { revisions: true } },
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.contentItemTransition,
    objectType: AUDIT_OBJECT_TYPES.contentItem,
    objectId: item.id,
    objectLabel: `${item.knowledgeUnit.slug}/${item.language.code}/${item.format}`,
    before: { status: item.status },
    after: { status: target },
    metadata: { action: input.action },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return toAdminItem(actor, updated)
}
