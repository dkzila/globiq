'use client'

/**
 * GlobIQ — Content Explorer (P2-S2)
 *
 * Public browse surface for the representations of one knowledge unit (Master
 * Plan §7: one canonical record, many renderings; §22 knowledge-page layers;
 * §35: only languages the country configures; §36: content always served from
 * the live revision — corrections never appear silently). Consumes the same
 * public APIs a future mobile client will use (§4/§39).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  CircleDot,
  FileText,
  History,
  Languages,
  Loader2,
  RefreshCw,
  ScrollText,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

import type { PublicUnitRef } from './content-section'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface PublicItem {
  id: string
  format: string
  language: { code: string; name: string; nativeName: string | null }
  title: string
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  updatedAt: string
}

interface ListResult {
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    scope: string
    countryIso: string | null
  }
  items: PublicItem[]
  languagesAvailable: string[]
}

interface DetailResult extends PublicItem {
  body: string
  revisionCount: number
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    scope: string
    countryIso: string | null
  }
}

const formatStyle: Record<string, string> = {
  FACT_CARD: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  EXPLAINER: 'border-teal-200 bg-teal-50 text-teal-700',
  REVISION_NOTE: 'border-amber-200 bg-amber-50 text-amber-700',
  CURRENT_EVENT_UPDATE: 'border-orange-200 bg-orange-50 text-orange-700',
  TIMELINE: 'border-lime-200 bg-lime-50 text-lime-700',
  PROFILE: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  COMPARISON: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700',
}

interface ExplorerProps {
  country: string
  language: string
  unit: PublicUnitRef | null
}

export function ContentExplorer({ country, language, unit }: ExplorerProps) {
  const [result, setResult] = useState<ListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<DetailResult | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchList = useCallback(async () => {
    if (!unit) {
      setResult(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ unit: unit.slug, country, language })
      const response = await fetch(`/api/content/items?${params.toString()}`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<ListResult>
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
      } else {
        setError(payload.error?.message ?? 'Could not load content')
        setResult(null)
      }
    } catch {
      setError('Network error — please retry.')
      setResult(null)
    } finally {
      setLoading(false)
    }
  }, [unit, country, language])

  useEffect(() => {
    setDetail(null)
    void fetchList()
  }, [fetchList])

  const openDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true)
      setDetail(null)
      try {
        const response = await fetch(`/api/content/items/${id}?country=${country}`, {
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ item: DetailResult }>
        if (payload.status === 'ok' && payload.data) setDetail(payload.data.item)
        else setError(payload.error?.message ?? 'Could not load the content')
      } catch {
        setError('Network error — please retry.')
      } finally {
        setDetailLoading(false)
      }
    },
    [country]
  )

  // ---------- No unit selected ----------
  if (!unit) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
        No verified unit in this topic — pick another topic to see its representations.
      </p>
    )
  }

  // ---------- Detail view (§22/§36: live revision only) ----------
  if (detail) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" className="h-8 gap-2" onClick={() => setDetail(null)}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to representations
          </Button>
          <p className="text-xs text-zinc-500">
            {detail.unit.canonicalName} · {detail.language.nativeName ?? detail.language.name}
          </p>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={`font-normal ${formatStyle[detail.format] ?? ''}`}>
              <FileText className="mr-1 h-3 w-3" aria-hidden="true" />
              {detail.format.replace(/_/g, ' ')}
            </Badge>
            <Badge variant="secondary" className="font-normal">
              <Languages className="mr-1 h-3 w-3" aria-hidden="true" />
              {detail.language.nativeName ?? detail.language.name}
            </Badge>
            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 font-normal text-zinc-600">
              <History className="mr-1 h-3 w-3" aria-hidden="true" />
              Revision {detail.revision.number}
              {detail.revisionCount > 1 ? ` of ${detail.revisionCount}` : ''}
            </Badge>
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight">{detail.title}</h3>
          <div className="globiq-scroll mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-zinc-700">
            {detail.body}
          </div>
          <p className="mt-4 text-xs text-zinc-400">
            Served from the live revision (published{' '}
            {new Date(detail.revision.publishedAt).toLocaleDateString()})
            {detail.revision.changeSummary && (
              <>
                {' '}· Update note: <span className="italic">{detail.revision.changeSummary}</span>
              </>
            )}
            . Previous versions are preserved (§36).
          </p>
        </div>
      </div>
    )
  }

  // ---------- List view ----------
  return (
    <div className="space-y-4">
      {/* Unit header */}
      {result && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {result.unit.canonicalName}
              <span className="ml-2 font-normal text-zinc-400">
                {result.items.length} published representation{result.items.length === 1 ? '' : 's'}
              </span>
            </p>
            {result.unit.canonicalSummary && (
              <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">
                {result.unit.canonicalSummary}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2"
            onClick={() => void fetchList()}
            disabled={loading}
          >
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
        <p
          className="flex items-start gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-6 text-sm text-zinc-500"
          role="status"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          {error}
        </p>
      ) : result && result.items.length === 0 ? (
        <div className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
          <p>
            No published representation in this language yet — the canonical record below is what
            every future rendering will be built from.
          </p>
          {result.languagesAvailable.length > 0 && (
            <p className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-xs">Also available in:</span>
              {result.languagesAvailable.map((code) => (
                <Badge key={code} variant="secondary" className="font-mono text-[10px] font-normal">
                  {code}
                </Badge>
              ))}
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-2" role="list">
          {result?.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void openDetail(item.id)}
                className="w-full rounded-lg border border-zinc-200 bg-white p-3.5 text-left shadow-sm transition-colors hover:border-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={`text-[10px] font-normal ${formatStyle[item.format] ?? ''}`}>
                    {item.format.replace(/_/g, ' ')}
                  </Badge>
                  <Badge variant="secondary" className="text-[10px] font-normal">
                    <Languages className="mr-1 h-3 w-3" aria-hidden="true" />
                    {item.language.code}
                  </Badge>
                  <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                    rev {item.revision.number}
                  </Badge>
                </div>
                <p className="mt-2 text-sm font-semibold leading-snug">{item.title}</p>
                {item.revision.changeSummary && (
                  <p className="mt-1 line-clamp-1 text-xs italic text-zinc-500">
                    Update: {item.revision.changeSummary}
                  </p>
                )}
                <p className="mt-2 flex items-center gap-1 text-[10px] text-zinc-400">
                  <CircleDot className="h-3 w-3" aria-hidden="true" />
                  Published {new Date(item.revision.publishedAt).toLocaleDateString()}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}

      {detailLoading && (
        <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading content…
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
        Every card renders the same canonical record (§7) — drafts and staged corrections never
        appear here.
      </p>
    </div>
  )
}
