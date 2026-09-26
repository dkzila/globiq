'use client'

/**
 * GlobIQ — Content Section (P2-S2)
 *
 * Section shell for the ContentItem layer on the foundation page: locale bar
 * (country → language, §35) + canonical topic picker (§13) + VERIFIED unit
 * picker (§7 — representations attach to a canonical record) + Explorer/Admin
 * tabs. The Admin tab appears only for holders of `content:manage` (§38);
 * the server remains the sole authority on every operation (§20).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileStack, ShieldCheck } from 'lucide-react'

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
import { ContentAdmin } from './content-admin'
import { ContentExplorer } from './content-explorer'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
}

interface ApiCountry {
  isoCode: string
  name: string
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

interface TreeTopic {
  slug: string
  label: string
  type: string
  children: TreeTopic[]
}

export interface PublicUnitRef {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  scope: string
  countryIso: string | null
}

/** Flattens the public tree into picker options (BRANCH/TOPIC nodes hold units). */
function flattenTopics(
  nodes: TreeTopic[],
  depth = 0,
  prefix = ''
): Array<{ slug: string; label: string; depth: number; prefix: string }> {
  const out: Array<{ slug: string; label: string; depth: number; prefix: string }> = []
  for (const node of nodes) {
    if (node.type !== 'DOMAIN') {
      out.push({ slug: node.slug, label: node.label, depth, prefix })
    }
    out.push(...flattenTopics(node.children, depth + 1, node.label))
  }
  return out
}

export function ContentSection() {
  const privileged = useAuth((state) => state.permissions.includes('content:manage'))

  const [countries, setCountries] = useState<ApiCountry[] | null>(null)
  const [countryIso, setCountryIso] = useState('IN')
  const [language, setLanguage] = useState('en')
  const [topicSlug, setTopicSlug] = useState('fundamental-rights')
  const [unitSlug, setUnitSlug] = useState('fundamental-rights-articles-12-35')
  const [tab, setTab] = useState<'explore' | 'admin'>('explore')

  // Query-keyed option lists (loading = key mismatch — no sync setState in effect).
  const [topicState, setTopicState] = useState<{
    key: string
    topics: Array<{ slug: string; label: string; depth: number; prefix: string }>
  } | null>(null)
  const [unitState, setUnitState] = useState<{
    key: string
    units: PublicUnitRef[]
  } | null>(null)

  const topicKey = `${countryIso}:${language}`
  const topics = topicState?.key === topicKey ? topicState.topics : null
  const unitKey = `${countryIso}:${language}:${topicSlug}`
  const units = unitState?.key === unitKey ? unitState.units : null

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        setCountries(payload.status === 'ok' && payload.data ? payload.data.countries : [])
      })
      .catch(() => setCountries([]))
  }, [])

  const country = useMemo(
    () => countries?.find((entry) => entry.isoCode === countryIso) ?? null,
    [countries, countryIso]
  )

  // Topic options for the resolved locale — async boundary (setState after await).
  useEffect(() => {
    let cancelled = false
    async function run() {
      const response = await fetch(
        `/api/taxonomy/tree?country=${countryIso}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ tree: TreeTopic[] }>
      if (cancelled) return
      setTopicState({
        key: `${countryIso}:${language}`,
        topics: payload.status === 'ok' && payload.data ? flattenTopics(payload.data.tree) : [],
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [countryIso, language])

  // VERIFIED units under the selected topic (§5 chain Topic → KnowledgeUnit).
  useEffect(() => {
    let cancelled = false
    async function run() {
      const response = await fetch(
        `/api/knowledge/units?topic=${topicSlug}&country=${countryIso}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ units: PublicUnitRef[] }>
      if (cancelled) return
      setUnitState({
        key: `${countryIso}:${language}:${topicSlug}`,
        units: payload.status === 'ok' && payload.data ? payload.data.units : [],
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [countryIso, language, topicSlug])

  const onCountryChange = useCallback(
    (iso: string) => {
      setCountryIso(iso)
      const next = countries?.find((entry) => entry.isoCode === iso)
      setLanguage(next?.defaultLanguage?.code ?? 'en')
    },
    [countries]
  )

  // Keep the unit selection valid for the loaded list — derived, no sync
  // setState in effect: the first VERIFIED unit is the fallback (React 19).
  const effectiveUnitSlug = useMemo(() => {
    if (!units || units.length === 0) return unitSlug
    return units.some((unit) => unit.slug === unitSlug) ? unitSlug : units[0]!.slug
  }, [units, unitSlug])
  const selectedUnit = useMemo(
    () => units?.find((unit) => unit.slug === effectiveUnitSlug) ?? null,
    [units, effectiveUnitSlug]
  )

  return (
    <section aria-labelledby="content-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileStack className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="content-heading" className="text-xl font-semibold tracking-tight">
            Content items — representations of the record
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §7 · one record, many renderings · revisions §36
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        A ContentItem renders one KnowledgeUnit in <span className="font-medium text-zinc-800">one
        language × one format</span> (§7) — the fact is never re-entered. Public reads always serve
        the <span className="font-medium text-zinc-800">live revision snapshot</span>; corrections
        stage in the working copy and publish a <span className="font-medium text-zinc-800">new
        immutable revision</span> with a change summary (§36 — previous versions preserved forever).
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Browse context</CardTitle>
          <CardDescription>
            Country → language → topic → knowledge unit (§5). Content language exposure follows the
            country configuration (§35); scoping is server-side (§14/§15).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Locale + topic + unit bar (cells min-w-0 + w-full triggers so long
              labels truncate instead of stretching the grid on mobile) */}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-country">Country</UILabel>
              <Select value={countryIso} onValueChange={onCountryChange}>
                <SelectTrigger id="content-country" className="w-full" aria-label="Select country">
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
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-language">Language</UILabel>
              <Select value={language} onValueChange={setLanguage} disabled={!country}>
                <SelectTrigger id="content-language" className="w-full" aria-label="Select language">
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
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-topic">Topic</UILabel>
              <Select value={topicSlug} onValueChange={setTopicSlug} disabled={!topics}>
                <SelectTrigger id="content-topic" className="w-full" aria-label="Select topic">
                  <SelectValue placeholder={topics ? 'Choose a topic' : 'Loading…'} />
                </SelectTrigger>
                <SelectContent>
                  {(topics ?? []).map((entry) => (
                    <SelectItem key={entry.slug} value={entry.slug}>
                      {entry.prefix ? `${entry.prefix} › ` : ''}
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="content-unit">Knowledge unit</UILabel>
              <Select value={effectiveUnitSlug} onValueChange={setUnitSlug} disabled={!units}>
                <SelectTrigger id="content-unit" className="w-full" aria-label="Select knowledge unit">
                  <SelectValue
                    placeholder={units ? 'Choose a unit' : units === null ? 'Loading…' : 'No units here'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(units ?? []).map((entry) => (
                    <SelectItem key={entry.slug} value={entry.slug}>
                      {entry.canonicalName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label="Content views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'explore'}
              onClick={() => setTab('explore')}
              className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                tab === 'explore' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <FileStack className="h-4 w-4" aria-hidden="true" />
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
          ) : tab === 'explore' ? (
            <ContentExplorer country={countryIso} language={language} unit={selectedUnit} />
          ) : (
            <ContentAdmin
              country={countryIso}
              unit={selectedUnit}
              countryLanguages={country?.languages ?? []}
            />
          )}
        </CardContent>
      </Card>
    </section>
  )
}
