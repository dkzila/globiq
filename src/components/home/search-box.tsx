'use client'

/**
 * GlobIQ — homepage search box (P4-S2)
 *
 * The §34 homepage's search entry: the compact §17 product surface. Queries
 * GET /api/search in the reader's country/language, shows the top results
 * with their type badges and §16 canonical paths, and routes in-app: topic
 * results open the topic landing, unit results open the §22 knowledge page.
 * The full §17 regression console (demo chips, filters, engine health,
 * admin rebuild) stays on the foundation console's SearchSection.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Search, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

import type { Envelope } from './types'

// ---------- Types (mirror /api/search — the §17 contract subset) ----------

interface SearchItem {
  objectType: 'KNOWLEDGE_UNIT' | 'EXAM' | 'TOPIC'
  ref: string
  title: string
  /** §16 canonical path in the reader's language. */
  urlPath: string
  exams: Array<{ slug: string; name: string; code: string }>
}

interface SearchPayload {
  results: SearchItem[]
  pagination: { total: number }
}

// ---------- Component ----------

export interface SearchBoxProps {
  country: string
  language: string
  onOpenTopic: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
}

export function SearchBox({ country, language, onOpenTopic, onOpenUnit }: SearchBoxProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchItem[] | null>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const runSearch = useCallback(
    async (raw: string) => {
      const q = raw.trim()
      if (q.length === 0) {
        setResults(null)
        setError(null)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(q)}&country=${country}&language=${language}&page=1&pageSize=5`,
          { cache: 'no-store' }
        )
        const payload = (await response.json()) as Envelope<SearchPayload>
        if (payload.status === 'ok' && payload.data) {
          setResults(payload.data.results)
          setTotal(payload.data.pagination.total)
        } else {
          setError(payload.error?.message ?? 'Search failed')
          setResults(null)
        }
      } catch {
        setError('Could not reach the search service')
        setResults(null)
      } finally {
        setLoading(false)
      }
    },
    [country, language]
  )

  // Clear stale results when the locale changes (§14 — results are scoped).
  useEffect(() => {
    setResults(null)
    setQuery('')
    setError(null)
  }, [country, language])

  const clear = () => {
    setQuery('')
    setResults(null)
    setError(null)
    inputRef.current?.focus()
  }

  const openResult = (item: SearchItem) => {
    const segments = item.urlPath.split('/').filter(Boolean)
    const gkIndex = segments.indexOf('gk')
    if (item.objectType === 'TOPIC' && gkIndex !== -1 && segments[gkIndex + 1]) {
      onOpenTopic(segments[gkIndex + 1])
    } else if (item.objectType === 'KNOWLEDGE_UNIT' && gkIndex !== -1 && segments[gkIndex + 2]) {
      onOpenUnit(segments[gkIndex + 1], segments[gkIndex + 2])
    }
    // Exam results display their §16 path — the exam/syllabus SEO pages are P4-S3.
  }

  return (
    <div className="w-full">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch(query)
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
            aria-hidden="true"
          />
          <Input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search topics, knowledge, exams…"
            aria-label="Search GlobIQ"
            className="h-11 rounded-lg border-zinc-200 bg-white pl-9 pr-9 text-base shadow-sm focus-visible:ring-emerald-500"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={clear}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <Button
          type="submit"
          className="h-11 gap-2 bg-emerald-600 px-4 text-white hover:bg-emerald-700"
          disabled={loading || query.trim().length === 0}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="hidden sm:inline">Search</span>
        </Button>
      </form>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      {loading && (
        <div className="mt-3 space-y-2 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!loading && results && results.length === 0 && (
        <p className="mt-3 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-500 shadow-sm">
          No results for “{query.trim()}”. Try another spelling, or browse the categories below.
        </p>
      )}

      {!loading && results && results.length > 0 && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-white shadow-sm">
          <ul className="divide-y divide-zinc-100">
            {results.map((item) => {
              const openable = item.objectType === 'TOPIC' || item.objectType === 'KNOWLEDGE_UNIT'
              const content = (
                <div className="flex min-h-[44px] items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className="shrink-0 border-zinc-200 bg-zinc-50 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                      >
                        {item.objectType === 'KNOWLEDGE_UNIT' ? 'unit' : item.objectType.toLowerCase()}
                      </Badge>
                      <p className="truncate text-sm font-medium text-zinc-900">{item.title}</p>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-400">
                      {item.urlPath}
                    </p>
                  </div>
                  {item.exams.length > 0 && (
                    <Badge
                      variant="secondary"
                      className="hidden shrink-0 font-normal sm:inline-flex"
                      title={item.exams.map((exam) => exam.name).join(', ')}
                    >
                      {item.exams[0].name}
                      {item.exams.length > 1 ? ` +${item.exams.length - 1}` : ''}
                    </Badge>
                  )}
                </div>
              )
              return (
                <li key={`${item.objectType}:${item.ref}`}>
                  {openable ? (
                    <button
                      type="button"
                      onClick={() => openResult(item)}
                      className="w-full text-left transition-colors hover:bg-emerald-50/60 focus-visible:bg-emerald-50/60 focus-visible:outline-none"
                    >
                      {content}
                    </button>
                  ) : (
                    <div
                      className="cursor-default"
                      title="Exam pages arrive with the exam/syllabus SEO surface (P4-S3)"
                    >
                      {content}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {total > results.length && (
            <p className="border-t border-zinc-100 px-3 py-2 text-xs text-zinc-400">
              {results.length} of {total} matches — refine the query to narrow further.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
