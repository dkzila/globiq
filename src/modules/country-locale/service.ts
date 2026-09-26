/**
 * GlobIQ — Country & Locale: domain service
 * Master Plan §14 (country first-class, India default root market), §15 (geo
 * is a routing signal; data scoping happens server-side), §16 (canonical URL
 * generation), §35 (per-country language exposure, data-driven i18n), §37
 * (domain-oriented APIs).
 *
 * All locale reads flow through the cached snapshot; configuration writes
 * validate the URL space and invalidate the cache. The future web middleware
 * (P4) and mobile clients both reuse resolveLocaleContext / resolveFromPath.
 */
import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
} from '@/modules/audit'
import { getSnapshot, invalidateSnapshot, type CountrySnapshotRow } from './cache'
import { buildCanonicalUrl } from './url'
import type {
  AdminLanguage,
  LocaleResolution,
  PublicCountry,
} from './types'
import type {
  CreateCountryInput,
  CreateLanguageInput,
  SetCountryLanguagesInput,
  UpdateCountryInput,
  UpdateLanguageInput,
} from './validation'

/** Request context captured in the audit trail (§30). */
export interface LocaleRequestMeta {
  ip?: string | null
  userAgent?: string | null
}

function auditRefOf(actor: Actor) {
  return { userId: actor.userId, email: actor.email, role: actor.role }
}

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type LocaleErrorCode =
  | 'COUNTRY_NOT_FOUND'
  | 'COUNTRY_INACTIVE'
  | 'LANGUAGE_NOT_FOUND'
  | 'LANGUAGE_NOT_CONFIGURED'
  | 'LANGUAGE_INACTIVE'
  | 'ISO_TAKEN'
  | 'SLUG_TAKEN'
  | 'CODE_TAKEN'
  | 'URL_COLLISION'
  | 'DEFAULT_COUNTRY_IMMUTABLE'
  | 'DEFAULT_LANGUAGE_REQUIRED'
  | 'DEFAULT_LANGUAGE_NOT_CONFIGURED'
  | 'LANGUAGE_IN_USE'

const ERROR_STATUS: Record<LocaleErrorCode, number> = {
  COUNTRY_NOT_FOUND: 404,
  COUNTRY_INACTIVE: 404,
  LANGUAGE_NOT_FOUND: 404,
  LANGUAGE_NOT_CONFIGURED: 400,
  LANGUAGE_INACTIVE: 400,
  ISO_TAKEN: 409,
  SLUG_TAKEN: 409,
  CODE_TAKEN: 409,
  URL_COLLISION: 409,
  DEFAULT_COUNTRY_IMMUTABLE: 403,
  DEFAULT_LANGUAGE_REQUIRED: 400,
  DEFAULT_LANGUAGE_NOT_CONFIGURED: 400,
  LANGUAGE_IN_USE: 409,
}

export class LocaleError extends Error {
  readonly code: LocaleErrorCode
  readonly status: number

