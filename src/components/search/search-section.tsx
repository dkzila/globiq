'use client'

/**
 * GlobIQ — Search section (P4-S1)
 *
 * Master Plan §17 ("Search is a first-class product, not merely database text
 * search" — this section exercises every §17 clause against the live index),
 * §14/§15 (country scope resolved server-side; the COMING_SOON market
 * rejects with a clean error, never an IN-data leak), §16 (canonical paths
 * shipped as data — built by the API via buildCanonicalUrl, displayed here
 * as the result's destination), §29 (the engine identity surfaced on every
 * response — postgres-fts-v1 today, a managed engine later without a
 * domain-model change), §35 (reader-language surface first; canonical
 * fallback results are marked, never presented as translations that don't
 * exist), §37 (client-agnostic DTOs, deterministic ordering, pagination) and
 * §38 (public search + the admin index-rebuild surface, gated by
 * search:manage).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpen,
  Building2,
  Database,
  GraduationCap,
  Layers,
  Loader2,
  RefreshCw,
  Search as SearchIcon,
  Sparkles,
  Wand2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label as UILabel } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- API envelope + DTO mirrors (§37 client-agnostic contract) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface CountryRef {
  isoCode: string
  name: string
  status: string
  isDefault: boolean
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

interface PublicExamRef {
  slug: string
  name: string
  code: string
  currentVersion: { id: string; label: string } | null
}

interface ResultExamRef {
  slug: string
  name: string
  code: string
}

interface SearchItemDto {
  objectType: 'KNOWLEDGE_UNIT' | 'EXAM' | 'TOPIC'
  ref: string
  title: string
  summary: string | null
  languageCode: string
  presentedFrom: 'reader_language' | 'canonical_fallback'
  urlPath: string
  topicSlug: string | null
  topicLabel: string | null
  unitType: string | null
  difficulty: string | null
  exams: ResultExamRef[]
  matchedVia: string
  matchReasons: string[]
  score: number
}

interface SearchDto {
  query: {
    q: string
    country: { isoCode: string; name: string }
    language: { code: string; name: string; nativeName: string | null }
    type: string
    exam: ResultExamRef | null
  }
  results: SearchItemDto[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  index: { engine: string; documents: number; lastIndexedAt: string | null; tookMs: number }
}

interface ReindexDto {
  unitsIndexed: number
  topicsIndexed: number
  examsIndexed: number
  documentsWritten: number
  documentsRemoved: number
  tookMs: number
}

// ---------- Presentation helpers ----------

const TYPE_META: Record<SearchItemDto['objectType'], { label: string; icon: typeof BookOpen; style: string }> = {
  KNOWLEDGE_UNIT: { label: 'Knowledge', icon: BookOpen, style: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  EXAM: { label: 'Exam', icon: GraduationCap, style: 'border-amber-200 bg-amber-50 text-amber-800' },
  TOPIC: { label: 'Topic hub', icon: Layers, style: 'border-teal-200 bg-teal-50 text-teal-700' },
}

const MATCHED_VIA_LABEL: Record<string, string> = {
  exact_title: 'Exact title',
  exact_alias: 'Alias',
  title_prefix: 'Prefix',
  alias_prefix: 'Alias prefix',
  title_contains: 'Contains',
  full_text: 'Full text',
  neutral_full_text: 'Canonical / alias',
  fuzzy: 'Typo-tolerant',
  neutral_prefix: 'Canonical name',
  neutral_fuzzy: 'Typo (canonical)',
}

/** §17 demonstration queries — one chip per §17 capability. */
const DEMO_QUERIES: Array<{ q: string; language?: string; note: string }> = [
  { q: 'fundamental', note: 'prefix §17.1' },
  { q: 'FR', note: 'alias §17.5' },
  { q: 'chandrayan', note: 'typo §17.2' },
  { q: 'veto power', note: 'full text §17.3' },
  { q: 'upsc', note: 'exam §17.6' },
  { q: 'मौलिक', language: 'hi', note: 'hindi FTS §17.3' },
]

// ---------- Component ----------

