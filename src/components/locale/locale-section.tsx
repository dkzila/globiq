'use client'

/**
 * GlobIQ — Country & language configuration section (P1-S3)
 *
 * Demonstrates the locale system end-to-end on the foundation page
 * (Master Plan §14–§16, §35):
 *  - switcher: pick any country and one of ITS configured languages (§35:
 *    never a global language list) and see the resolved context + canonical
 *    URL from /api/locale/resolve — the same contract the future middleware
 *    (P4) and mobile deep links will use;
 *  - country grid: /api/countries data with per-language canonical URLs.
 */

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  CheckCircle2,
  Compass,
  Globe,
  Link2,
  MapPin,
  Play,
  AlertTriangle,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Types (mirror /api/countries + /api/locale/resolve contracts) ----------

interface LanguageRef {
  code: string
  name: string
  nativeName: string | null
  direction: 'LTR' | 'RTL'
  url: string
}

interface PublicCountry {
  isoCode: string
  slug: string
  name: string
  timezone: string | null
  status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
  isDefault: boolean
  defaultLanguage: { code: string; name: string }
  languages: LanguageRef[]
}

interface LocaleResolution {
  country: {
    isoCode: string
    slug: string
    name: string
    timezone: string | null
    status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
    isDefault: boolean
  }
  language: { code: string; name: string; nativeName: string | null; direction: 'LTR' | 'RTL' }
  canonicalUrl: string
  isCanonical: boolean
  isDefaultCountry: boolean
  isDefaultLanguage: boolean
  remainingPath?: string
}

// ---------- Section ----------

