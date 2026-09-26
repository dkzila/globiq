/**
 * GlobIQ — Taxonomy: snapshot cache
 * Master Plan §29 (infrastructure evolution): local memory caching now,
 * swappable for a shared store later. The taxonomy is small but read on every
 * country/language-aware surface — reads go through one immutable snapshot and
 * writes invalidate it (same pattern as the country-locale snapshot).
 */
import { db } from '@/lib/db'

export interface TopicLabelRow {
  languageCode: string
  name: string
  description: string | null
}

export interface TopicAliasRow {
  value: string
  languageCode: string | null
}

export interface TopicRow {
  id: string
  slug: string
  canonicalName: string
  description: string | null
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  status: 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryId: string | null
  parentId: string | null
  orderIndex: number
  labels: TopicLabelRow[]
  aliases: TopicAliasRow[]
}

export interface LanguageRow {
  id: string
  code: string
  name: string
  status: 'ACTIVE' | 'INACTIVE'
}

export interface CountryRow {
  id: string
  isoCode: string
  name: string
  status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
}

export interface TaxonomySnapshot {
  topics: TopicRow[]
  languages: LanguageRow[]
  countries: CountryRow[]
  at: number
}

const SNAPSHOT_TTL_MS = 60_000

let snapshot: TaxonomySnapshot | null = null

async function loadSnapshot(): Promise<TaxonomySnapshot> {
  const [topics, languages, countries] = await Promise.all([
    db.topic.findMany({
      include: {
        labels: { include: { language: true } },
        aliases: { include: { language: true } },
      },
    }),
    db.language.findMany(),
    db.country.findMany(),
  ])

  const rows: TopicRow[] = topics.map((topic) => ({
    id: topic.id,
    slug: topic.slug,
    canonicalName: topic.canonicalName,
    description: topic.description,
    type: topic.type,
    status: topic.status,
    scope: topic.scope,
    countryId: topic.countryId,
    parentId: topic.parentId,
    orderIndex: topic.orderIndex,
    labels: topic.labels
      .map((label) => ({
        languageCode: label.language.code,
        name: label.name,
        description: label.description,
      }))
      .sort((a, b) => a.languageCode.localeCompare(b.languageCode)),
    aliases: topic.aliases
      .map((alias) => ({
        value: alias.value,
        languageCode: alias.language ? alias.language.code : null,
      }))
      .sort((a, b) => a.value.localeCompare(b.value)),
  }))

  rows.sort((a, b) => {
    if (a.orderIndex !== b.orderIndex) return a.orderIndex - b.orderIndex
    return a.canonicalName.localeCompare(b.canonicalName)
  })

  return {
    topics: rows,
    languages: languages.map((language) => ({
      id: language.id,
      code: language.code,
      name: language.name,
      status: language.status,
    })),
    countries: countries.map((country) => ({
      id: country.id,
      isoCode: country.isoCode,
      name: country.name,
      status: country.status,
    })),
    at: Date.now(),
  }
}

/** Returns a fresh-enough snapshot (cached up to SNAPSHOT_TTL_MS). */
export async function getTaxonomySnapshot(): Promise<TaxonomySnapshot> {
  if (snapshot === null || Date.now() - snapshot.at > SNAPSHOT_TTL_MS) {
    snapshot = await loadSnapshot()
  }
  return snapshot
}

/** Call after any taxonomy write. */
export function invalidateTaxonomySnapshot(): void {
  snapshot = null
}
