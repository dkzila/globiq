/**
 * GlobIQ — Taxonomy: domain service
 * Master Plan §6 (Topic model), §13 (one global framework + country-specific
 * extensions; configurable domains — never hard-coded), §14 (explicit country
 * scope), §36 (taxonomy changes migration-safe: immutable slugs, soft retire,
 * no destructive restructures), §38 (scoped admin roles), §37 (domain-oriented
 * operations, not table CRUD).
 *
 * Public reads are country/language-aware (resolved via the country-locale
 * module); admin writes enforce structural invariants and scoped RBAC.
 */
import { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { can, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  findActiveCountryByIso,
  resolveLocaleContext,
} from '@/modules/country-locale'
import type { LocaleResolution } from '@/modules/country-locale'
import { getTaxonomySnapshot, invalidateTaxonomySnapshot } from './cache'
import type { TaxonomySnapshot, TopicRow } from './cache'
import type {
  AdminTopicDetail,
  AdminTopicNode,
  PublicTopicAlias,
  PublicTopicDetail,
  PublicTopicLabel,
  PublicTopicNode,
  PublicTopicPathEntry,
  TopicIdentity,
  TopicPermissions,
  TopicScopePublic,
  TopicStatusPublic,
  TopicSearchResult,
} from './types'
import type {
  CreateTopicInput,
  SetTopicAliasesInput,
  SetTopicLabelsInput,
  UpdateTopicInput,
} from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type TaxonomyErrorCode =
  | 'TOPIC_NOT_FOUND'
  | 'TOPIC_NOT_VISIBLE'
  | 'SLUG_TAKEN'
  | 'COUNTRY_NOT_FOUND'
  | 'PARENT_NOT_FOUND'
  | 'PARENT_RETIRED'
  | 'DOMAIN_ONLY_ROOT'
  | 'DOMAIN_MUST_BE_ROOT'
  | 'ROOT_DOMAIN_GLOBAL'
  | 'ROOT_ADMIN_ONLY'
  | 'CROSS_COUNTRY_SCOPE'
  | 'GLOBAL_NODES_ADMIN_ONLY'
  | 'COUNTRY_MISMATCH'
  | 'CYCLE'
  | 'STATUS_TRANSITION'
  | 'RESTORE_PARENT_INACTIVE'
  | 'ALREADY_RETIRED'
  | 'RETIRE_WITH_ACTIVE_CHILDREN'
  | 'LANGUAGE_NOT_FOUND'
  | 'LANGUAGE_INACTIVE'
  | 'DUPLICATE_LABEL_LANGUAGE'
  | 'DUPLICATE_ALIAS'

const ERROR_STATUS: Record<TaxonomyErrorCode, number> = {
  TOPIC_NOT_FOUND: 404,
  TOPIC_NOT_VISIBLE: 404,
  SLUG_TAKEN: 409,
  COUNTRY_NOT_FOUND: 400,
  PARENT_NOT_FOUND: 400,
  PARENT_RETIRED: 400,
  DOMAIN_ONLY_ROOT: 400,
  DOMAIN_MUST_BE_ROOT: 400,
  ROOT_DOMAIN_GLOBAL: 400,
  ROOT_ADMIN_ONLY: 403,
  CROSS_COUNTRY_SCOPE: 400,
  GLOBAL_NODES_ADMIN_ONLY: 403,
  COUNTRY_MISMATCH: 403,
  CYCLE: 400,
  STATUS_TRANSITION: 400,
  RESTORE_PARENT_INACTIVE: 400,
  ALREADY_RETIRED: 409,
  RETIRE_WITH_ACTIVE_CHILDREN: 409,
  LANGUAGE_NOT_FOUND: 400,
  LANGUAGE_INACTIVE: 400,
  DUPLICATE_LABEL_LANGUAGE: 400,
  DUPLICATE_ALIAS: 400,
}

export class TaxonomyError extends Error {
  readonly code: TaxonomyErrorCode
  readonly status: number

  constructor(code: TaxonomyErrorCode, message: string) {
    super(message)
    this.name = 'TaxonomyError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown TaxonomyError to envelope data (§37); null for other errors. */
export function toTaxonomyErrorResponse(
  error: unknown
): { message: string; code: TaxonomyErrorCode; status: number } | null {
  if (error instanceof TaxonomyError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Internal helpers ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

function topicByRef(snapshot: TaxonomySnapshot, ref: string): TopicRow | null {
  if (CUID_PATTERN.test(ref)) {
    return snapshot.topics.find((topic) => topic.id === ref) ?? null
  }
  return snapshot.topics.find((topic) => topic.slug === ref.toLowerCase()) ?? null
}

function topicBySlug(snapshot: TaxonomySnapshot, slug: string): TopicRow | null {
  return snapshot.topics.find((topic) => topic.slug === slug.toLowerCase()) ?? null
}

function countryIsoOf(snapshot: TaxonomySnapshot, countryId: string | null): string | null {
  if (!countryId) return null
  return snapshot.countries.find((country) => country.id === countryId)?.isoCode ?? null
}

/** Label fallback chain (§35): requested language → country default → canonicalName. */
function resolveLabel(
  topic: TopicRow,
  requestedLanguage: string,
  fallbackLanguage: string
): { label: string; labelLanguage: string } {
  const requested = topic.labels.find((entry) => entry.languageCode === requestedLanguage)
  if (requested) return { label: requested.name, labelLanguage: requested.languageCode }
  const fallback = topic.labels.find((entry) => entry.languageCode === fallbackLanguage)
  if (fallback) return { label: fallback.name, labelLanguage: fallback.languageCode }
  return { label: topic.canonicalName, labelLanguage: 'canonical' }
}

/** True when the node and every ancestor is ACTIVE (public visibility). */
function hasActiveChain(snapshot: TaxonomySnapshot, topic: TopicRow): boolean {
  let current: TopicRow | null = topic
  const seen = new Set<string>()
  while (current) {
    if (current.status !== 'ACTIVE') return false
    if (seen.has(current.id)) return false // defensive: corrupt cycles
    seen.add(current.id)
    current = current.parentId
      ? snapshot.topics.find((entry) => entry.id === current!.parentId) ?? null
      : null
  }
  return true
}

function isDescendantOf(snapshot: TaxonomySnapshot, ancestorId: string, candidateId: string): boolean {
  let current = snapshot.topics.find((topic) => topic.id === candidateId) ?? null
  const seen = new Set<string>()
  while (current && current.parentId) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    if (current.parentId === ancestorId) return true
    current = snapshot.topics.find((topic) => topic.id === current!.parentId) ?? null
  }
  return false
}

/** Root → node path (all statuses — admin view). */
function pathOf(snapshot: TaxonomySnapshot, topic: TopicRow): Array<{ id: string; slug: string; canonicalName: string }> {
  const path: Array<{ id: string; slug: string; canonicalName: string }> = []
  let current: TopicRow | null = topic
  const seen = new Set<string>()
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    path.unshift({ id: current.id, slug: current.slug, canonicalName: current.canonicalName })
    current = current.parentId
      ? snapshot.topics.find((entry) => entry.id === current!.parentId) ?? null
      : null
  }
  return path
}

function childrenOf(snapshot: TaxonomySnapshot, topicId: string | null): TopicRow[] {
  return snapshot.topics.filter((topic) => topic.parentId === topicId)
}

/** Public visibility for a resolved country (§13/§14): ACTIVE + GLOBAL or own country. */
function isVisibleInCountry(topic: TopicRow, countryId: string): boolean {
  if (topic.status !== 'ACTIVE') return false
  if (topic.scope === 'GLOBAL') return true
  return topic.countryId === countryId
}

async function resolveContext(input: {
  country?: string
  language?: string
}): Promise<{ resolution: LocaleResolution; countryId: string | null }> {
  const resolution = await resolveLocaleContext(input)
  const snapshot = await getTaxonomySnapshot()
  const countryId =
    snapshot.countries.find((country) => country.isoCode === resolution.country.isoCode)?.id ?? null
  return { resolution, countryId }
}

// ---------- Scoped RBAC (§38: ADMIN global, COUNTRY_ADMIN own extensions) ----------

export async function getTopicIdentity(ref: string): Promise<TopicIdentity | null> {
  const snapshot = await getTaxonomySnapshot()
  const topic = topicByRef(snapshot, ref)
  if (!topic) return null
  return {
    id: topic.id,
    slug: topic.slug,
    canonicalName: topic.canonicalName,
    status: topic.status,
    scope: topic.scope,
    countryId: topic.countryId,
    countryIso: countryIsoOf(snapshot, topic.countryId),
    parentId: topic.parentId,
  }
}

/** Target country of a node for the shared permission layer: null = global. */
function targetCountryOf(topic: TopicRow): { countryId: string | null } {
  return { countryId: topic.scope === 'COUNTRY' ? topic.countryId : null }
}

function canManageNode(actor: Actor, topic: TopicRow): boolean {
  if (topic.status === 'RETIRED') return false // archived records are read-only
  return can(actor, 'taxonomy:manage', targetCountryOf(topic))
}

/** Audit snapshot of a node (labels/aliases included — §13 dimensions). */
function auditSnapshotOf(snapshot: TaxonomySnapshot, topic: TopicRow) {
  return {
    slug: topic.slug,
    canonicalName: topic.canonicalName,
    description: topic.description,
    type: topic.type,
    status: topic.status,
    scope: topic.scope,
    countryIso: countryIsoOf(snapshot, topic.countryId),
    parentSlug: topic.parentId
      ? snapshot.topics.find((entry) => entry.id === topic.parentId)?.slug ?? null
      : null,
    orderIndex: topic.orderIndex,
    labels: topic.labels.map((label) => ({
      language: label.languageCode,
      name: label.name,
      description: label.description,
    })),
    aliases: topic.aliases.map((alias) => ({
      value: alias.value,
      language: alias.languageCode,
    })),
  }
}

/** Records an object-level permission denial (the §20 "never cross countries" signal). */
async function noteDenied(
  actor: Actor,
  operation: string,
  reason: string,
  topic: TopicRow | null,
  meta?: AuditRequestMeta
): Promise<void> {
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.taxonomyDenied,
    objectType: AUDIT_OBJECT_TYPES.topic,
    objectId: topic?.id ?? null,
    objectLabel: topic?.slug ?? null,
    before: topic
      ? { slug: topic.slug, scope: topic.scope, status: topic.status }
      : null,
    metadata: { attemptedOperation: operation, reason },
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ?? null,
  })
}

function assertCanManage(
  actor: Actor,
  topic: TopicRow,
  operation: string,
  meta?: AuditRequestMeta
): void {
  if (canManageNode(actor, topic)) return
  // Fire-and-forget denial audit — the error below still reaches the client.
  void noteDenied(actor, operation, denialReasonOf(actor, topic), topic, meta)
  if (actor.role === 'COUNTRY_ADMIN') {
    if (topic.scope === 'GLOBAL') {
      throw new TaxonomyError(
        'GLOBAL_NODES_ADMIN_ONLY',
        'Country admins cannot modify global taxonomy nodes'
      )
    }
    throw new TaxonomyError(
      'COUNTRY_MISMATCH',
      'You can only manage taxonomy extensions for your own country'
    )
  }
  throw new TaxonomyError('COUNTRY_MISMATCH', 'You do not have permission to manage this node')
}

function denialReasonOf(actor: Actor, topic: TopicRow): string {
  if (topic.status === 'RETIRED') return 'NODE_RETIRED'
  if (actor.role === 'COUNTRY_ADMIN') {
    return topic.scope === 'GLOBAL' ? 'GLOBAL_NODES_ADMIN_ONLY' : 'COUNTRY_MISMATCH'
  }
  return 'ROLE'
}

function permissionsFor(actor: Actor, topic: TopicRow, snapshot: TaxonomySnapshot): TopicPermissions {
  const canManage = canManageNode(actor, topic)
  const nonRetiredChildren = childrenOf(snapshot, topic.id).filter(
    (child) => child.status !== 'RETIRED'
  ).length
  return {
    canEdit: canManage,
    canMove: canManage,
    canRetire: canManage && nonRetiredChildren === 0,
    canManageLabels: canManage,
    canManageAliases: canManage,
  }
}

// ---------- Serialization ----------

function toPublicTree(
  snapshot: TaxonomySnapshot,
  topic: TopicRow,
  countryId: string,
  languageCode: string,
  fallbackLanguage: string
): PublicTopicNode {
  const { label, labelLanguage } = resolveLabel(topic, languageCode, fallbackLanguage)
  const visibleChildren = childrenOf(snapshot, topic.id).filter(
    (child) => isVisibleInCountry(child, countryId) && hasActiveChain(snapshot, child)
  )
  return {
    id: topic.id,
    slug: topic.slug,
    canonicalName: topic.canonicalName,
    label,
    labelLanguage,
    type: topic.type,
    scope: topic.scope,
    countryIso: countryIsoOf(snapshot, topic.countryId),
    childCount: visibleChildren.length,
    children: visibleChildren.map((child) =>
      toPublicTree(snapshot, child, countryId, languageCode, fallbackLanguage)
    ),
  }
}

function toPublicPath(
  snapshot: TaxonomySnapshot,
  path: Array<{ id: string; slug: string; canonicalName: string }>,
  languageCode: string,
  fallbackLanguage: string
): PublicTopicPathEntry[] {
  return path.map((entry) => {
    const topic = snapshot.topics.find((topic) => topic.id === entry.id)
    const label = topic ? resolveLabel(topic, languageCode, fallbackLanguage).label : entry.canonicalName
    return { slug: entry.slug, canonicalName: entry.canonicalName, label }
  })
}

function toAdminTree(snapshot: TaxonomySnapshot, topic: TopicRow, actor: Actor): AdminTopicNode {
  const children = childrenOf(snapshot, topic.id).filter((child) =>
    actor.role === 'ADMIN'
      ? true
      : child.scope === 'GLOBAL' || (child.countryId !== null && child.countryId === actor.countryId)
  )
  return {
    id: topic.id,
    slug: topic.slug,
    canonicalName: topic.canonicalName,
    type: topic.type,
    status: topic.status,
    scope: topic.scope,
    countryIso: countryIsoOf(snapshot, topic.countryId),
    orderIndex: topic.orderIndex,
    childCount: children.length,
    children: children.map((child) => toAdminTree(snapshot, child, actor)),
  }
}

async function toAdminDetail(actor: Actor, topicId: string): Promise<AdminTopicDetail> {
  const snapshot = await getTaxonomySnapshot()
  const topic = snapshot.topics.find((entry) => entry.id === topicId)
  if (!topic) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')

  const children = childrenOf(snapshot, topic.id)
  const parent = topic.parentId
    ? snapshot.topics.find((entry) => entry.id === topic.parentId) ?? null
    : null

  const labels: PublicTopicLabel[] = topic.labels.map((label) => ({
    language: label.languageCode,
    name: label.name,
    description: label.description,
  }))
  const aliases: PublicTopicAlias[] = topic.aliases.map((alias) => ({
    value: alias.value,
    language: alias.languageCode,
  }))

  const detail = await db.topic.findUnique({ where: { id: topic.id } })
  if (!detail) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')

  return {
    id: topic.id,
    slug: topic.slug,
    canonicalName: topic.canonicalName,
    description: topic.description,
    type: topic.type,
    status: topic.status,
    scope: topic.scope,
    countryIso: countryIsoOf(snapshot, topic.countryId),
    parentId: topic.parentId,
    parentSlug: parent?.slug ?? null,
    parentCanonicalName: parent?.canonicalName ?? null,
    orderIndex: topic.orderIndex,
    labels,
    aliases,
    childCount: children.length,
    childStatuses: {
      active: children.filter((child) => child.status === 'ACTIVE').length,
      inactive: children.filter((child) => child.status === 'INACTIVE').length,
      retired: children.filter((child) => child.status === 'RETIRED').length,
    },
    path: pathOf(snapshot, topic),
    createdAt: detail.createdAt.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    permissions: permissionsFor(actor, topic, snapshot),
  }
}

// ---------- Public reads ----------

/** Full public tree for a locale context — only ACTIVE, country-visible nodes. */
export async function getPublicTree(input: { country?: string; language?: string }): Promise<PublicTopicNode[]> {
  const { resolution, countryId } = await resolveContext(input)
  if (!countryId) return []

  const snapshot = await getTaxonomySnapshot()
  const languageCode = resolution.language.code
  const fallbackLanguage = resolution.country.isDefault
    ? resolution.language.code
    : 'en'

  return snapshot.topics
    .filter(
      (topic) =>
        topic.parentId === null &&
        isVisibleInCountry(topic, countryId) &&
        hasActiveChain(snapshot, topic)
    )
    .map((topic) => toPublicTree(snapshot, topic, countryId, languageCode, fallbackLanguage))
}

/** Public node detail by slug (or id) — hidden statuses return 404. */
export async function getPublicTopic(
  ref: string,
  input: { country?: string; language?: string }
): Promise<PublicTopicDetail> {
  const { resolution, countryId } = await resolveContext(input)
  const snapshot = await getTaxonomySnapshot()
  const topic = topicByRef(snapshot, ref)
  if (!topic) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')
  if (!countryId || !isVisibleInCountry(topic, countryId) || !hasActiveChain(snapshot, topic)) {
    throw new TaxonomyError('TOPIC_NOT_VISIBLE', 'This topic is not available in the selected country')
  }

  const languageCode = resolution.language.code
  const fallbackLanguage = resolution.country.isDefault ? resolution.language.code : 'en'
  const { label, labelLanguage } = resolveLabel(topic, languageCode, fallbackLanguage)
  const visibleChildren = childrenOf(snapshot, topic.id).filter(
    (child) => isVisibleInCountry(child, countryId) && hasActiveChain(snapshot, child)
  )

  return {
    node: {
      id: topic.id,
      slug: topic.slug,
      canonicalName: topic.canonicalName,
      label,
      labelLanguage,
      description: topic.description,
      type: topic.type,
      scope: topic.scope,
      countryIso: countryIsoOf(snapshot, topic.countryId),
    },
    path: toPublicPath(snapshot, pathOf(snapshot, topic), languageCode, fallbackLanguage),
    labels: topic.labels.map((labelEntry) => ({
      language: labelEntry.languageCode,
      name: labelEntry.name,
      description: labelEntry.description,
    })),
    aliases: topic.aliases.map((alias) => ({ value: alias.value, language: alias.languageCode })),
    children: visibleChildren.map((child) => {
      const childLabel = resolveLabel(child, languageCode, fallbackLanguage)
      return {
        slug: child.slug,
        canonicalName: child.canonicalName,
        label: childLabel.label,
        type: child.type,
        scope: child.scope,
        countryIso: countryIsoOf(snapshot, child.countryId),
        childCount: childrenOf(snapshot, child.id).filter(
          (grandchild) => isVisibleInCountry(grandchild, countryId)
        ).length,
      }
    }),
    childCount: visibleChildren.length,
  }
}

/** Search by canonical name, slug, labels (any language) and aliases. */
export async function searchTopics(input: {
  q: string
  country?: string
  language?: string
  limit?: number
}): Promise<TopicSearchResult[]> {
  const { resolution, countryId } = await resolveContext(input)
  const snapshot = await getTaxonomySnapshot()
  const languageCode = resolution.language.code
  const fallbackLanguage = resolution.country.isDefault ? resolution.language.code : 'en'
  const needle = input.q.trim().toLowerCase()
  const limit = input.limit ?? 20

  const results: TopicSearchResult[] = []
  for (const topic of snapshot.topics) {
    if (!countryId || !isVisibleInCountry(topic, countryId) || !hasActiveChain(snapshot, topic)) continue

    let matchedOn: TopicSearchResult['matchedOn'] | null = null
    if (topic.canonicalName.toLowerCase().includes(needle)) matchedOn = 'name'
    else if (topic.slug.includes(needle)) matchedOn = 'slug'
    else if (topic.labels.some((label) => label.name.toLowerCase().includes(needle))) matchedOn = 'label'
    else if (topic.aliases.some((alias) => alias.value.toLowerCase().includes(needle))) matchedOn = 'alias'

    if (!matchedOn) continue
    const { label, labelLanguage } = resolveLabel(topic, languageCode, fallbackLanguage)
    results.push({
      slug: topic.slug,
      canonicalName: topic.canonicalName,
      label,
      labelLanguage,
      type: topic.type,
      scope: topic.scope,
      countryIso: countryIsoOf(snapshot, topic.countryId),
      matchedOn,
      path: toPublicPath(snapshot, pathOf(snapshot, topic), languageCode, fallbackLanguage),
    })
    if (results.length >= limit) break
  }
  return results
}

// ---------- Admin reads ----------

/** Admin tree: all statuses; COUNTRY_ADMIN sees global + own-country nodes only. */
export async function getAdminTree(actor: Actor): Promise<AdminTopicNode[]> {
  const snapshot = await getTaxonomySnapshot()
  const roots = snapshot.topics.filter(
    (topic) =>
      topic.parentId === null &&
      (actor.role === 'ADMIN' ||
        topic.scope === 'GLOBAL' ||
        (topic.countryId !== null && topic.countryId === actor.countryId))
  )
  return roots.map((topic) => toAdminTree(snapshot, topic, actor))
}

export async function getAdminTopic(actor: Actor, id: string): Promise<AdminTopicDetail> {
  const snapshot = await getTaxonomySnapshot()
  const topic = snapshot.topics.find((entry) => entry.id === id)
  if (!topic) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')
  const readable =
    actor.role === 'ADMIN' ||
    topic.scope === 'GLOBAL' ||
    (topic.countryId !== null && topic.countryId === actor.countryId)
  if (!readable) throw new TaxonomyError('TOPIC_NOT_VISIBLE', 'This node is outside your scope')
  return toAdminDetail(actor, topic.id)
}

// ---------- Structural invariants (§13, §36) ----------

async function assertSlugAvailable(slug: string): Promise<void> {
  const snapshot = await getTaxonomySnapshot()
  if (snapshot.topics.some((topic) => topic.slug === slug)) {
    throw new TaxonomyError('SLUG_TAKEN', `Slug "${slug}" is already in use`)
  }
}

function assertParentRules(snapshot: TaxonomySnapshot, input: {
  parentSlug: string | null
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  scope: 'GLOBAL' | 'COUNTRY'
  countryId: string | null
}): { parentId: string | null; parent: TopicRow | null } {
  if (input.type === 'DOMAIN' && input.parentSlug) {
    throw new TaxonomyError('DOMAIN_MUST_BE_ROOT', 'Domain nodes must be root nodes (no parent)')
  }
  if (input.type !== 'DOMAIN' && !input.parentSlug) {
    throw new TaxonomyError('DOMAIN_ONLY_ROOT', 'Only DOMAIN nodes can be created at the root')
  }

  if (!input.parentSlug) {
    if (input.scope !== 'GLOBAL') {
      throw new TaxonomyError('ROOT_DOMAIN_GLOBAL', 'Root domains belong to the global framework (§13)')
    }
    return { parentId: null, parent: null }
  }

  const parent = topicBySlug(snapshot, input.parentSlug)
  if (!parent) throw new TaxonomyError('PARENT_NOT_FOUND', `Parent "${input.parentSlug}" not found`)
  if (parent.status === 'RETIRED') {
    throw new TaxonomyError('PARENT_RETIRED', 'Cannot place nodes under a retired parent')
  }
  if (parent.type === 'DOMAIN' && input.type === 'DOMAIN') {
    throw new TaxonomyError('DOMAIN_MUST_BE_ROOT', 'Domain nodes must be root nodes (no parent)')
  }

  // Country applicability (§13/§14): a country-scoped subtree cannot contain
  // nodes scoped to a different country.
  if (parent.scope === 'COUNTRY') {
    if (input.scope === 'COUNTRY' && input.countryId !== parent.countryId) {
      throw new TaxonomyError(
        'CROSS_COUNTRY_SCOPE',
        'A country-scoped parent cannot contain nodes scoped to another country'
      )
    }
  }

  return { parentId: parent.id, parent }
}

// ---------- Admin writes ----------

export async function createTopic(
  actor: Actor,
  input: CreateTopicInput,
  meta: AuditRequestMeta = {}
): Promise<AdminTopicDetail> {
  // Scoped RBAC (§38): COUNTRY_ADMIN creates only own-country extensions.
  if (!can(actor, 'taxonomy:manage')) {
    throw new TaxonomyError('COUNTRY_MISMATCH', 'You do not have permission to create taxonomy nodes')
  }
  if (actor.role === 'COUNTRY_ADMIN') {
    if (!input.parent) {
      await noteDenied(actor, 'create', 'ROOT_ADMIN_ONLY', null, meta)
      throw new TaxonomyError('ROOT_ADMIN_ONLY', 'Only platform admins can create root domains')
    }
    if (input.scope !== 'COUNTRY') {
      await noteDenied(actor, 'create', 'GLOBAL_NODES_ADMIN_ONLY', null, meta)
      throw new TaxonomyError('GLOBAL_NODES_ADMIN_ONLY', 'Country admins can only create country-scoped nodes')
    }
  }

  let countryId: string | null = null
  if (input.scope === 'COUNTRY') {
    if (input.country) {
      const country = await findActiveCountryByIso(input.country)
      if (!country) throw new TaxonomyError('COUNTRY_NOT_FOUND', 'Unknown or inactive country')
      if (actor.role === 'COUNTRY_ADMIN' && country.id !== actor.countryId) {
        throw new TaxonomyError(
          'COUNTRY_MISMATCH',
          'You can only create taxonomy extensions for your own country'
        )
      }
      countryId = country.id
    } else if (actor.role === 'COUNTRY_ADMIN' && actor.countryId) {
      // A country admin's home country is implied when not specified.
      countryId = actor.countryId
    } else {
      throw new TaxonomyError('COUNTRY_NOT_FOUND', 'Country is required for country-scoped nodes')
    }
  }

  const snapshot = await getTaxonomySnapshot()
  const { parentId, parent } = assertParentRules(snapshot, {
    parentSlug: input.parent ?? null,
    type: input.type,
    scope: input.scope,
    countryId,
  })

  // COUNTRY_ADMIN's node must sit inside a visible part of the tree.
  if (
    actor.role === 'COUNTRY_ADMIN' &&
    parent &&
    parent.scope === 'COUNTRY' &&
    parent.countryId !== actor.countryId
  ) {
    throw new TaxonomyError(
      'COUNTRY_MISMATCH',
      'You can only attach nodes under global nodes or your own country nodes'
    )
  }

  await assertSlugAvailable(input.slug)

  try {
    const created = await db.topic.create({
      data: {
        slug: input.slug,
        canonicalName: input.canonicalName,
        description: input.description ?? null,
        type: input.type,
        status: 'ACTIVE',
        scope: input.scope,
        countryId,
        parentId,
        orderIndex: input.orderIndex ?? 0,
      },
    })
    invalidateTaxonomySnapshot()
    const detail = await toAdminDetail(actor, created.id)
    const freshSnapshot = await getTaxonomySnapshot()
    const freshTopic = freshSnapshot.topics.find((entry) => entry.id === created.id)
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.topicCreate,
      objectType: AUDIT_OBJECT_TYPES.topic,
      objectId: created.id,
      objectLabel: input.slug,
      after: freshTopic ? auditSnapshotOf(freshSnapshot, freshTopic) : detail,
      metadata: { scope: input.scope, countryIso: input.country ?? null },
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    })
    return detail
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new TaxonomyError('SLUG_TAKEN', `Slug "${input.slug}" is already in use`)
    }
    throw error
  }
}

