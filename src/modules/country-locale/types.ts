/**
 * GlobIQ — Country & Locale module: public DTOs
 * Master Plan §14 (country first-class), §16 (URL architecture), §35 (i18n).
 *
 * Every country exposes ONLY its own configured languages — there is no
 * global language list in public payloads (§35).
 */

export type CountryStatusPublic = 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
export type LanguageStatusPublic = 'ACTIVE' | 'INACTIVE'
export type LanguageDirectionPublic = 'LTR' | 'RTL'

/** A language as exposed within a country context. */
export interface PublicLanguageRef {
  code: string
  name: string
  nativeName: string | null
  direction: LanguageDirectionPublic
  /** Canonical home URL for this language inside the country (§16). */
  url: string
}

export interface PublicCountry {
  isoCode: string
  slug: string
  name: string
  timezone: string | null
  status: CountryStatusPublic
  /** True for the default root market (India) — its slug never appears in URLs. */
  isDefault: boolean
  defaultLanguage: { code: string; name: string }
  languages: PublicLanguageRef[]
}

/** Result of resolving a locale context (params or URL path). */
export interface LocaleResolution {
  country: {
    isoCode: string
    slug: string
    name: string
    timezone: string | null
    status: CountryStatusPublic
    isDefault: boolean
  }
  language: {
    code: string
    name: string
    nativeName: string | null
    direction: LanguageDirectionPublic
  }
  /** The canonical URL for this context (§16) — redirect target when non-canonical. */
  canonicalUrl: string
  /** False when the input used a redundant/omittable segment (e.g. /en/, /in/). */
  isCanonical: boolean
  isDefaultCountry: boolean
  isDefaultLanguage: boolean
  /** Only for path resolution: the content path left after locale segments. */
  remainingPath?: string
}

/** Admin-facing language record (platform configuration view). */
export interface AdminLanguage {
  code: string
  name: string
  nativeName: string | null
  direction: LanguageDirectionPublic
  status: LanguageStatusPublic
  /** Number of countries that configure this language. */
  configuredInCountries: number
}
