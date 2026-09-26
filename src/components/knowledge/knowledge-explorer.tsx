'use client'

/**
 * GlobIQ — Knowledge Explorer (P2-S1)
 *
 * Public browse surface for VERIFIED units under one canonical topic (Master
 * Plan §5 hierarchy, §7 canonical record, §14/§15 server-side country scoping,
 * §22 knowledge-page contract: quick fact + deeper explanation). Consumes the
 * same public APIs a future mobile client will use (§4/§39).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CalendarCheck,
  CalendarX2,
  CircleDot,
  Gauge,
  Loader2,
  RefreshCw,
  ScrollText,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label as UILabel } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface UnitSummary {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  scope: string
  countryIso: string | null
  orderIndex: number
  validity: { from: string | null; until: string | null; currentlyValid: boolean }
  updatedAt: string
}

interface UnitDetail extends UnitSummary {
  canonicalBody: string
  createdAt: string
  topic: {
    slug: string
    canonicalName: string
    label: string
    labelLanguage: string
    path: Array<{ slug: string; canonicalName: string; label: string }>
  }
}

interface ListResult {
  units: UnitSummary[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  topic: {
    slug: string
    canonicalName: string
    label: string
    labelLanguage: string
    path: Array<{ slug: string; canonicalName: string; label: string }>
  }
}

const TYPE_OPTIONS = ['', 'FACT', 'CONCEPT', 'TIMELINE', 'PERSON_PROFILE', 'PLACE_PROFILE', 'ORGANISATION_PROFILE', 'COMPARISON']
const DIFFICULTY_OPTIONS = ['', 'BASIC', 'INTERMEDIATE', 'ADVANCED']

const difficultyStyle: Record<string, string> = {
  BASIC: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-red-200 bg-red-50 text-red-700',
}

interface ExplorerProps {
  country: string
  language: string
  topic: string
  topics: Array<{ slug: string; label: string; depth: number; prefix: string }>
  onTopicChange: (slug: string) => void
}

export function KnowledgeExplorer({ country, language, topic, topics, onTopicChange }: ExplorerProps) {
  const [result, setResult] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<UnitDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const [difficultyFilter, setDifficultyFilter] = useState('')

  const fetchList = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ topic, country, language })
    if (typeFilter) params.set('type', typeFilter)
    if (difficultyFilter) params.set('difficulty', difficultyFilter)
    try {
      const response = await fetch(`/api/knowledge/units?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<ListResult>
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
      } else {
        setError(payload.error?.message ?? 'Could not load knowledge units')
        setResult(null)
      }
    } catch {
      setError('Network error — please retry.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [topic, country, language, typeFilter, difficultyFilter])

  useEffect(() => {
    setDetail(null)
    void fetchList()
  }, [fetchList])

  const openDetail = useCallback(
    async (slug: string) => {
      setDetailLoading(true)
      setDetail(null)
      try {
        const response = await fetch(
          `/api/knowledge/units/${slug}?country=${country}&language=${language}`,
          { cache: 'no-store' }
        )
        const payload = (await response.json()) as Envelope<{ unit: UnitDetail }>
        if (payload.status === 'ok' && payload.data) setDetail(payload.data.unit)
        else setError(payload.error?.message ?? 'Could not load the unit')
      } catch {
        setError('Network error — please retry.')
      } finally {
        setDetailLoading(false)
      }
    },
    [country, language]
  )

  // ---------- Detail view (§22 knowledge page) ----------
  if (detail) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => setDetail(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to {result?.topic.label ?? 'topic'}
          </Button>
          <nav aria-label="Breadcrumb" className="min-w-0 text-xs text-zinc-500">
            {detail.topic.path.map((entry, index) => (
              <span key={entry.slug} className="whitespace-nowrap">
                {index > 0 && <span className="mx-1 text-zinc-300">›</span>}
                {entry.label}
              </span>
            ))}
          </nav>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-600 font-normal text-white hover:bg-emerald-600">{detail.type.replace('_', ' ')}</Badge>
            <Badge variant="outline" className={`font-normal ${difficultyStyle[detail.difficulty] ?? ''}`}>
              <Gauge className="mr-1 h-3 w-3" aria-hidden="true" />
              {detail.difficulty}
            </Badge>
            {detail.scope === 'COUNTRY' && detail.countryIso && (
              <Badge variant="outline" className="border-teal-200 bg-teal-50 font-normal text-teal-700">
                {detail.countryIso} · country knowledge
              </Badge>
            )}
            {!detail.validity.currentlyValid && (
              <Badge variant="outline" className="border-red-200 bg-red-50 font-normal text-red-700">
                <CalendarX2 className="mr-1 h-3 w-3" aria-hidden="true" />
                Outside validity window
              </Badge>
            )}
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">{detail.canonicalName}</h3>
          {detail.canonicalSummary && (
            <p className="mt-1.5 rounded-md bg-emerald-50/60 px-3 py-2 text-sm font-medium text-emerald-900">
              {detail.canonicalSummary}
            </p>
          )}
          <div className="globiq-scroll mt-4 max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
            {detail.canonicalBody}
          </div>
          <p className="mt-4 text-xs text-zinc-400">
            Canonical record (§7) — representations in other languages/formats attach in P2-S2.
            {detail.validity.from && ` Valid from ${new Date(detail.validity.from).toLocaleDateString()}.`}
          </p>
        </div>
      </div>
    )
  }

  // ---------- List view ----------
  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-md">
        <div className="space-y-1.5">
          <UILabel htmlFor="ku-type-filter" className="text-xs text-zinc-500">
            Type
          </UILabel>
          <Select value={typeFilter || 'all'} onValueChange={(value) => setTypeFilter(value === 'all' ? '' : value)}>
            <SelectTrigger id="ku-type-filter" className="h-9 w-full bg-white" aria-label="Filter by type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {TYPE_OPTIONS.filter(Boolean).map((option) => (
                <SelectItem key={option} value={option}>
                  {option.replace('_', ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <UILabel htmlFor="ku-difficulty-filter" className="text-xs text-zinc-500">
            Difficulty
          </UILabel>
          <Select
            value={difficultyFilter || 'all'}
            onValueChange={(value) => setDifficultyFilter(value === 'all' ? '' : value)}
          >
            <SelectTrigger id="ku-difficulty-filter" className="h-9 w-full bg-white" aria-label="Filter by difficulty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              {DIFFICULTY_OPTIONS.filter(Boolean).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Topic header */}
      {result && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {result.topic.label}
              <span className="ml-2 font-normal text-zinc-400">
                {result.pagination.total} verified unit{result.pagination.total === 1 ? '' : 's'}
              </span>
            </p>
            <p className="truncate text-xs text-zinc-500">
              {result.topic.path.map((entry) => entry.label).join(' › ')}
            </p>
          </div>
          <Button variant="ghost" size="sm" className="h-8 gap-2" onClick={() => void fetchList()} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      )}

      {/* States */}
      {loading && !result ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error && !result ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-6 text-sm text-zinc-500" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          {error}
          {topics.length > 0 && (
            <button
              type="button"
              className="ml-auto shrink-0 font-medium text-emerald-700 hover:text-emerald-800"
              onClick={() => onTopicChange(topics[0]!.slug)}
            >
              Try {topics[0]!.label}
            </button>
          )}
        </p>
      ) : result && result.units.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
          No verified units here yet — switch topic or clear filters.
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {result?.units.map((unit) => (
            <li key={unit.id}>
              <button
                type="button"
                onClick={() => void openDetail(unit.slug)}
                className="w-full rounded-lg border border-zinc-200 bg-white p-3.5 text-left shadow-sm transition-colors hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                    {unit.type.replace('_', ' ')}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] font-normal ${difficultyStyle[unit.difficulty] ?? ''}`}>
                    {unit.difficulty}
                  </Badge>
                  {unit.scope === 'COUNTRY' && unit.countryIso && (
                    <Badge variant="outline" className="border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700">
                      {unit.countryIso}
                    </Badge>
                  )}
                  {!unit.validity.currentlyValid && (
                    <Badge variant="outline" className="border-red-200 bg-red-50 text-[10px] font-normal text-red-600">
                      outside window
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold leading-snug">{unit.canonicalName}</p>
                {unit.canonicalSummary && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">
                    {unit.canonicalSummary}
                  </p>
                )}
                <p className="mt-2 flex items-center gap-1 text-[10px] text-zinc-400">
                  <CircleDot className="h-3 w-3" aria-hidden="true" />
                  Updated {new Date(unit.updatedAt).toLocaleDateString()}
                  {unit.validity.from && (
                    <>
                      <CalendarCheck className="ml-2 h-3 w-3" aria-hidden="true" />
                      since {new Date(unit.validity.from).toLocaleDateString()}
                    </>
                  )}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detailLoading && (
        <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading unit…
        </p>
      )}
      {error && result && (
        <p className="flex items-center gap-1.5 text-xs text-red-600" role="alert">
          <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {error}
        </p>
      )}
      <p className="flex items-center gap-1.5 text-[10px] text-zinc-400">
        <ScrollText className="h-3 w-3" aria-hidden="true" />
        Public surface shows VERIFIED units only — drafts and corrections live in the admin console.
      </p>
    </div>
  )
}
