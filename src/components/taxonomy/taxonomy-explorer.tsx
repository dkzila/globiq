'use client'

/**
 * GlobIQ — Taxonomy Explorer (P1-S4)
 *
 * Public surface for the taxonomy module (Master Plan §13): the living tree
 * with localised labels and country-scope badges, topic search across names,
 * labels and aliases, and a detail panel showing the canonical record's
 * rendering dimensions (path, labels, aliases, children).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Globe2,
  Layers,
  Loader2,
  MapPin,
  Search,
  Tag,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  PublicTopicDetail,
  PublicTopicNode,
  TopicSearchResult,
} from '@/modules/taxonomy/types'

// ---------- API envelope ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

async function api<T>(path: string): Promise<Envelope<T>> {
  try {
    const response = await fetch(path, { cache: 'no-store' })
    return (await response.json()) as Envelope<T>
  } catch {
    return { status: 'error', error: { code: 'NETWORK', message: 'Network error — please retry.' } }
  }
}

// ---------- Props ----------

export interface ExplorerCountry {
  isoCode: string
  name: string
  defaultLanguage: string
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

interface TaxonomyExplorerProps {
  country: ExplorerCountry
  language: string
}

// ---------- Helpers ----------

const typeIcon = {
  DOMAIN: <Layers className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />,
  BRANCH: <Globe2 className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />,
  TOPIC: <Tag className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />,
}

function scopeBadge(node: { scope: string; countryIso: string | null }) {
  if (node.scope === 'GLOBAL') return null
  return (
    <Badge className="bg-amber-100 text-[10px] font-medium text-amber-800 hover:bg-amber-100">
      <MapPin className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
      {node.countryIso ?? 'country'}
    </Badge>
  )
}

// ---------- Tree row ----------

function TreeRow({
  node,
  depth,
  expanded,
  selected,
  onToggle,
  onSelect,
}: {
  node: PublicTopicNode
  depth: number
  expanded: Set<string>
  selected: string | null
  onToggle: (slug: string) => void
  onSelect: (slug: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.slug)
  const isSelected = selected === node.slug

  return (
    <li role="treeitem" aria-expanded={hasChildren ? isOpen : undefined} aria-selected={isSelected} className="min-w-0">
      <div
        className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors min-w-0 ${
          isSelected ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'hover:bg-zinc-100'
        }`}
        style={{ paddingLeft: `${depth * 16 + 4}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => onToggle(node.slug)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
            aria-label={isOpen ? `Collapse ${node.label}` : `Expand ${node.label}`}
          >
            {isOpen ? (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden="true" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.slug)}
          className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden="true">{typeIcon[node.type]}</span>
          <span className="truncate text-sm font-medium text-zinc-800">{node.label}</span>
          {node.labelLanguage === 'canonical' && (
            <span className="shrink-0 text-[10px] text-zinc-400">canonical</span>
          )}
          {scopeBadge(node)}
          {hasChildren && (
            <span className="ml-auto shrink-0 text-xs text-zinc-400">{node.children.length}</span>
          )}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <TreeRow
              key={child.slug}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selected={selected}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------- Explorer ----------

export function TaxonomyExplorer({ country, language }: TaxonomyExplorerProps) {
  const [tree, setTree] = useState<PublicTopicNode[] | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<PublicTopicDetail | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [query, setQuery] = useState('')
  const [searchState, setSearchState] = useState<{ query: string; results: TopicSearchResult[] } | null>(null)

  // Default-market segments omitted — mirrors the canonical URL contract (§16)
  const localeQuery = useMemo(() => {
    const params = new URLSearchParams()
    if (country.isoCode !== 'IN') params.set('country', country.isoCode)
    if (country.isoCode === 'IN' ? language !== 'en' : language !== country.defaultLanguage) {
      params.set('language', language)
    }
    return params
  }, [country, language])

  // Tree loads through an async boundary — setState only after the await.
  useEffect(() => {
    let cancelled = false
    async function run() {
      const result = await api<{ tree: PublicTopicNode[] }>(`/api/taxonomy/tree?${localeQuery}`)
      if (cancelled) return
      if (result.status === 'ok' && result.data) {
        setTree(result.data.tree)
        setTreeError(null)
      } else {
        setTree([])
        setTreeError(result.error?.message ?? 'Could not load the tree')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [localeQuery])

  const selectTopic = useCallback(
    async (slug: string) => {
      setSelected(slug)
      setDetail(null)
      setDetailError(null)
      setDetailLoading(true)
      const result = await api<PublicTopicDetail>(`/api/taxonomy/nodes/${slug}?${localeQuery}`)
      if (result.status === 'ok' && result.data) setDetail(result.data)
      else setDetailError(result.error?.message ?? 'Topic not found')
      setDetailLoading(false)
    },
    [localeQuery]
  )

  // Debounced search — setState only inside the async timeout callback.
  const trimmedQuery = query.trim()
  const searching = trimmedQuery.length > 0 && searchState?.query !== trimmedQuery
  const results =
    trimmedQuery.length > 0 && searchState?.query === trimmedQuery ? searchState.results : null

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length === 0) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: trimmed, ...localeQuery })
      const result = await api<{ results: TopicSearchResult[] }>(`/api/taxonomy/search?${params}`)
      if (cancelled) return
      setSearchState({
        query: trimmed,
        results: result.status === 'ok' && result.data ? result.data.results : [],
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, localeQuery])

  const toggle = useCallback((slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }, [])

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* ---------- Tree + search ---------- */}
      <Card className="min-w-0 border-zinc-200 shadow-sm lg:col-span-3">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Living tree — {country.name}</CardTitle>
          <CardDescription>
            One global framework with country extensions (§13). Labels render in{' '}
            <span className="font-medium text-zinc-700">{language}</span>, falling back to the
            canonical name.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search topics, labels, aliases… (e.g. FR, मौलिक, UN)"
              className="pl-9"
              aria-label="Search the taxonomy"
            />
          </div>

          {searching && (
            <p className="flex items-center gap-2 text-xs text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Searching…
            </p>
          )}

          {results && !searching && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3" role="region" aria-label="Search results">
              <p className="text-xs font-medium text-zinc-600">
                {results.length} result{results.length === 1 ? '' : 's'} for “{trimmedQuery}”
              </p>
              {results.length === 0 ? (
                <p className="mt-1 text-xs text-zinc-500">
                  Nothing matched in {country.name}. Try another term.
                </p>
              ) : (
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto globiq-scroll">
                  {results.map((result) => (
                    <li key={result.slug}>
                      <button
                        type="button"
                        onClick={() => void selectTopic(result.slug)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-white"
                      >
                        <span aria-hidden="true">{typeIcon[result.type]}</span>
                        <span className="truncate text-sm font-medium text-zinc-800">{result.label}</span>
                        <Badge variant="outline" className="shrink-0 text-[10px] font-normal text-zinc-500">
                          {result.matchedOn}
                        </Badge>
                        {scopeBadge(result)}
                        <span className="ml-auto hidden max-w-[40%] truncate text-xs text-zinc-400 sm:block">
                          {result.path.map((entry) => entry.canonicalName).join(' › ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!results && (
            <>
              {tree === null && !treeError ? (
                <div className="space-y-2 pt-1">
                  {[1, 2, 3, 4].map((row) => (
                    <Skeleton key={row} className="h-9 w-full" />
                  ))}
                </div>
              ) : treeError ? (
                <p className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {treeError}
                </p>
              ) : tree && tree.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
                  No taxonomy branches visible in this market yet.
                </p>
              ) : (
                <ul role="tree" aria-label="Taxonomy tree" className="max-h-[28rem] overflow-y-auto globiq-scroll">
                  {tree?.map((node) => (
                    <TreeRow
                      key={node.slug}
                      node={node}
                      depth={0}
                      expanded={expanded}
                      selected={selected}
                      onToggle={toggle}
                      onSelect={(slug) => void selectTopic(slug)}
                    />
                  ))}
                </ul>
              )}
              {tree && tree.length > 0 && (
                <p className="text-xs text-zinc-400">
                  {tree.length} root domain{tree.length === 1 ? '' : 's'} · click a node to inspect its
                  canonical record
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* ---------- Detail panel ---------- */}
      <Card className="min-w-0 border-zinc-200 shadow-sm lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Topic detail</CardTitle>
          <CardDescription>Canonical record + rendering dimensions (§6/§35)</CardDescription>
        </CardHeader>
        <CardContent>
          {!selected ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-8 text-center text-sm text-zinc-500">
              Select a node from the tree or search results.
            </p>
          ) : detailLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : detail ? (
            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {typeIcon[detail.node.type]}
                  <h3 className="text-base font-semibold text-zinc-900">{detail.node.label}</h3>
                  {scopeBadge(detail.node)}
                  <Badge variant="outline" className="text-[10px] font-normal text-zinc-500">
                    {detail.node.type}
                  </Badge>
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-400">/{detail.node.slug}</p>
              </div>

              <nav aria-label="Breadcrumb">
                <ol className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
                  {detail.path.map((entry, index) => (
                    <li key={entry.slug} className="flex items-center gap-1">
                      {index > 0 && <span aria-hidden="true">›</span>}
                      <span className={index === detail.path.length - 1 ? 'font-medium text-zinc-700' : ''}>
                        {entry.label}
                      </span>
                    </li>
                  ))}
                </ol>
              </nav>

              {detail.node.description && (
                <p className="text-sm leading-relaxed text-zinc-600">{detail.node.description}</p>
              )}

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Labels</p>
                {detail.labels.length === 0 ? (
                  <p className="mt-1 text-xs text-zinc-400">None — renders the canonical name.</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {detail.labels.map((label) => (
                      <Badge
                        key={label.language}
                        variant="secondary"
                        className="font-normal"
                        title={label.description ?? undefined}
                      >
                        {label.language}: {label.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Aliases</p>
                {detail.aliases.length === 0 ? (
                  <p className="mt-1 text-xs text-zinc-400">None</p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {detail.aliases.map((alias) => (
                      <Badge key={alias.value} variant="outline" className="font-normal text-zinc-600">
                        {alias.value}
                        {alias.language ? ` · ${alias.language}` : ''}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Children ({detail.childCount})
                </p>
                {detail.children.length === 0 ? (
                  <p className="mt-1 text-xs text-zinc-400">Leaf node</p>
                ) : (
                  <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto globiq-scroll">
                    {detail.children.map((child) => (
                      <li key={child.slug}>
                        <button
                          type="button"
                          onClick={() => void selectTopic(child.slug)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-zinc-100"
                        >
                          <span aria-hidden="true">{typeIcon[child.type]}</span>
                          <span className="truncate text-zinc-700">{child.label}</span>
                          {scopeBadge(child)}
                          {child.childCount > 0 && (
                            <span className="ml-auto text-xs text-zinc-400">{child.childCount}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {detailError ?? 'This topic is not visible in the selected country.'}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
