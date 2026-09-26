/**
 * GlobIQ — Country & Locale: snapshot cache
 * Master Plan §29 (infrastructure evolution): local memory caching now,
 * swappable for a shared store at scale.
 *
 * All reads go through one immutable "snapshot" (countries with their
 * configured languages + the full language table). Writes invalidate it.
 * Snapshot hits cost zero database round-trips.
 */
import type { Language } from '@prisma/client'

import { db } from '@/lib/db'

export interface CountrySnapshotRow {
  id: string
  isoCode: string
  slug: string
  name: string
  timezone: string | null
  status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
  isDefault: boolean
  defaultLanguageId: string | null
  defaultLanguage: Language | null
  /** All languages configured for this country (any status — filter at use site). */
  languages: Language[]
}

export interface LocaleSnapshot {
  countries: CountrySnapshotRow[]
  languages: Language[]
  at: number
}

const SNAPSHOT_TTL_MS = 60_000

let snapshot: LocaleSnapshot | null = null

async function loadSnapshot(): Promise<LocaleSnapshot> {
  const [countries, links, languages] = await Promise.all([
    db.country.findMany({ include: { defaultLanguage: true } }),
    db.countryLanguage.findMany({ include: { language: true } }),
    db.language.findMany(),
  ])

  const byCountry = new Map<string, Language[]>()
  for (const link of links) {
    const list = byCountry.get(link.countryId) ?? []
    list.push(link.language)
    byCountry.set(link.countryId, list)
  }

  const rows: CountrySnapshotRow[] = countries
    .map((country) => ({
      id: country.id,
      isoCode: country.isoCode,
      slug: country.slug,
      name: country.name,
      timezone: country.timezone,
      status: country.status,
      isDefault: country.isDefault,
      defaultLanguageId: country.defaultLanguageId,
      defaultLanguage: country.defaultLanguage,
      languages: byCountry.get(country.id) ?? [],
    }))
    .sort((a, b) => (a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1))

  return { countries: rows, languages: languages.sort((a, b) => a.code.localeCompare(b.code)), at: Date.now() }
}

/** Returns a fresh-enough snapshot (cached up to SNAPSHOT_TTL_MS). */
export async function getSnapshot(): Promise<LocaleSnapshot> {
  if (snapshot === null || Date.now() - snapshot.at > SNAPSHOT_TTL_MS) {
    snapshot = await loadSnapshot()
  }
  return snapshot
}

/** Call after any country/language configuration write. */
export function invalidateSnapshot(): void {
  snapshot = null
}
