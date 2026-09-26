'use client'

/**
 * GlobIQ — Knowledge Section (P2-S1)
 *
 * Section shell for the knowledge module on the foundation page: locale bar
 * (country → language, §35) + canonical topic picker (from the public taxonomy
 * tree, §13) + Explorer/Admin tabs. The Admin tab appears only for holders of
 * `knowledge:manage` (§38) — the server remains the sole authority on what
 * those roles may change (§20).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrainCircuit, ShieldCheck } from 'lucide-react'

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
import { KnowledgeAdmin } from './knowledge-admin'
import { KnowledgeExplorer } from './knowledge-explorer'

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

export function KnowledgeSection() {
  const privileged = useAuth((state) => state.permissions.includes('knowledge:manage'))

  const [countries, setCountries] = useState<ApiCountry[] | null>(null)
  const [countryIso, setCountryIso] = useState('IN')
  const [language, setLanguage] = useState('en')
  const [topicSlug, setTopicSlug] = useState('fundamental-rights')
  // Query-keyed topic options (loading = key mismatch — no sync setState in effect).
  const [topicState, setTopicState] = useState<{
    key: string
    topics: Array<{ slug: string; label: string; depth: number; prefix: string }>
  } | null>(null)
  const [tab, setTab] = useState<'explore' | 'admin'>('explore')

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

  const country = useMemo(
    () => countries?.find((entry) => entry.isoCode === countryIso) ?? null,
    [countries, countryIso]
  )

  // Public topic options for the resolved locale (BRANCH/TOPIC nodes hold
  // units). Loads through an async boundary — setState only after the await.
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

  const onCountryChange = useCallback((iso: string) => {
    setCountryIso(iso)
    const next = countries?.find((entry) => entry.isoCode === iso)
    setLanguage(next?.defaultLanguage?.code ?? 'en')
  }, [countries])

  return (
    <section aria-labelledby="knowledge-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="knowledge-heading" className="text-xl font-semibold tracking-tight">
            Knowledge units — the canonical record
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §7 · stored once · lifecycle §36
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Every unit is the single canonical truth for one piece of knowledge (§7) — country, language,
        format and depth are <span className="font-medium text-zinc-800">rendering dimensions</span>,
        never copies. Only <span className="font-medium text-zinc-800">VERIFIED</span> units are
        public; verified bodies are locked — corrections run through the OUTDATED cycle with a full
        audit trail (§36).
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Browse context</CardTitle>
          <CardDescription>
            Country → language → canonical topic (§5 hierarchy). Scoping is server-side (§14/§15).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {/* Locale + topic bar */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <UILabel htmlFor="knowledge-country">Country</UILabel>
              <Select value={countryIso} onValueChange={onCountryChange}>
                <SelectTrigger id="knowledge-country" aria-label="Select country">
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
              <UILabel htmlFor="knowledge-language">Language</UILabel>
              <Select value={language} onValueChange={setLanguage} disabled={!country}>
                <SelectTrigger id="knowledge-language" aria-label="Select language">
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
            <div className="space-y-1.5">
              <UILabel htmlFor="knowledge-topic">Canonical topic</UILabel>
              <Select value={topicSlug} onValueChange={setTopicSlug} disabled={!topics}>
                <SelectTrigger id="knowledge-topic" aria-label="Select topic">
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

          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label="Knowledge views">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'explore'}
              onClick={() => setTab('explore')}
              className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                tab === 'explore' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
              }`}
            >
              <BrainCircuit className="h-4 w-4" aria-hidden="true" />
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
            <KnowledgeExplorer
              country={countryIso}
              language={language}
              topic={topicSlug}
              topics={topics ?? []}
              onTopicChange={setTopicSlug}
            />
          ) : (
            <KnowledgeAdmin />
          )}
        </CardContent>
      </Card>
    </section>
  )
}