export async function updateTopic(
  actor: Actor,
  id: string,
  input: UpdateTopicInput,
  meta: AuditRequestMeta = {}
): Promise<AdminTopicDetail> {
  const snapshot = await getTaxonomySnapshot()
  const topic = snapshot.topics.find((entry) => entry.id === id)
  if (!topic) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')
  assertCanManage(actor, topic, 'update', meta)
  const before = auditSnapshotOf(snapshot, topic)

  // ---------- Move (reparent) ----------
  let parentId = topic.parentId
  if (input.parent !== undefined) {
    if (topic.type === 'DOMAIN') {
      throw new TaxonomyError('DOMAIN_MUST_BE_ROOT', 'Domain nodes are fixed roots and cannot be moved')
    }
    const newParent = topicBySlug(snapshot, input.parent)
    if (!newParent) throw new TaxonomyError('PARENT_NOT_FOUND', `Parent "${input.parent}" not found`)
    if (newParent.id === topic.id) {
      throw new TaxonomyError('CYCLE', 'A node cannot be its own parent')
    }
    if (isDescendantOf(snapshot, topic.id, newParent.id)) {
      throw new TaxonomyError('CYCLE', 'Cannot move a node under its own descendant')
    }
    if (newParent.status === 'RETIRED') {
      throw new TaxonomyError('PARENT_RETIRED', 'Cannot move nodes under a retired parent')
    }
    if (actor.role === 'COUNTRY_ADMIN' && newParent.scope === 'COUNTRY' && newParent.countryId !== actor.countryId) {
      throw new TaxonomyError(
        'COUNTRY_MISMATCH',
        'You can only move nodes under global nodes or your own country nodes'
      )
    }
    if (
      topic.scope === 'COUNTRY' &&
      newParent.scope === 'COUNTRY' &&
      newParent.countryId !== topic.countryId
    ) {
      throw new TaxonomyError('CROSS_COUNTRY_SCOPE', 'A node cannot move under a different country subtree')
    }
    parentId = newParent.id
  }

  // ---------- Status transitions ----------
  if (input.status && input.status !== topic.status) {
    if (topic.status === 'RETIRED') {
      throw new TaxonomyError('ALREADY_RETIRED', 'Retired nodes cannot be re-activated by update')
    }
    if (input.status === 'ACTIVE' && topic.parentId) {
      const parent = snapshot.topics.find((entry) => entry.id === topic.parentId)
      if (parent && parent.status !== 'ACTIVE') {
        throw new TaxonomyError(
          'RESTORE_PARENT_INACTIVE',
          'Activate the parent node first — children of inactive parents stay hidden'
        )
      }
    }
  }

  const updated = await db.topic.update({
    where: { id: topic.id },
    data: {
      ...(input.canonicalName !== undefined ? { canonicalName: input.canonicalName } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.orderIndex !== undefined ? { orderIndex: input.orderIndex } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.parent !== undefined ? { parentId } : {}),
    },
  })
  invalidateTaxonomySnapshot()
  const detail = await toAdminDetail(actor, updated.id)
  const freshSnapshot = await getTaxonomySnapshot()
  const freshTopic = freshSnapshot.topics.find((entry) => entry.id === updated.id)
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.topicUpdate,
    objectType: AUDIT_OBJECT_TYPES.topic,
    objectId: topic.id,
    objectLabel: topic.slug,
    before,
    after: freshTopic ? auditSnapshotOf(freshSnapshot, freshTopic) : detail,
    metadata: { changedFields: Object.keys(input) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return detail
}

/** Soft-delete (§36): retirement is explicit, leaf-first and reversible by admins. */
export async function retireTopic(
  actor: Actor,
  id: string,
  meta: AuditRequestMeta = {}
): Promise<AdminTopicDetail> {
  const snapshot = await getTaxonomySnapshot()
  const topic = snapshot.topics.find((entry) => entry.id === id)
  if (!topic) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')
  assertCanManage(actor, topic, 'retire', meta)
  const before = auditSnapshotOf(snapshot, topic)

  if (topic.status === 'RETIRED') {
    throw new TaxonomyError('ALREADY_RETIRED', 'This node is already retired')
  }
  const nonRetiredChildren = childrenOf(snapshot, topic.id).filter(
    (child) => child.status !== 'RETIRED'
  )
  if (nonRetiredChildren.length > 0) {
    throw new TaxonomyError(
      'RETIRE_WITH_ACTIVE_CHILDREN',
      `Retire or move the ${nonRetiredChildren.length} child node(s) first — taxonomy changes must stay migration-safe`
    )
  }

  const updated = await db.topic.update({
    where: { id: topic.id },
    data: { status: 'RETIRED' },
  })
  invalidateTaxonomySnapshot()
  const detail = await toAdminDetail(actor, updated.id)
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.topicRetire,
    objectType: AUDIT_OBJECT_TYPES.topic,
    objectId: topic.id,
    objectLabel: topic.slug,
    before,
    after: { ...before, status: 'RETIRED' },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return detail
}

export async function setTopicLabels(
  actor: Actor,
  id: string,
  input: SetTopicLabelsInput,
  meta: AuditRequestMeta = {}
): Promise<AdminTopicDetail> {
  const snapshot = await getTaxonomySnapshot()
  const topic = snapshot.topics.find((entry) => entry.id === id)
  if (!topic) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')
  assertCanManage(actor, topic, 'setLabels', meta)
  const before = auditSnapshotOf(snapshot, topic)

  // One label per language (§13 language labels); language must exist + be ACTIVE.
  const seen = new Set<string>()
  for (const label of input.labels) {
    if (seen.has(label.language)) {
      throw new TaxonomyError('DUPLICATE_LABEL_LANGUAGE', `Multiple labels for language "${label.language}"`)
    }
    seen.add(label.language)
    const language = snapshot.languages.find((entry) => entry.code === label.language)
    if (!language) throw new TaxonomyError('LANGUAGE_NOT_FOUND', `Unknown language "${label.language}"`)
    if (language.status !== 'ACTIVE') {
      throw new TaxonomyError('LANGUAGE_INACTIVE', `Language "${language.name}" is not active`)
    }
  }

  const languageIdByCode = new Map(snapshot.languages.map((language) => [language.code, language.id]))
  await db.$transaction(async (tx) => {
    await tx.topicLabel.deleteMany({ where: { topicId: topic.id } })
    if (input.labels.length > 0) {
      await tx.topicLabel.createMany({
        data: input.labels.map((label) => ({
          topicId: topic.id,
          languageId: languageIdByCode.get(label.language)!,
          name: label.name,
          description: label.description ?? null,
        })),
      })
    }
  })
  invalidateTaxonomySnapshot()
  const detail = await toAdminDetail(actor, topic.id)
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.topicLabelsSet,
    objectType: AUDIT_OBJECT_TYPES.topic,
    objectId: topic.id,
    objectLabel: topic.slug,
    before: { labels: before.labels },
    after: {
      labels: input.labels.map((label) => ({
        language: label.language,
        name: label.name,
        description: label.description ?? null,
      })),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return detail
}

export async function setTopicAliases(
  actor: Actor,
  id: string,
  input: SetTopicAliasesInput,
  meta: AuditRequestMeta = {}
): Promise<AdminTopicDetail> {
  const snapshot = await getTaxonomySnapshot()
  const topic = snapshot.topics.find((entry) => entry.id === id)
  if (!topic) throw new TaxonomyError('TOPIC_NOT_FOUND', 'Topic not found')
  assertCanManage(actor, topic, 'setAliases', meta)
  const before = auditSnapshotOf(snapshot, topic)

  const seen = new Set<string>()
  for (const alias of input.aliases) {
    const key = alias.value.toLowerCase()
    if (seen.has(key)) {
      throw new TaxonomyError('DUPLICATE_ALIAS', `Duplicate alias "${alias.value}"`)
    }
    seen.add(key)
    if (alias.language) {
      const language = snapshot.languages.find((entry) => entry.code === alias.language)
      if (!language) throw new TaxonomyError('LANGUAGE_NOT_FOUND', `Unknown language "${alias.language}"`)
      if (language.status !== 'ACTIVE') {
        throw new TaxonomyError('LANGUAGE_INACTIVE', `Language "${language.name}" is not active`)
      }
    }
  }

  const languageIdByCode = new Map(snapshot.languages.map((language) => [language.code, language.id]))
  await db.$transaction(async (tx) => {
    await tx.topicAlias.deleteMany({ where: { topicId: topic.id } })
    if (input.aliases.length > 0) {
      await tx.topicAlias.createMany({
        data: input.aliases.map((alias) => ({
          topicId: topic.id,
          value: alias.value,
          languageId: alias.language ? languageIdByCode.get(alias.language)! : null,
        })),
      })
    }
  })
  invalidateTaxonomySnapshot()
  const detail = await toAdminDetail(actor, topic.id)
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.topicAliasesSet,
    objectType: AUDIT_OBJECT_TYPES.topic,
    objectId: topic.id,
    objectLabel: topic.slug,
    before: { aliases: before.aliases },
    after: {
      aliases: input.aliases.map((alias) => ({
        value: alias.value,
        language: alias.language ?? null,
      })),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return detail
}