export function LocaleSection() {
  const [countries, setCountries] = useState<PublicCountry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [countryKey, setCountryKey] = useState<string>('IN')
  const [languageCode, setLanguageCode] = useState<string>('en')
  const [resolution, setResolution] = useState<LocaleResolution | null>(null)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch('/api/countries', { cache: 'no-store' })
        const payload = (await response.json()) as
          | { status: 'ok'; data: { countries: PublicCountry[] } }
          | { status: 'error'; error: { message: string } }
        if (cancelled) return
        if (payload.status === 'ok') {
          setCountries(payload.data.countries)
        } else {
          setLoadError(payload.error.message)
        }
      } catch {
        if (!cancelled) setLoadError('Could not reach /api/countries')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const selectedCountry = countries?.find((c) => c.isoCode === countryKey) ?? null

  // Resolve the current selection whenever it changes (server is the source
  // of URL truth — §16: never build URLs client-side). Redundant params are
  // omitted exactly like canonical URL segments: the default market and the
  // country's default language are never referenced explicitly.
  useEffect(() => {
    if (!selectedCountry) return
    let cancelled = false
    void (async () => {
      setResolving(true)
      try {
        const params = new URLSearchParams()
        if (!selectedCountry.isDefault) params.set('country', selectedCountry.isoCode)
        if (languageCode !== selectedCountry.defaultLanguage.code) params.set('language', languageCode)
        // Default market + default language = the root "/" — resolve it as a
        // path, exactly how the future middleware will.
        const query = params.size > 0 ? `?${params.toString()}` : '?path=/'
        const response = await fetch(`/api/locale/resolve${query}`, { cache: 'no-store' })
        const payload = (await response.json()) as
          | { status: 'ok'; data: { resolution: LocaleResolution } }
          | { status: 'error'; error: { message: string } }
        if (cancelled) return
        if (payload.status === 'ok') {
          setResolution(payload.data.resolution)
        } else {
          setResolution(null)
        }
      } catch {
        if (!cancelled) setResolution(null)
      } finally {
        if (!cancelled) setResolving(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [countryKey, languageCode, selectedCountry])

  function handleCountryChange(value: string) {
    setCountryKey(value)
    const country = countries?.find((c) => c.isoCode === value)
    if (country) setLanguageCode(country.defaultLanguage.code)
  }

  return (
    <section aria-labelledby="locale-heading" className="mt-10 scroll-mt-24 space-y-4" id="locale">
      <div className="flex items-center gap-2">
        <Compass className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="locale-heading" className="text-xl font-semibold tracking-tight">
          Country &amp; language configuration
        </h2>
      </div>
      <p className="text-sm text-zinc-600">
        Country is a first-class, server-side scope (§14–§15). India is the default root market —
        English default, no <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">/in</code> or{' '}
        <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">/en</code> in URLs (§16). Switch
        deliberately — geo is only a routing signal, never a wall.
      </p>

      {/* ---------- Switcher + resolved context ---------- */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Locale switcher</CardTitle>
          <CardDescription>
            Each country exposes only its own configured languages (§35) — resolution and canonical
            URLs are computed server-side.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!countries && !loadError ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : loadError ? (
            <p className="text-sm text-red-600">{loadError}</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="country-select" className="text-sm font-medium text-zinc-700">
                    Country
                  </label>
                  <Select value={countryKey} onValueChange={handleCountryChange}>
                    <SelectTrigger id="country-select" className="h-11 w-full" aria-label="Country">
                      <SelectValue placeholder="Select a country" />
                    </SelectTrigger>
                    <SelectContent>
                      {(countries ?? []).map((country) => (
                        <SelectItem key={country.isoCode} value={country.isoCode}>
                          {country.name}
                          {country.isDefault ? ' · default market' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="language-select" className="text-sm font-medium text-zinc-700">
                    Language
                  </label>
                  <Select value={languageCode} onValueChange={setLanguageCode}>
                    <SelectTrigger
                      id="language-select"
                      className="h-11 w-full"
                      aria-label="Language"
                      disabled={!selectedCountry}
                    >
                      <SelectValue placeholder="Select a language" />
                    </SelectTrigger>
                    <SelectContent>
                      {(selectedCountry?.languages ?? []).map((language) => (
                        <SelectItem key={language.code} value={language.code}>
                          {language.name}
                          {language.nativeName ? ` · ${language.nativeName}` : ''}
                          {language.code === selectedCountry?.defaultLanguage.code ? ' (default)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Resolved context */}
              {resolving && !resolution ? (
                <Skeleton className="h-32 w-full" />
              ) : resolution ? (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                  role="status"
                  aria-live="polite"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex items-center gap-2 text-sm font-semibold">
                      <Globe className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                      {resolution.country.name} · {resolution.language.name}
                      {resolution.language.nativeName ? ` (${resolution.language.nativeName})` : ''}
                    </p>
                    {resolution.isCanonical ? (
                      <Badge className="gap-1 bg-emerald-600 font-normal text-white hover:bg-emerald-600">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Canonical
                      </Badge>
                    ) : (
                      <Badge className="gap-1 border-amber-200 bg-amber-50 font-normal text-amber-700 hover:bg-amber-50">
                        <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                        Non-canonical
                      </Badge>
                    )}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Link2 className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
                    <code className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-semibold text-emerald-400">
                      {resolution.canonicalUrl}
                    </code>
                    {!resolution.isCanonical && (
                      <span className="text-xs text-zinc-500">← the input would redirect here</span>
                    )}
                  </div>

                  <Separator className="my-3" />

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
                    <div>
                      <dt className="text-zinc-500">Country scope</dt>
                      <dd className="font-medium text-zinc-800">{resolution.country.isoCode}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Timezone</dt>
                      <dd className="font-medium text-zinc-800">{resolution.country.timezone ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Direction</dt>
                      <dd className="font-medium text-zinc-800">{resolution.language.direction}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Segments</dt>
                      <dd className="font-medium text-zinc-800">
                        {resolution.isDefaultCountry ? 'country omitted' : `/${resolution.country.slug}/`}
                        {' → '}
                        {resolution.isDefaultLanguage ? 'language omitted' : `/${resolution.language.code}/`}
                      </dd>
                    </div>
                  </dl>
                </motion.div>
              ) : (
                <p className="text-sm text-red-600">Could not resolve this combination.</p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- URL path playground (§16 middleware contract) ---------- */}
      <PathPlayground />

      {/* ---------- Country grid ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(countries ?? []).map((country) => (
          <motion.div
            key={country.isoCode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            <Card className="h-full border-zinc-200 shadow-sm">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{country.name}</CardTitle>
                  {country.status === 'ACTIVE' ? (
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Active</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                      Coming soon
                    </Badge>
                  )}
                </div>
                <CardDescription className="flex flex-wrap items-center gap-1.5 pt-1">
                  <MapPin className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                  <span className="font-mono text-xs">{country.isoCode}</span>
                  <Separator orientation="vertical" className="h-3" />
                  {country.timezone && <span className="text-xs">{country.timezone}</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {country.isDefault && (
                  <p className="text-xs font-medium text-emerald-700">Default root market — served at /</p>
                )}
                <div className="space-y-1.5">
                  {country.languages.map((language) => (
                    <div
                      key={language.code}
                      className="flex items-center justify-between gap-2 rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-zinc-700">
                        {language.name}
                        {language.code === country.defaultLanguage.code && (
                          <span className="text-[10px] font-normal text-emerald-700">default</span>
                        )}
                      </span>
                      <code className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[11px] text-zinc-600 ring-1 ring-zinc-200">
                        {language.url}
                      </code>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 w-full gap-1.5 text-xs"
                  onClick={() => handleCountryChange(country.isoCode)}
                  aria-label={`Preview ${country.name} in the switcher`}
                >
                  Try in switcher
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        ))}
        {!countries && !loadError && (
          <>
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </>
        )}
      </div>
    </section>
  )
}

// ---------- URL path playground (§16 resolution, as the middleware will do) ----------

const PLAYGROUND_EXAMPLES = ['/hi/gk/indian-constitution/', '/uk/en/gk/topic/', '/gk/solar-system/']

function PathPlayground() {
  const [path, setPath] = useState('/hi/gk/indian-constitution/')
  const [result, setResult] = useState<LocaleResolution | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function resolve(input: string) {
    const trimmed = input.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/locale/resolve?path=${encodeURIComponent(trimmed)}`, {
        cache: 'no-store',
      })
      const payload = (await response.json()) as
        | { status: 'ok'; data: { resolution: LocaleResolution } }
        | { status: 'error'; error: { code: string; message: string } }
      if (payload.status === 'ok') {
        setResult(payload.data.resolution)
      } else {
        setResult(null)
        setError(payload.error.message)
      }
    } catch {
      setResult(null)
      setError('Could not reach /api/locale/resolve')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">URL path resolver — the middleware contract</CardTitle>
        <CardDescription>
          How any incoming URL will be parsed (§16): locale segments are detected, validated and
          reduced to a canonical URL plus the remaining content path. Non-canonical URLs (e.g.{' '}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">/uk/en/…</code>) redirect to the
          canonical form.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault()
            void resolve(path)
          }}
        >
          <Input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="/uk/fr/gk/topic/"
            className="h-11 font-mono text-sm"
            aria-label="URL path to resolve"
            spellCheck={false}
          />
          <Button type="submit" className="h-11 gap-2 bg-emerald-600 text-white hover:bg-emerald-700" disabled={busy}>
            <Play className="h-4 w-4" aria-hidden="true" />
            {busy ? 'Resolving…' : 'Resolve'}
          </Button>
        </form>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Example paths">
          {PLAYGROUND_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => {
                setPath(example)
                void resolve(example)
              }}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 font-mono text-xs text-zinc-600 transition-colors hover:border-emerald-300 hover:text-emerald-700"
            >
              {example}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        {result && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">
                {result.country.name} · {result.language.name}
              </span>
              {result.isCanonical ? (
                <Badge className="gap-1 bg-emerald-600 font-normal text-white hover:bg-emerald-600">
                  <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                  Canonical
                </Badge>
              ) : (
                <Badge className="gap-1 border-amber-200 bg-amber-50 font-normal text-amber-700 hover:bg-amber-50">
                  <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                  Redirects
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-600">
              <span>
                canonical: <code className="rounded bg-white px-1.5 py-0.5 font-semibold text-emerald-700 ring-1 ring-zinc-200">{result.canonicalUrl}</code>
              </span>
              <span>
                content path: <code className="rounded bg-white px-1.5 py-0.5 ring-1 ring-zinc-200">{result.remainingPath ?? '/'}</code>
              </span>
            </div>
          </motion.div>
        )}
      </CardContent>
    </Card>
  )
}
