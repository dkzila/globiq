'use client'

/**
 * GlobIQ — the §16-mirroring hash router (P4-S2)
 *
 * The public URL space (Master Plan §16 / Appendix B) is:
 *   India default English   /                       → #/
 *   India non-default lang  /{language}/            → #/hi/
 *   Other country default   /{country}/             → #/uk/
 *   Other country + lang    /{country}/{language}/  → #/fr/… (per config)
 *   Topic hub               …/gk/{topic}/           → #/hi/gk/polity-governance/
 *   Knowledge page          …/gk/{topic}/{unit}/    → #/gk/fundamental-rights/article-32/
 *
 * Inside this sandbox the browser path must stay `/`, so the canonical URL
 * space is mirrored AFTER the hash — the same segment grammar, the same
 * build rules as the server's buildCanonicalUrl (§16: country + language +
 * object identity, defaults omitted), driven by the live country/language
 * configuration from GET /api/countries (§35 — only what each country
 * actually configures). Parsing is lenient: unknown segments fall back to
 * the default market, never an error page.
 *
 * `#account` (the header Sign-in anchor) maps to the foundation console
 * scrolled to the account section — the console keeps every verification
 * surface from P1→P4 reachable.
 *
 * Topic-unit pagination is part of the addressable state (`?page=2` after
 * the topic path) — derived from the hash, never duplicated in component
 * state, so the browser back button walks pages and a topic switch always
 * starts at page 1 (§37).
 */
import { useEffect, useState } from 'react'

import type { ApiCountry } from './types'

export interface AppRoute {
  view: 'home' | 'topic' | 'unit' | 'console'
  countryIso: string
  language: string
  topicSlug: string | null
  unitSlug: string | null
  /** Addressable topic-units page (≥1; only meaningful on the topic view). */
  page: number
  /** Console scroll target (e.g. 'account' for the header Sign-in anchor). */
  scrollTo: string | null
}

/** Parses a §16-shaped hash into an app route (lenient — defaults on unknown). */
export function parseHash(hash: string, config: ApiCountry[]): AppRoute {
  const defaultCountry = config.find((country) => country.isDefault) ?? config[0]
  const fallback: AppRoute = {
    view: 'home',
    countryIso: defaultCountry?.isoCode ?? 'IN',
    language: defaultCountry?.defaultLanguage.code ?? 'en',
    topicSlug: null,
    unitSlug: null,
    page: 1,
    scrollTo: null,
  }
  if (!defaultCountry) return fallback

  // Addressable query after the path (?page=N for topic units).
  const [pathPart, queryPart] = hash.split('?')
  const queryParams = new URLSearchParams(queryPart ?? '')
  const pageRaw = Number.parseInt(queryParams.get('page') ?? '1', 10)
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1

  const segments = pathPart.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (segments.length === 0) return fallback

  // Console + anchors (the foundation console keeps #account working).
  if (segments[0] === 'console') {
    return { ...fallback, view: 'console', scrollTo: null }
  }
  if (segments[0] === 'account') {
    return { ...fallback, view: 'console', scrollTo: 'account' }
  }

  let country = defaultCountry
  let language = defaultCountry.defaultLanguage.code
  let index = 0

  // First segment: a non-default country slug, or the default country's
  // non-default language (§16 — the default market's slug never appears).
  const first = segments[0]
  if (first !== 'gk') {
    const bySlug = config.find((entry) => !entry.isDefault && entry.slug === first)
    const defaultMarketLanguage = defaultCountry.languages.find(
      (entry) => entry.code === first && entry.code !== defaultCountry.defaultLanguage.code
    )
    if (bySlug) {
      country = bySlug
      index = 1
    } else if (defaultMarketLanguage) {
      language = defaultMarketLanguage.code
      index = 1
    }
  }

  // Language segment for the resolved country (non-default only, §35).
  const next = segments[index]
  if (next && next !== 'gk') {
    const languageMatch = country.languages.find(
      (entry) => entry.code === next && entry.code !== country.defaultLanguage.code
    )
    if (languageMatch) {
      language = languageMatch.code
      index += 1
    }
  }

  // Content path: /gk/{topic}/{unit}/ (§16).
  if (segments[index] === 'gk') {
    const topicSlug = segments[index + 1] ?? null
    const unitSlug = segments[index + 2] ?? null
    if (topicSlug && unitSlug) {
      return { view: 'unit', countryIso: country.isoCode, language, topicSlug, unitSlug, page: 1, scrollTo: null }
    }
    if (topicSlug) {
      return { view: 'topic', countryIso: country.isoCode, language, topicSlug, unitSlug: null, page, scrollTo: null }
    }
  }

  return { ...fallback, countryIso: country.isoCode, language }
}

/** Builds the §16-shaped hash for a route (defaults omitted, §16). */
export function buildHash(
  route: {
    view: AppRoute['view']
    countryIso: string
    language: string
    topicSlug: string | null
    unitSlug: string | null
    page?: number
  },
  config: ApiCountry[]
): string {
  if (route.view === 'console') return '#/console'
  const country = config.find((entry) => entry.isoCode === route.countryIso)
  if (!country) return '#/'

  const segments: string[] = []
  if (!country.isDefault) segments.push(country.slug)
  if (route.language !== country.defaultLanguage.code) segments.push(route.language)

  if (route.view === 'topic' && route.topicSlug) {
    segments.push('gk', route.topicSlug)
  } else if (route.view === 'unit' && route.topicSlug && route.unitSlug) {
    segments.push('gk', route.topicSlug, route.unitSlug)
  }

  const path = segments.length === 0 ? '#/' : `#/${segments.join('/')}/`
  // Addressable pagination — only when explicitly beyond page 1.
  if (route.view === 'topic' && route.page && route.page > 1) {
    return `${path}?page=${route.page}`
  }
  return path
}

/** Programmatic navigation — sets the hash; the hashchange listener re-parses. */
export function navigateHash(
  route: {
    view: AppRoute['view']
    countryIso: string
    language: string
    topicSlug: string | null
    unitSlug: string | null
    page?: number
  },
  config: ApiCountry[]
): void {
  const next = buildHash(route, config)
  if (window.location.hash === next) {
    // Same hash never fires hashchange — force a re-parse (idempotent nav).
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    return
  }
  window.location.hash = next
}

/** Subscribes to hash changes; returns null until the config has loaded. */
export function useHashRoute(config: ApiCountry[] | null): AppRoute | null {
  const [route, setRoute] = useState<AppRoute | null>(null)

  useEffect(() => {
    if (!config) return
    const apply = () => setRoute(parseHash(window.location.hash, config))
    apply()
    window.addEventListener('hashchange', apply)
    return () => window.removeEventListener('hashchange', apply)
  }, [config])

  return route
}
