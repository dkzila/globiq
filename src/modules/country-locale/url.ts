/**
 * GlobIQ — Country & Locale: canonical URL builder (§16)
 *
 * The router must generate canonical URLs from country + language + object
 * identity — never by concatenating arbitrary user input (§16). These pure
 * functions are the single source of URL truth used by APIs, the future
 * middleware (P4) and any client that needs to construct links.
 *
 * Rules (§16 / Appendix B):
 *   India (default market)  + English (default)   →  /
 *   India                   + non-default lang    →  /{language}/
 *   Other country           + default language    →  /{country}/
 *   Other country           + alternate language  →  /{country}/{language}/
 */

export interface UrlCountryShape {
  slug: string
  isDefault: boolean
}

/**
 * Builds the canonical URL for a country + language + optional content path.
 * @param defaultLanguageCode the country's default language (segment omitted)
 */
export function buildCanonicalUrl(
  country: UrlCountryShape,
  language: { code: string },
  defaultLanguageCode: string,
  segments: readonly string[] = []
): string {
  const parts: string[] = []
  if (!country.isDefault) parts.push(country.slug)
  if (language.code !== defaultLanguageCode) parts.push(language.code)
  for (const segment of segments) {
    if (segment) parts.push(segment)
  }
  return parts.length === 0 ? '/' : `/${parts.join('/')}/`
}
