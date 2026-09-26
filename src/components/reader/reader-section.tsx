'use client'

/**
 * GlobIQ — Reader Section (P2-S5)
 *
 * The public READING surface on the foundation page (§38): pick a country +
 * language (§35 — only what the country configures), pick a canonical topic,
 * then open the assembled §22 knowledge page. This is deliberately a reader
 * experience, not an admin table — the same journey a student will make on
 * the real India homepage (P4-S2) through these same public APIs (§39).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, BookOpen, Globe2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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

import { KnowledgePageView } from './knowledge-page-view'

// ---------- Types (public API contracts) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface ApiCountry {
  isoCode: string
  name: string
  status: string
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

interface TreeTopic {
  slug: string
  label: string
  type: string
  children: TreeTopic[]
}

interface PublicUnit {
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  scope: 'GLOBAL' | 'COUNTRY'
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

// ---------- Section ----------

export function ReaderSection() {
  const [countries, setCountries] = useState<ApiCountry[] | null>(null)
  const [countryIso, setCountryIso] = useState('IN')
  const [language, setLanguage] = useState('en')
  const [topicSlug, setTopicSlug] = useState('fundamental-rights')
  const [topicState, setTopicState] = useState<{
    key: string
    topics: Array<{ slug: string; label: string; depth: number; prefix: string }>
  } | null>(null)
  const [unitState, setUnitState] = useState<{
    key: string
    units: PublicUnit[]
    error: string | null
  } | null>(null)
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)

  // Only ACTIVE countries are readable — COMING_SOON markets have no public
  // content yet (§15).
  const activeCountries = useMemo(
    () => (countries ?? []).filter((entry) => entry.status === 'ACTIVE'),
    [countries]
  )
  const country = useMemo(
    () => activeCountries.find((entry) => entry.isoCode === countryIso) ?? null,
    [activeCountries, countryIso]
  )

  const topicKey = `${countryIso}:${language}`
  const topics = topicState?.key === topicKey ? topicState.topics : null

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        setCountries(payload.status === 'ok' && payload.data ? payload.data.countries : [])
      })
      .catch(() => setCountries([]))
  }, [])

  // Public topic options for the resolved locale.
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

  // Units under the selected topic (public read path, P2-S1).
  const unitKey = `${countryIso}:${language}:${topicSlug}`
  useEffect(() => {
    let cancelled = false
    async function run() {
      const response = await fetch(
        `/api/knowledge/units?topic=${topicSlug}&country=${countryIso}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ units: PublicUnit[] }>
      if (cancelled) return
      setUnitState({
        key: `${countryIso}:${language}:${topicSlug}`,
        units: payload.status === 'ok' && payload.data ? payload.data.units : [],
        error: payload.status === 'error' ? payload.error?.message ?? 'No knowledge available' : null,
      })
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [countryIso, language, topicSlug])

  const onCountryChange = useCallback((iso: string) => {
    setCountryIso(iso)
    setSelectedUnit(null)
    const next = countries?.find((entry) => entry.isoCode === iso)
    setLanguage(next?.defaultLanguage?.code ?? 'en')
  }, [countries])

  const onOpenUnit = useCallback((slug: string) => {
    setSelectedUnit(slug)
  }, [])

  const onSwitchLanguage = useCallback((code: string) => {
    setLanguage(code)
  }, [])

  const units = unitState?.key === unitKey ? unitState : null

  return (
    <section aria-labelledby="reader-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="reader-heading" className="text-xl font-semibold tracking-tight">
            Read — the knowledge page
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §22 layers · format-aware §23 · public §38
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        The reader experience assembled from the canonical model: <span className="font-medium text-zinc-800">quick
        fact → deeper explanation → sources → related concepts → exam coverage</span> (§22). One unit renders in
        many languages and formats (§7) — the reading page never duplicates knowledge, it renders it.
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Browse knowledge</CardTitle>
          <CardDescription>
            Country → language → topic → unit. The §22 page opens inline — the same public API a
            mobile app will call (§39).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Context bar */}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="reader-country">Country</UILabel>
              <Select value={countryIso} onValueChange={onCountryChange}>
                <SelectTrigger id="reader-country" className="w-full" aria-label="Select country">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {activeCountries.map((entry) => (
                    <SelectItem key={entry.isoCode} value={entry.isoCode}>
                      {entry.name} ({entry.isoCode})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="min-w-0 space-y-1.5">
              <UILabel htmlFor="reader-language">Language</UILabel>
              <Select value={language} onValueChange={setLanguage} disabled={!country}>
                <SelectTrigger id="reader-language" className="w-full" aria-label="Select language">
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
              <UILabel htmlFor="reader-topic">Topic</UILabel>
              <Select value={topicSlug} onValueChange={setTopicSlug} disabled={!topics}>
                <SelectTrigger id="reader-topic" className="w-full" aria-label="Select topic">
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
          </div>

          <div className="rounded-lg border border-emerald-100 bg-emerald-50/40 p-1 text-center text-[11px] font-medium uppercase tracking-wide text-emerald-700">
            <span className="inline-flex items-center gap-1.5">
              <Globe2 className="h-3 w-3" aria-hidden="true" />
              {selectedUnit ? 'Knowledge page — assembled from one canonical record' : 'VERIFIED units under this topic'}
            </span>
          </div>

          {/* Reading view OR unit list */}
          {selectedUnit ? (
            <div className="space-y-3">
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setSelectedUnit(null)}
                aria-label="Back to the unit list"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                All units in this topic
              </Button>
              <KnowledgePageView
                unitRef={selectedUnit}
                country={countryIso}
                language={language}
                onOpenUnit={onOpenUnit}
                onSwitchLanguage={onSwitchLanguage}
              />
            </div>
          ) : !units ? (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : units.error ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" role="status">
              {units.error}
            </p>
          ) : units.units.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
              No VERIFIED units under this topic yet — the editorial workflow is still producing them.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2" aria-label="Knowledge units">
              {units.units.map((unit) => (
                <li key={unit.slug}>
                  <button
                    type="button"
                    onClick={() => onOpenUnit(unit.slug)}
                    className="group h-full min-h-[44px] w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-colors hover:border-emerald-300"
                    aria-label={`Open the knowledge page for ${unit.canonicalName}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug text-zinc-800 group-hover:text-emerald-700">
                        {unit.canonicalName}
                      </p>
                      {unit.scope === 'GLOBAL' && (
                        <Badge variant="outline" className="shrink-0 border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700">
                          Global
                        </Badge>
                      )}
                    </div>
                    {unit.canonicalSummary && (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                        {unit.canonicalSummary}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-1.5">
                      <Badge variant="secondary" className="font-normal text-[10px]">{unit.type}</Badge>
                      <Badge variant="outline" className="font-normal text-[10px] text-zinc-500">{unit.difficulty}</Badge>
                      <span className="ml-auto text-[10px] font-medium uppercase tracking-wide text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100">
                        Read →
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
