'use client'

/**
 * GlobIQ — Taxonomy Section (P1-S4)
 *
 * Section shell for the taxonomy module on the foundation page: locale bar
 * (country → one of its configured languages, §35) + Explorer/Admin tabs.
 * The admin tab appears only for privileged roles (§38) — but the server
 * remains the sole authority on what those roles may change.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListTree, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label as UILabel } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/stores/auth'
import { TaxonomyExplorer, type ExplorerCountry } from './taxonomy-explorer'
import { TaxonomyAdmin } from './taxonomy-admin'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
}

interface ApiCountry {
  isoCode: string
  name: string
  status: string
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

export function TaxonomySection() {
  const user = useAuth((state) => state.user)
  // Server-provided affordance (P1-S5): the Admin tab appears for anyone who
  // can manage taxonomy; the server re-checks every operation (§20, §37).
  const privileged = useAuth((state) => state.permissions.includes('taxonomy:manage'))

  const [countries, setCountries] = useState<ExplorerCountry[] | null>(null)
  const [countryIso, setCountryIso] = useState<string>('IN')
  const [language, setLanguage] = useState<string>('en')
  const [tab, setTab] = useState<'explore' | 'admin'>('explore')

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          setCountries(
            payload.data.countries.map((country) => ({
              isoCode: country.isoCode,
              name: country.name,
              defaultLanguage: country.defaultLanguage.code,
              languages: country.languages,
            }))
          )
        } else {
          setCountries([])
        }
      })
      .catch(() => setCountries([]))
  }, [])

  const country = useMemo(
    () => countries?.find((entry) => entry.isoCode === countryIso) ?? null,
    [countries, countryIso]
  )

  const onCountryChange = useCallback((iso: string) => {
    setCountryIso(iso)
    const next = countries?.find((entry) => entry.isoCode === iso)
    setLanguage(next?.defaultLanguage ?? 'en')
  }, [countries])

  return (
    <section aria-labelledby="taxonomy-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ListTree className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="taxonomy-heading" className="text-xl font-semibold tracking-tight">
            Taxonomy — one global framework
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §13 · country extensions · language labels
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Canonical topic tree with configurable domains, country-scoped extensions, localised labels
        and search aliases. Exams never appear here — they map to knowledge only through{' '}
        <span className="font-medium text-zinc-800">SyllabusNode → ExamMapping</span> (P3).
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Browse context</CardTitle>
          <CardDescription>
            Server-side country scoping (§14/§15) — switching markets changes what the tree shows.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Locale bar */}
          <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
            <div className="space-y-1.5">
              <UILabel htmlFor="taxonomy-country">Country</UILabel>
              <Select value={countryIso} onValueChange={onCountryChange}>
                <SelectTrigger id="taxonomy-country" aria-label="Select country">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(countries ?? []).map((entry) => (
                    <SelectItem key={entry.isoCode} value={entry.isoCode}>
                      {entry.name} ({entry.isoCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="taxonomy-language">Language</UILabel>
              <Select
                value={language}
                onValueChange={setLanguage}
                disabled={!country}
              >
                <SelectTrigger id="taxonomy-language" aria-label="Select language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(country?.languages ?? []).map((entry) => (
                    <SelectItem key={entry.code} value={entry.code}>
                      {entry.nativeName ?? entry.name} ({entry.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label="Taxonomy views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'explore'}
              onClick={() => setTab('explore')}
              className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                tab === 'explore' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <ListTree className="h-4 w-4" aria-hidden="true" />
              Explorer
            </button>
            {privileged && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'admin'}
                onClick={() => setTab('admin')}
                className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                  tab === 'admin' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                }`}
              >
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Admin console
              </button>
            )}
          </div>

          {/* Tab content */}
          {!countries ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : !country ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
              Selected market unavailable.
            </p>
          ) : tab === 'explore' ? (
            <TaxonomyExplorer country={country} language={language} />
          ) : (
            <TaxonomyAdmin />
          )}
        </CardContent>
      </Card>
    </section>
  )
}