export function SearchSection() {
  const { toast } = useToast()
  const token = useAuth((state) => state.token)

  const [countries, setCountries] = useState<CountryRef[]>([])
  const [countryIso, setCountryIso] = useState('IN')
  const [language, setLanguage] = useState('en')
  const [type, setType] = useState<'all' | 'units' | 'exams' | 'topics'>('all')
  const [exam, setExam] = useState('all')

  const [exams, setExams] = useState<PublicExamRef[]>([])
  const [query, setQuery] = useState('fundamental')
  const [result, setResult] = useState<SearchDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [reindexing, setReindexing] = useState(false)
  const [reindexResult, setReindexResult] = useState<ReindexDto | null>(null)

  const fetchSeq = useRef(0)

  const selectedCountry = countries.find((country) => country.isoCode === countryIso)
  const countryLanguages = selectedCountry?.languages ?? []

  // ---------- Country directory (once) ----------
  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: CountryRef[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          setCountries(payload.data.countries.filter((country) => country.status === 'ACTIVE'))
        }
      })
      .catch(() => undefined)
  }, [])

  // ---------- Language follows the country's configuration (§35) ----------
  useEffect(() => {
    if (!selectedCountry) return
    if (!countryLanguages.some((entry) => entry.code === language)) {
      setLanguage(selectedCountry.defaultLanguage.code)
    }
     
  }, [countryIso, countries])

  // ---------- Exam directory for the reader country (§14) ----------
  useEffect(() => {
    setExam('all')
    fetch(`/api/exams?country=${countryIso}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ exams: PublicExamRef[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          setExams(payload.data.exams.filter((entry) => entry.currentVersion !== null))
        } else {
          setExams([])
        }
      })
      .catch(() => setExams([]))
  }, [countryIso])

  // ---------- Search ----------
  const runSearch = useCallback(
    async (q: string, lang: string, typeFilter: string, examFilter: string) => {
      const trimmed = q.trim()
      if (!trimmed) {
        setError('Type something to search — names, topics, exams, or a phrase.')
        setResult(null)
        return
      }
      const seq = ++fetchSeq.current
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          q: trimmed,
          country: countryIso,
          language: lang,
          type: typeFilter,
          page: '1',
          pageSize: '10',
        })
        if (examFilter !== 'all') params.set('exam', examFilter)
        const response = await fetch(`/api/search?${params.toString()}`, { cache: 'no-store' })
        const payload = (await response.json()) as Envelope<SearchDto>
        if (seq !== fetchSeq.current) return
        if (payload.status === 'ok' && payload.data) {
          setResult(payload.data)
        } else {
          setResult(null)
          setError(payload.error?.message ?? 'Search failed')
        }
      } catch {
        if (seq !== fetchSeq.current) return
        setResult(null)
        setError('Could not reach /api/search')
      } finally {
        if (seq === fetchSeq.current) {
          setLoading(false)
          setLoadedOnce(true)
        }
      }
    },
    [countryIso]
  )

  // Initial search once countries are loaded
  useEffect(() => {
    if (countries.length > 0 && !loadedOnce) {
      void runSearch('fundamental', 'en', 'all', 'all')
    }
  }, [countries, loadedOnce, runSearch])

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    void runSearch(query, language, type, exam)
  }

  const applyDemo = (demo: (typeof DEMO_QUERIES)[number]) => {
    const lang = demo.language ?? selectedCountry?.defaultLanguage.code ?? 'en'
    setQuery(demo.q)
    setLanguage(lang)
    setExam('all')
    setType('all')
    void runSearch(demo.q, lang, 'all', 'all')
  }

  // ---------- Admin: full rebuild (§38 — search:manage) ----------
  const reindex = async () => {
    setReindexing(true)
    try {
      const response = await fetch('/api/search/admin/reindex', {
        method: 'POST',
        ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
      })
      const payload = (await response.json()) as Envelope<ReindexDto>
      if (payload.status === 'ok' && payload.data) {
        setReindexResult(payload.data)
        toast({
          title: 'Index rebuilt',
          description: `${payload.data.documentsWritten} documents written in ${payload.data.tookMs} ms`,
        })
        void runSearch(query, language, type, exam)
      } else {
        toast({
          title: 'Reindex not permitted',
          description: payload.error?.message ?? 'Sign in as the dev ADMIN to rebuild the index.',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Reindex failed', description: 'Could not reach the API.', variant: 'destructive' })
    } finally {
      setReindexing(false)
    }
  }

  // ---------- Render ----------

  return (
    <section aria-labelledby="search-heading" className="mt-10 space-y-4">
      <div className="flex items-center gap-2">
        <SearchIcon className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="search-heading" className="text-xl font-semibold tracking-tight">
          Search — the §17 product surface
        </h2>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        First-class search over the canonical store (§17): exact/prefix/alias matching, typo
        tolerance, language-aware full text (english/hindi Snowball configs), editorial aliases,
        country scope, exam-aware boosting with explanations, freshness — and one row per canonical
        object, never one per representation. Every result ships its §16 path and a
        why-it-matched explanation.
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Query the index</CardTitle>
          <CardDescription>
            The vendor-neutral engine is <code className="rounded bg-zinc-100 px-1 py-0.5 text-xs">postgres-fts-v1</code> (§29) —
            swap the adapter, not the domain model.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Controls — mobile-first grid (P3-S5 lesson) */}
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-12">
            <div className="space-y-1.5 lg:col-span-4">
              <UILabel htmlFor="search-q" className="text-xs font-medium text-zinc-500">
                Query
              </UILabel>
              <Input
                id="search-q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="e.g. fundamental rights, FR, chandrayan…"
                className="h-10 bg-white"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <UILabel className="text-xs font-medium text-zinc-500">Country (§14)</UILabel>
              <Select value={countryIso} onValueChange={setCountryIso}>
                <SelectTrigger className="h-10 bg-white">
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent>
                  {countries.map((country) => (
                    <SelectItem key={country.isoCode} value={country.isoCode}>
                      {country.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <UILabel className="text-xs font-medium text-zinc-500">Language (§35)</UILabel>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="h-10 bg-white">
                  <SelectValue placeholder="Language" />
                </SelectTrigger>
                <SelectContent>
                  {countryLanguages.map((entry) => (
                    <SelectItem key={entry.code} value={entry.code}>
                      {entry.nativeName ?? entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <UILabel className="text-xs font-medium text-zinc-500">Type</UILabel>
              <Select value={type} onValueChange={(value) => setType(value as typeof type)}>
                <SelectTrigger className="h-10 bg-white">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Everything</SelectItem>
                  <SelectItem value="units">Knowledge units</SelectItem>
                  <SelectItem value="exams">Exams</SelectItem>
                  <SelectItem value="topics">Topic hubs</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <UILabel className="text-xs font-medium text-zinc-500">Exam filter (§8)</UILabel>
              <Select value={exam} onValueChange={setExam}>
                <SelectTrigger className="h-10 bg-white">
                  <SelectValue placeholder="Exam" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Any exam</SelectItem>
                  {exams.map((entry) => (
                    <SelectItem key={entry.slug} value={entry.slug}>
                      {entry.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="lg:col-span-12">
              <Button type="submit" className="h-10 gap-2" disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <SearchIcon className="h-4 w-4" aria-hidden="true" />
                )}
                Search
              </Button>
            </div>
          </form>

          {/* §17 demo chips */}
          <div className="flex flex-wrap items-center gap-2" aria-label="§17 demonstration queries">
            <Wand2 className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
            {DEMO_QUERIES.map((demo) => (
              <button
                key={demo.q}
                type="button"
                onClick={() => applyDemo(demo)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
              >
                <span className="font-mono">{demo.q}</span>
                <span className="text-[10px] font-normal text-zinc-400">{demo.note}</span>
              </button>
            ))}
          </div>

          {/* Index health bar (§29 engine identity) */}
          {result && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
              <span className="inline-flex items-center gap-1.5 font-medium text-zinc-700">
                <Database className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                {result.index.documents} documents
              </span>
              <span className="font-mono">{result.index.engine}</span>
              <span>{result.index.tookMs} ms</span>
              {result.index.lastIndexedAt && (
                <span>indexed {new Date(result.index.lastIndexedAt).toLocaleTimeString()}</span>
              )}
              <span className="ml-auto">
                {result.pagination.total} result{result.pagination.total === 1 ? '' : 's'} ·{' '}
                {result.query.language.nativeName ?? result.query.language.name} ·{' '}
                {result.query.country.name}
                {result.query.exam ? ` · filtered to ${result.query.exam.code}` : ''}
              </span>
            </div>
          )}

          {/* Error state */}
          {error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}

          {/* Loading skeletons */}
          {loading && !result && (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          )}

          {/* Results */}
          {result && result.results.length === 0 && !loading && (
            <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 px-3 py-6 text-center text-sm text-zinc-500">
              No results — the index fills as editors publish canonical units, exams and topic hubs.
            </p>
          )}

          <ul className="space-y-2">
            {result?.results.map((item) => {
              const meta = TYPE_META[item.objectType]
              const Icon = meta.icon
              return (
                <li
                  key={`${item.objectType}:${item.ref}`}
                  className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm transition-colors hover:border-emerald-300"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${meta.style}`}
                        >
                          <Icon className="h-3 w-3" aria-hidden="true" />
                          {meta.label}
                        </span>
                        <p className="text-sm font-semibold leading-snug text-zinc-900">{item.title}</p>
                        {item.presentedFrom === 'canonical_fallback' && (
                          <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500">
                            canonical record — no {result.query.language.name} content yet (§35)
                          </span>
                        )}
                      </div>
                      {item.summary && (
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-600">
                          {item.summary}
                        </p>
                      )}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-emerald-800">
                          {item.urlPath}
                        </code>
                        <span className="text-[10px] text-zinc-400">§16</span>
                        {item.topicLabel && (
                          <Badge variant="outline" className="font-normal text-zinc-500">
                            {item.topicLabel}
                          </Badge>
                        )}
                        {item.unitType && (
                          <Badge variant="secondary" className="font-normal">
                            {item.unitType.replaceAll('_', ' ').toLowerCase()}
                          </Badge>
                        )}
                        {item.difficulty && (
                          <Badge variant="secondary" className="font-normal">
                            {item.difficulty.toLowerCase()}
                          </Badge>
                        )}
                      </div>
                      {/* §17.9 — why this result matched */}
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-amber-500" aria-hidden="true" />
                        <span className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                          {MATCHED_VIA_LABEL[item.matchedVia] ?? item.matchedVia}
                        </span>
                        {item.exams.slice(0, 3).map((entry) => (
                          <span
                            key={entry.slug}
                            className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
                            title={entry.name}
                          >
                            In current {entry.code} syllabus
                          </span>
                        ))}
                        {item.exams.length > 3 && (
                          <span className="text-[10px] text-zinc-500">+{item.exams.length - 3} more</span>
                        )}
                        {item.matchReasons
                          .filter((reason) => reason.startsWith('Recently'))
                          .map((reason) => (
                            <span
                              key={reason}
                              className="rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700"
                            >
                              {reason}
                            </span>
                          ))}
                      </div>
                    </div>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-400" title="Ranking score (dev transparency)">
                      {item.score}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </CardContent>
      </Card>

      {/* Admin: index rebuild (§38) */}
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 text-base">
            <Building2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Index operations (admin)
          </CardTitle>
          <CardDescription>
            The indexing pipeline re-projects documents on every publish/retire/mapping mutation;
            a full rebuild (POST /api/search/admin/reindex) is the ADMIN safety net — idempotent,
            audited, and it removes documents of objects that left the public surface (§36).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void reindex()}
              disabled={reindexing}
              className="h-10 gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${reindexing ? 'animate-spin' : ''}`} aria-hidden="true" />
              {reindexing ? 'Rebuilding…' : 'Rebuild full index'}
            </Button>
            {reindexResult && (
              <p className="text-xs text-zinc-600">
                {reindexResult.unitsIndexed} units · {reindexResult.topicsIndexed} topics ·{' '}
                {reindexResult.examsIndexed} exams → {reindexResult.documentsWritten} documents
                written, {reindexResult.documentsRemoved} removed ({reindexResult.tookMs} ms)
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
