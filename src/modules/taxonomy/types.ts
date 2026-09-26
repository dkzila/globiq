/**
 * GlobIQ — Taxonomy module: public DTOs
 * Master Plan §6 (Topic model), §13 (one global framework + country
 * extensions), §35 (labels are rendering dimensions), §37 (API DTOs).
 */

export type TopicStatusPublic = 'ACTIVE' | 'INACTIVE' | 'RETIRED'
export type TopicTypePublic = 'DOMAIN' | 'BRANCH' | 'TOPIC'
export type TopicScopePublic = 'GLOBAL' | 'COUNTRY'

/** Actor context threaded through admin operations (roles are platform-level, §38). */
export interface TopicActor {
  role: 'ADMIN' | 'COUNTRY_ADMIN' | 'WRITER' | 'READER'
  /** user.homeCountryId — the country a COUNTRY_ADMIN administers. */
  countryId: string | null
}

/** Per-node permissions the admin UI renders from (scoped enforcement §38). */
export interface TopicPermissions {
  canEdit: boolean
  canMove: boolean
  canRetire: boolean
  canManageLabels: boolean
  canManageAliases: boolean
}

/** A node inside the public tree (country/language-aware, §13/§14). */
export interface PublicTopicNode {
  id: string
  slug: string
  canonicalName: string
  /** Localised name: requested language → country default → canonicalName. */
  label: string
  labelLanguage: string
  type: TopicTypePublic
  scope: TopicScopePublic
  countryIso: string | null
  childCount: number
  children: PublicTopicNode[]
}

export interface PublicTopicPathEntry {
  slug: string
  canonicalName: string
  label: string
}

export interface PublicTopicLabel {
  language: string
  name: string
  description: string | null
}

export interface PublicTopicAlias {
  value: string
  language: string | null
}

/** GET /api/taxonomy/nodes/{slug} payload. */
export interface PublicTopicDetail {
  node: {
    id: string
    slug: string
    canonicalName: string
    label: string
    labelLanguage: string
    description: string | null
    type: TopicTypePublic
    scope: TopicScopePublic
    countryIso: string | null
  }
  path: PublicTopicPathEntry[]
  labels: PublicTopicLabel[]
  aliases: PublicTopicAlias[]
  children: Array<{
    slug: string
    canonicalName: string
    label: string
    type: TopicTypePublic
    scope: TopicScopePublic
    countryIso: string | null
    childCount: number
  }>
  childCount: number
}

/** GET /api/taxonomy/search result row. */
export interface TopicSearchResult {
  slug: string
  canonicalName: string
  label: string
  labelLanguage: string
  type: TopicTypePublic
  scope: TopicScopePublic
  countryIso: string | null
  matchedOn: 'name' | 'slug' | 'label' | 'alias'
  path: PublicTopicPathEntry[]
}

/** A node inside the admin tree (all statuses visible to admins). */
export interface AdminTopicNode {
  id: string
  slug: string
  canonicalName: string
  type: TopicTypePublic
  status: TopicStatusPublic
  scope: TopicScopePublic
  countryIso: string | null
  orderIndex: number
  childCount: number
  children: AdminTopicNode[]
}

/** GET/PATCH payload for one admin node (full editing state). */
export interface AdminTopicDetail {
  id: string
  slug: string
  canonicalName: string
  description: string | null
  type: TopicTypePublic
  status: TopicStatusPublic
  scope: TopicScopePublic
  countryIso: string | null
  parentId: string | null
  parentSlug: string | null
  parentCanonicalName: string | null
  orderIndex: number
  labels: PublicTopicLabel[]
  aliases: PublicTopicAlias[]
  childCount: number
  childStatuses: { active: number; inactive: number; retired: number }
  path: Array<{ id: string; slug: string; canonicalName: string }>
  createdAt: string
  updatedAt: string
  permissions: TopicPermissions
}