  constructor(code: LocaleErrorCode, message: string) {
    super(message)
    this.name = 'LocaleError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/** Maps a thrown LocaleError to envelope data (§37); null for other errors. */
export function toLocaleErrorResponse(error: unknown): { message: string; code: LocaleErrorCode; status: number } | null {
  if (error instanceof LocaleError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}

// ---------- Serialization ----------

function activeLanguageRefs(country: CountrySnapshotRow) {
  return country.languages
    .filter((language) => language.status === 'ACTIVE')
    .sort((a, b) => (a.code === country.defaultLanguage?.code ? -1 : b.code === country.defaultLanguage?.code ? 1 : a.code.localeCompare(b.code)))
    .map((language) => ({
      code: language.code,
      name: language.name,
      nativeName: language.nativeName,
      direction: language.direction as 'LTR' | 'RTL',
      url: buildCanonicalUrl(country, language, country.defaultLanguage?.code ?? language.code),
    }))
}

function toPublicCountry(country: CountrySnapshotRow): PublicCountry {
  if (!country.defaultLanguage) {
    // Configuration invariant violation — surface as a 503-style failure.
    throw new LocaleError('DEFAULT_LANGUAGE_REQUIRED', `Country ${country.isoCode} has no default language configured`)
  }
  return {
    isoCode: country.isoCode,
    slug: country.slug,
    name: country.name,
    timezone: country.timezone,
    status: country.status,
    isDefault: country.isDefault,
    defaultLanguage: { code: country.defaultLanguage.code, name: country.defaultLanguage.name },
    languages: activeLanguageRefs(country),
  }
}

// ---------- Public reads ----------

/** Public country list — INACTIVE countries are hidden (§38 public surface). */
export async function listPublicCountries(): Promise<PublicCountry[]> {
  const snapshot = await getSnapshot()
  return snapshot.countries
    .filter((country) => country.status !== 'INACTIVE')
    .map(toPublicCountry)
}

/** Accepts ISO code or slug. Returns null when unknown or INACTIVE. */
export async function getPublicCountry(isoOrSlug: string): Promise<PublicCountry | null> {
  const snapshot = await getSnapshot()
  const key = isoOrSlug.trim()
  const country =
    snapshot.countries.find((c) => c.slug === key.toLowerCase()) ??
    snapshot.countries.find((c) => c.isoCode === key.toUpperCase())
  if (!country || country.status === 'INACTIVE') return null
  return toPublicCountry(country)
}

/**
 * Admin read-back: resolves a country regardless of status (config writes
 * must be able to see the row they just changed, including INACTIVE).
 */
async function getCountryIncludingInactive(isoOrSlug: string): Promise<PublicCountry> {
  const snapshot = await getSnapshot()
  const key = isoOrSlug.trim()
  const country =
    snapshot.countries.find((c) => c.slug === key.toLowerCase()) ??
    snapshot.countries.find((c) => c.isoCode === key.toUpperCase())
  if (!country) {
    throw new LocaleError('COUNTRY_NOT_FOUND', `Unknown country "${isoOrSlug}"`)
  }
  return toPublicCountry(country)
}

// ---------- Locale resolution (§15/§16) ----------

async function requireDefaultCountry(): Promise<CountrySnapshotRow> {
  const snapshot = await getSnapshot()
  const country = snapshot.countries.find((c) => c.isDefault)
  if (!country) {
    throw new LocaleError('COUNTRY_NOT_FOUND', 'No default market is configured')
  }
  return country
}

function findConfiguredActiveLanguage(country: CountrySnapshotRow, code: string) {
  return country.languages.find((l) => l.code === code && l.status === 'ACTIVE')
}

function buildResolution(
  country: CountrySnapshotRow,
  language: { code: string; name: string; nativeName: string | null; direction: 'LTR' | 'RTL' },
  extra: { isCanonical: boolean; remainingPath?: string }
): LocaleResolution {
  const defaultLanguageCode = country.defaultLanguage?.code ?? language.code
  return {
    country: {
      isoCode: country.isoCode,
      slug: country.slug,
      name: country.name,
      timezone: country.timezone,
      status: country.status,
      isDefault: country.isDefault,
    },
    language,
    canonicalUrl: buildCanonicalUrl(country, language, defaultLanguageCode),
    isCanonical: extra.isCanonical,
    isDefaultCountry: country.isDefault,
    isDefaultLanguage: language.code === defaultLanguageCode,
    ...(extra.remainingPath !== undefined ? { remainingPath: extra.remainingPath } : {}),
  }
}

/**
 * Resolves a locale context from explicit params (slug or ISO accepted for
 * country). Lenient: redundant segments (default language given explicitly)
 * resolve with `isCanonical: false` so callers can redirect (§16).
 */
export async function resolveLocaleContext(input: {
  country?: string
  language?: string
}): Promise<LocaleResolution> {
  const snapshot = await getSnapshot()
  const defaultCountry = await requireDefaultCountry()

  let country: CountrySnapshotRow | null = null
  let countryWasExplicit = false

  if (input.country) {
    const key = input.country.trim()
    country =
      snapshot.countries.find((c) => c.slug === key.toLowerCase()) ??
      snapshot.countries.find((c) => c.isoCode === key.toUpperCase()) ??
      null
    if (!country) {
      throw new LocaleError('COUNTRY_NOT_FOUND', `Unknown country "${key}"`)
    }
    if (country.status === 'INACTIVE') {
      throw new LocaleError('COUNTRY_INACTIVE', `Country "${country.name}" is not available`)
    }
    countryWasExplicit = true
  } else {
    country = defaultCountry
  }

  if (!country.defaultLanguage) {
    throw new LocaleError('DEFAULT_LANGUAGE_REQUIRED', `Country ${country.isoCode} has no default language configured`)
  }

  if (!input.language) {
    // Explicit default-market reference (/in/…) is never canonical (§16);
    // an explicit non-default country (/uk/) is.
    return buildResolution(country, country.defaultLanguage, {
      isCanonical: !countryWasExplicit || !country.isDefault,
    })
  }

  const code = input.language.trim().toLowerCase()
  const language = findConfiguredActiveLanguage(country, code)
  if (!language) {
    const known = snapshot.languages.find((l) => l.code === code)
    if (!known) throw new LocaleError('LANGUAGE_NOT_FOUND', `Unknown language "${code}"`)
    if (known.status !== 'ACTIVE') throw new LocaleError('LANGUAGE_INACTIVE', `Language "${known.name}" is not active`)
    throw new LocaleError(
      'LANGUAGE_NOT_CONFIGURED',
      `Language "${known.name}" is not available in ${country.name}`
    )
  }

  // Canonical only when neither segment is redundant: the language must not
  // be the country default, and the default market must not be re-referenced.
  return buildResolution(country, language, {
    isCanonical: language.code !== country.defaultLanguage.code && !(countryWasExplicit && country.isDefault),
  })
}

/**
 * Resolves locale from a URL path per §16:
 *   [country-slug]/[language-code]/<content-path>
 * Unknown leading segments fall through to the default market with the full
 * path preserved as content path (e.g. /gk/… stays intact).
 */
export async function resolveFromPath(path: string): Promise<LocaleResolution> {
  const snapshot = await getSnapshot()
  const defaultCountry = await requireDefaultCountry()

  const segments = path.split('/').filter((s) => s.length > 0)
  const [first, second] = segments

  let country: CountrySnapshotRow
  let languageCode: string | null = null
  let consumed = 0
  let isCanonical = true

  const countryBySlug = first
    ? snapshot.countries.find((c) => c.slug === first.toLowerCase())
    : undefined

  if (first && countryBySlug) {
    if (countryBySlug.status === 'INACTIVE') {
      throw new LocaleError('COUNTRY_INACTIVE', `Country "${countryBySlug.name}" is not available`)
    }
    country = countryBySlug
    consumed = 1
    // The default market's slug never appears in canonical URLs (§16).
    if (country.isDefault) isCanonical = false

    if (second) {
      const language = findConfiguredActiveLanguage(country, second.toLowerCase())
      if (language) {
        languageCode = language.code
        consumed = 2
        if (!country.defaultLanguage || language.code === country.defaultLanguage.code) {
          isCanonical = false // default language segment is omitted canonically
        }
      }
    }
  } else if (first) {
    // Not a country slug — maybe a language of the default market (/hi/…).
    const language = findConfiguredActiveLanguage(defaultCountry, first.toLowerCase())
    if (language) {
      country = defaultCountry
      languageCode = language.code
      consumed = 1
      if (!defaultCountry.defaultLanguage || language.code === defaultCountry.defaultLanguage.code) {
        isCanonical = false // "/en/…" is non-canonical
      }
    } else {
      country = defaultCountry
    }
  } else {
    country = defaultCountry
  }

  if (!country.defaultLanguage) {
    throw new LocaleError('DEFAULT_LANGUAGE_REQUIRED', `Country ${country.isoCode} has no default language configured`)
  }

  const language =
    (languageCode ? country.languages.find((l) => l.code === languageCode && l.status === 'ACTIVE') : undefined) ??
    country.defaultLanguage

  const remaining = segments.slice(consumed)
  const remainingPath = remaining.length === 0 ? '/' : `/${remaining.join('/')}/`

  return buildResolution(country, language, { isCanonical, remainingPath })
}

// ---------- Shared scoping helpers (used by other modules, e.g. identity) ----------

export async function findActiveCountryByIso(iso: string): Promise<{ id: string; isoCode: string } | null> {
  const snapshot = await getSnapshot()
  const country = snapshot.countries.find((c) => c.isoCode === iso.toUpperCase())
  if (!country || country.status !== 'ACTIVE') return null
  return { id: country.id, isoCode: country.isoCode }
}

export async function findActiveLanguageByCode(code: string): Promise<{ id: string; code: string } | null> {
  const snapshot = await getSnapshot()
  const language = snapshot.languages.find((l) => l.code === code.toLowerCase())
  if (!language || language.status !== 'ACTIVE') return null
  return { id: language.id, code: language.code }
}

/** §35: a language is usable in a country only when configured there AND active. */
export async function isLanguageConfiguredForCountry(countryId: string, languageId: string): Promise<boolean> {
  const snapshot = await getSnapshot()
  const country = snapshot.countries.find((c) => c.id === countryId)
  if (!country) return false
  return country.languages.some((l) => l.id === languageId && l.status === 'ACTIVE')
}

// ---------- Admin: URL-space safety (§16) ----------

/**
 * The default market's non-default language codes live at the URL root
 * (/hi/…) and therefore may never equal any country slug (/{slug}/…).
 */
async function assertNoUrlCollision(languageCodes: string[]): Promise<void> {
  const snapshot = await getSnapshot()
  const countrySlugs = new Set(
    snapshot.countries.filter((c) => !c.isDefault).map((c) => c.slug)
  )
  const defaultCountry = snapshot.countries.find((c) => c.isDefault)
  if (!defaultCountry?.defaultLanguage) return

  for (const code of languageCodes) {
    if (code === defaultCountry.defaultLanguage.code) continue // never in URLs
    if (countrySlugs.has(code)) {
      throw new LocaleError(
        'URL_COLLISION',
        `Language "${code}" would collide with the country URL /${code}/ (§16) — rename the country slug first`
      )
    }
  }
}

// ---------- Admin: countries ----------

export async function createCountry(
  actor: Actor,
  input: CreateCountryInput,
  meta: LocaleRequestMeta = {}
): Promise<PublicCountry> {
  // §37: authorization at the service boundary (route guard is defense in depth).
  assertCan(actor, 'country-config:manage')

  const snapshot = await getSnapshot()
  if (snapshot.countries.some((c) => c.isoCode === input.isoCode)) {
    throw new LocaleError('ISO_TAKEN', `ISO code "${input.isoCode}" already exists`)
  }
  if (snapshot.countries.some((c) => c.slug === input.slug)) {
    throw new LocaleError('SLUG_TAKEN', `Slug "${input.slug}" is already in use`)
  }

  const language = snapshot.languages.find((l) => l.code === input.defaultLanguageCode)
  if (!language || language.status !== 'ACTIVE') {
    throw new LocaleError('LANGUAGE_NOT_FOUND', `Language "${input.defaultLanguageCode}" is not available`)
  }

  await assertNoUrlCollision([language.code])

  await db.$transaction(async (tx) => {
    const country = await tx.country.create({
      data: {
        isoCode: input.isoCode,
        slug: input.slug,
        name: input.name,
        timezone: input.timezone || null,
        status: input.status,
        defaultLanguageId: language.id,
      },
    })
    await tx.countryLanguage.create({
      data: { countryId: country.id, languageId: language.id },
    })
  })

  invalidateSnapshot()
  const created = await getCountryIncludingInactive(input.isoCode)
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.countryCreate,
    objectType: AUDIT_OBJECT_TYPES.country,
    objectId: input.isoCode,
    objectLabel: input.name,
    after: created,
    metadata: { isoCode: input.isoCode, slug: input.slug, status: input.status },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return created
}

export async function updateCountry(
  actor: Actor,
  iso: string,
  input: UpdateCountryInput,
  meta: LocaleRequestMeta = {}
): Promise<PublicCountry> {
  assertCan(actor, 'country-config:manage')

  const existing = await db.country.findUnique({ where: { isoCode: iso.toUpperCase() } })
  if (!existing) throw new LocaleError('COUNTRY_NOT_FOUND', `Unknown country "${iso}"`)
  const before = await getCountryIncludingInactive(iso)

  // The default root market's identity is frozen (India at "/" — §14/§16).
  if (existing.isDefault && (input.slug !== undefined || input.status !== undefined)) {
    throw new LocaleError(
      'DEFAULT_COUNTRY_IMMUTABLE',
      'The default root market cannot change its slug or status (it is served at "/")'
    )
  }

  const snapshot = await getSnapshot()
  if (input.slug && input.slug !== existing.slug) {
    if (snapshot.countries.some((c) => c.slug === input.slug && c.id !== existing.id)) {
      throw new LocaleError('SLUG_TAKEN', `Slug "${input.slug}" is already in use`)
    }
    // A new slug must not collide with the default market's root languages.
    await assertNoUrlCollision([input.slug])
  }

  let defaultLanguageId: string | undefined
  if (input.defaultLanguageCode) {
    const language = snapshot.languages.find((l) => l.code === input.defaultLanguageCode)
    if (!language || language.status !== 'ACTIVE') {
      throw new LocaleError('LANGUAGE_NOT_FOUND', `Language "${input.defaultLanguageCode}" is not available`)
    }
    const configured = await isLanguageConfiguredForCountry(existing.id, language.id)
    if (!configured) {
      throw new LocaleError(
        'DEFAULT_LANGUAGE_NOT_CONFIGURED',
        `Language "${language.code}" must be configured for ${existing.name} before becoming its default`
      )
    }
    defaultLanguageId = language.id
  }

  await db.country.update({
    where: { id: existing.id },
    data: {
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone || null } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(defaultLanguageId !== undefined ? { defaultLanguageId } : {}),
    },
  })

  invalidateSnapshot()
  const updated = await getCountryIncludingInactive(iso)
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.countryUpdate,
    objectType: AUDIT_OBJECT_TYPES.country,
    objectId: existing.isoCode,
    objectLabel: updated?.name ?? existing.name,
    before,
    after: updated,
    metadata: { isoCode: existing.isoCode, changedFields: Object.keys(input) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return updated
}

/** Replaces the full set of languages a country exposes (§35). */
export async function setCountryLanguages(
  actor: Actor,
  iso: string,
  input: SetCountryLanguagesInput,
  meta: LocaleRequestMeta = {}
): Promise<PublicCountry> {
  assertCan(actor, 'country-config:manage')

  const existing = await db.country.findUnique({
    where: { isoCode: iso.toUpperCase() },
    include: { defaultLanguage: true },
  })
  if (!existing) throw new LocaleError('COUNTRY_NOT_FOUND', `Unknown country "${iso}"`)
  const before = await getCountryIncludingInactive(iso)
  if (!existing.defaultLanguage) {
    throw new LocaleError('DEFAULT_LANGUAGE_REQUIRED', 'Country has no default language configured')
  }
  if (!input.languageCodes.includes(existing.defaultLanguage.code)) {
    throw new LocaleError(
      'DEFAULT_LANGUAGE_REQUIRED',
      `The default language "${existing.defaultLanguage.code}" must stay in the configured set`
    )
  }

  const snapshot = await getSnapshot()
  const codes = [...new Set(input.languageCodes)]
  const languages = codes.map((code) => {
    const language = snapshot.languages.find((l) => l.code === code)
    if (!language) throw new LocaleError('LANGUAGE_NOT_FOUND', `Unknown language "${code}"`)
    if (language.status !== 'ACTIVE') {
      throw new LocaleError('LANGUAGE_INACTIVE', `Language "${language.name}" is not active`)
    }
    return language
  })

  if (existing.isDefault) {
    await assertNoUrlCollision(codes)
  }

  await db.$transaction(async (tx) => {
    await tx.countryLanguage.deleteMany({ where: { countryId: existing.id } })
    await tx.countryLanguage.createMany({
      data: languages.map((language) => ({ countryId: existing.id, languageId: language.id })),
    })
  })

  invalidateSnapshot()
  const updated = await getCountryIncludingInactive(iso)
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.countryLanguagesSet,
    objectType: AUDIT_OBJECT_TYPES.country,
    objectId: existing.isoCode,
    objectLabel: updated?.name ?? existing.name,
    before,
    after: updated,
    metadata: {
      isoCode: existing.isoCode,
      languageCodes: codes,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return updated
}

// ---------- Admin: languages ----------

export async function listAdminLanguages(): Promise<AdminLanguage[]> {
  const snapshot = await getSnapshot()
  return snapshot.languages.map((language) => ({
    code: language.code,
    name: language.name,
    nativeName: language.nativeName,
    direction: language.direction as 'LTR' | 'RTL',
    status: language.status as 'ACTIVE' | 'INACTIVE',
    configuredInCountries: snapshot.countries.filter((c) =>
      c.languages.some((l) => l.id === language.id)
    ).length,
  }))
}

export async function createLanguage(
  actor: Actor,
  input: CreateLanguageInput,
  meta: LocaleRequestMeta = {}
): Promise<AdminLanguage> {
  assertCan(actor, 'language:manage')

  const snapshot = await getSnapshot()
  if (snapshot.languages.some((l) => l.code === input.code)) {
    throw new LocaleError('CODE_TAKEN', `Language code "${input.code}" already exists`)
  }

  await db.language.create({
    data: {
      code: input.code,
      name: input.name,
      nativeName: input.nativeName ?? null,
      direction: input.direction,
      status: input.status,
    },
  })

  invalidateSnapshot()
  const created = (await getSnapshot()).languages.find((l) => l.code === input.code)
  if (!created) throw new LocaleError('LANGUAGE_NOT_FOUND', 'Language was created but could not be read back')
  const result = {
    code: created.code,
    name: created.name,
    nativeName: created.nativeName,
    direction: created.direction as 'LTR' | 'RTL',
    status: created.status as 'ACTIVE' | 'INACTIVE',
    configuredInCountries: 0,
  }
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.languageCreate,
    objectType: AUDIT_OBJECT_TYPES.language,
    objectId: created.code,
    objectLabel: created.name,
    after: result,
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return result
}

export async function updateLanguage(
  actor: Actor,
  code: string,
  input: UpdateLanguageInput,
  meta: LocaleRequestMeta = {}
): Promise<AdminLanguage> {
  assertCan(actor, 'language:manage')

  const existing = await db.language.findUnique({ where: { code: code.toLowerCase() } })
  if (!existing) throw new LocaleError('LANGUAGE_NOT_FOUND', `Unknown language "${code}"`)
  const before = {
    code: existing.code,
    name: existing.name,
    nativeName: existing.nativeName,
    direction: existing.direction,
    status: existing.status,
  }

  const snapshot = await getSnapshot()

  if (input.status === 'INACTIVE') {
    const usedAsDefault = snapshot.countries.find((c) => c.defaultLanguageId === existing.id)
    if (usedAsDefault) {
      throw new LocaleError(
        'LANGUAGE_IN_USE',
        `"${existing.name}" is the default language of ${usedAsDefault.name} and cannot be deactivated`
      )
    }
    const configuredIn = snapshot.countries.filter((c) => c.languages.some((l) => l.id === existing.id))
    if (configuredIn.length > 0) {
      const names = configuredIn.map((c) => c.name).join(', ')
      throw new LocaleError(
        'LANGUAGE_IN_USE',
        `"${existing.name}" is still configured for: ${names}. Remove it from those countries first.`
      )
    }
  }

  await db.language.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.nativeName !== undefined ? { nativeName: input.nativeName ?? null } : {}),
      ...(input.direction !== undefined ? { direction: input.direction } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    },
  })

  invalidateSnapshot()
  const updated = (await getSnapshot()).languages.find((l) => l.id === existing.id)
  if (!updated) throw new LocaleError('LANGUAGE_NOT_FOUND', 'Language disappeared after update')
  const configuredInCountries = (await getSnapshot()).countries.filter((c) =>
    c.languages.some((l) => l.id === existing.id)
  ).length
  const result = {
    code: updated.code,
    name: updated.name,
    nativeName: updated.nativeName,
    direction: updated.direction as 'LTR' | 'RTL',
    status: updated.status as 'ACTIVE' | 'INACTIVE',
    configuredInCountries,
  }
  await recordAudit({
    actor: auditRefOf(actor),
    action: AUDIT_ACTIONS.languageUpdate,
    objectType: AUDIT_OBJECT_TYPES.language,
    objectId: existing.code,
    objectLabel: result.name,
    before,
    after: result,
    metadata: { changedFields: Object.keys(input) },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
  return result
}
