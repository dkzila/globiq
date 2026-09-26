'use client'

/**
 * GlobIQ — Source Registry (P2-S3)
 *
 * The §24 evidence registry: filterable list of Source records with the
 * verification summary, evidence registration (one canonical record per
 * normalized URL — §11 dedup applied to evidence), and the editor
 * verification workflow (verify / reject / recheck). Records are never
 * deleted (§36) — revoked trust is marked UNRELIABLE.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  Loader2,
  RefreshCw,
  ShieldX,
  Undo2,
} from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import type { Envelope, SourceRef } from './source-section'
import { sourceTypeStyle, verificationStyle } from './source-section'

interface RegistryResult {
  sources: SourceRef[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { UNVERIFIED: number; VERIFIED: number; UNRELIABLE: number }
}

interface UsageRow {
  itemId: string
  itemTitle: string
  format: string
  languageCode: string
  itemStatus: string
  unitSlug: string
  unitName: string
  claim: string | null
}

interface SourceDetail extends SourceRef {
  usage: UsageRow[]
}

const TYPE_OPTIONS = ['OFFICIAL', 'NEWS_MEDIA', 'INSTITUTIONAL', 'ACADEMIC', 'DATA', 'OTHER'] as const

const EMPTY_CREATE = {
  title: '',
  publisher: '',
  url: '',
  type: 'OFFICIAL',
  publishedAt: '',
  retrievedAt: '',
  notes: '',
}

export function SourceRegistry() {
  const token = useAuth((state) => state.token)
  const { toast } = useToast()

  const [result, setResult] = useState<RegistryResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [verificationFilter, setVerificationFilter] = useState('')
  const [page, setPage] = useState(1)

  // Query-keyed expanded detail (React 19 — no sync setState in effects).
  const [detailState, setDetailState] = useState<{ key: string; data: SourceDetail } | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ ...EMPTY_CREATE })
  const [createErrors, setCreateErrors] = useState<Record<string, string[]> | null>(null)
  const [creating, setCreating] = useState(false)

  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [rejectTarget, setRejectTarget] = useState<SourceRef | null>(null)

  const fetchRegistry = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ page: String(page), pageSize: '10' })
    if (search.trim()) params.set('q', search.trim())
    if (typeFilter) params.set('type', typeFilter)
    if (verificationFilter) params.set('verification', verificationFilter)
    try {
      const response = await fetch(`/api/content/admin/sources?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<RegistryResult>
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
      } else {
        setError(payload.error?.message ?? 'Could not load the registry')
      }
    } catch {
      setError('Network error — please retry.')
    } finally {
      setLoading(false)
    }
  }, [token, page, search, typeFilter, verificationFilter])

  useEffect(() => {
    void fetchRegistry()
  }, [fetchRegistry])

  // Expanded source detail — loads lazily, keyed to the source id + a refresh tick.
  useEffect(() => {
    if (!expandedId || !token) return
    const currentId = expandedId
    let cancelled = false
    async function run() {
      const response = await fetch(`/api/content/admin/sources/${currentId}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ source: SourceDetail }>
      if (!cancelled && payload.status === 'ok' && payload.data) {
        setDetailState({ key: currentId, data: payload.data.source })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [expandedId, token, result])

  const detail = detailState && expandedId && detailState.key === expandedId ? detailState.data : null

  const apiError = (payload: Envelope<unknown>): string =>
    payload.error?.message ?? 'The operation failed'

  const submitCreate = useCallback(async () => {
    if (!token) return
    setCreating(true)
    setCreateErrors(null)
    try {
      const response = await fetch('/api/content/admin/sources', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: createForm.title,
          publisher: createForm.publisher,
          url: createForm.url,
          type: createForm.type,
          ...(createForm.publishedAt ? { publishedAt: createForm.publishedAt } : {}),
          ...(createForm.retrievedAt ? { retrievedAt: createForm.retrievedAt } : {}),
          ...(createForm.notes ? { notes: createForm.notes } : {}),
        }),
      })
      const payload = (await response.json()) as Envelope<{ source: SourceRef }>
      if (payload.status === 'ok' && payload.data) {
        setCreateOpen(false)
        setCreateForm({ ...EMPTY_CREATE })
        toast({
          title: 'Evidence registered',
          description: 'Starts UNVERIFIED — run the verification workflow to mark it trusted (§24).',
        })
        void fetchRegistry()
      } else {
        setCreateErrors(
          (payload.error?.details as Record<string, string[]>) ?? { form: [apiError(payload)] }
        )
      }
    } catch {
      setCreateErrors({ form: ['Network error — please retry.'] })
    } finally {
      setCreating(false)
    }
  }, [token, createForm, toast, fetchRegistry])

  const runVerification = useCallback(
    async (source: SourceRef, action: 'verify' | 'reject' | 'recheck') => {
      if (!token) return
      setBusyAction(`${source.id}:${action}`)
      try {
        const response = await fetch(`/api/content/admin/sources/${source.id}/verify`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const payload = (await response.json()) as Envelope<{ source: SourceRef }>
        if (payload.status === 'ok' && payload.data) {
          const updated = payload.data.source
          setResult((current) =>
            current
              ? {
                  ...current,
                  sources: current.sources.map((entry) =>
                    entry.id === updated.id ? { ...entry, ...updated } : entry
                  ),
                  summary: {
                    ...current.summary,
                    [source.verification]: Math.max(0, current.summary[source.verification] - 1),
                    [updated.verification]: current.summary[updated.verification] + 1,
                  },
                }
              : current
          )
          toast({
            title:
              action === 'verify'
                ? 'Source verified'
                : action === 'reject'
                  ? 'Source marked UNRELIABLE'
                  : 'Source back under assessment',
            description:
              action === 'reject'
                ? 'Existing citations remain as preserved provenance history (§36).'
                : undefined,
          })
        } else {
          toast({ title: 'Verification failed', description: apiError(payload), variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
      } finally {
        setBusyAction(null)
      }
    },
    [token, toast]
  )

  const totalPages = result?.pagination.totalPages ?? 1

  return (
    <div className="space-y-4">
      {/* §24 trust summary */}
      {result && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500">Registry:</span>
          <Badge variant="outline" className={`font-normal ${verificationStyle.VERIFIED}`}>
            <BadgeCheck className="mr-1 h-3 w-3" aria-hidden="true" />
            {result.summary.VERIFIED} verified
          </Badge>
          <Badge variant="outline" className={`font-normal ${verificationStyle.UNVERIFIED}`}>
            {result.summary.UNVERIFIED} unverified
          </Badge>
          <Badge variant="outline" className={`font-normal ${verificationStyle.UNRELIABLE}`}>
            {result.summary.UNRELIABLE} unreliable
          </Badge>
          <span className="text-zinc-400">· {result.pagination.total} evidence record{result.pagination.total === 1 ? '' : 's'}</span>
        </div>
      )}

      {/* Filters + create */}
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex min-w-0 flex-1 items-center gap-2 sm:flex-none"
          onSubmit={(event) => {
            event.preventDefault()
            setPage(1)
            void fetchRegistry()
          }}
        >
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title, publisher, URL…"
            className="h-8 w-full bg-white text-xs sm:w-[220px]"
            aria-label="Search sources"
          />
        </form>
        <Select
          value={typeFilter || 'all'}
          onValueChange={(value) => {
            setTypeFilter(value === 'all' ? '' : value)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-8 w-full bg-white text-xs sm:w-[150px]" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TYPE_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option.replace(/_/g, ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={verificationFilter || 'all'}
          onValueChange={(value) => {
            setVerificationFilter(value === 'all' ? '' : value)
            setPage(1)
          }}
        >
          <SelectTrigger className="h-8 w-full bg-white text-xs sm:w-[150px]" aria-label="Filter by verification">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="UNVERIFIED">Unverified</SelectItem>
            <SelectItem value="VERIFIED">Verified</SelectItem>
            <SelectItem value="UNRELIABLE">Unreliable</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-2"
          onClick={() => void fetchRegistry()}
          disabled={loading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
        <Button size="sm" className="h-8 gap-2" onClick={() => setCreateOpen((open) => !open)}>
          <FilePlus2 className="h-4 w-4" aria-hidden="true" />
          Register evidence
        </Button>
      </div>

      {/* Create form */}
      {createOpen && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="text-sm font-semibold">Register evidence (§24)</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            One canonical record per URL — evidence is deduplicated, never duplicated. New records
            start UNVERIFIED.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <UILabel htmlFor="source-create-title" className="text-xs text-zinc-500">Title</UILabel>
              <Input
                id="source-create-title"
                className="bg-white"
                value={createForm.title}
                onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))}
                placeholder="e.g. ISRO — Chandrayaan-3 soft-landing update"
                aria-invalid={Boolean(createErrors?.title)}
              />
              {createErrors?.title && <p className="text-xs text-red-600">{createErrors.title[0]}</p>}
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="source-create-publisher" className="text-xs text-zinc-500">Publisher</UILabel>
              <Input
                id="source-create-publisher"
                className="bg-white"
                value={createForm.publisher}
                onChange={(event) => setCreateForm((form) => ({ ...form, publisher: event.target.value }))}
                placeholder="e.g. ISRO, The Hindu, PIB"
                aria-invalid={Boolean(createErrors?.publisher)}
              />
              {createErrors?.publisher && <p className="text-xs text-red-600">{createErrors.publisher[0]}</p>}
            </div>
            <div className="min-w-0 space-y-1.5 sm:col-span-2">
              <UILabel htmlFor="source-create-url" className="text-xs text-zinc-500">URL (http(s) — normalized on save)</UILabel>
              <Input
                id="source-create-url"
                className="bg-white"
                value={createForm.url}
                onChange={(event) => setCreateForm((form) => ({ ...form, url: event.target.value }))}
                placeholder="https://…"
                aria-invalid={Boolean(createErrors?.url)}
              />
              {createErrors?.url && <p className="text-xs text-red-600">{createErrors.url[0]}</p>}
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="source-create-type" className="text-xs text-zinc-500">Category (§24)</UILabel>
              <Select
                value={createForm.type}
                onValueChange={(value) => setCreateForm((form) => ({ ...form, type: value }))}
              >
                <SelectTrigger id="source-create-type" className="h-9 w-full bg-white" aria-label="Category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <UILabel htmlFor="source-create-published" className="text-xs text-zinc-500">Published</UILabel>
                <Input
                  id="source-create-published"
                  type="date"
                  className="bg-white"
                  value={createForm.publishedAt}
                  onChange={(event) => setCreateForm((form) => ({ ...form, publishedAt: event.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <UILabel htmlFor="source-create-retrieved" className="text-xs text-zinc-500">Retrieved</UILabel>
                <Input
                  id="source-create-retrieved"
                  type="date"
                  className="bg-white"
                  value={createForm.retrievedAt}
                  onChange={(event) => setCreateForm((form) => ({ ...form, retrievedAt: event.target.value }))}
                />
              </div>
            </div>
            <div className="min-w-0 space-y-1.5 sm:col-span-2">
              <UILabel htmlFor="source-create-notes" className="text-xs text-zinc-500">Editorial notes (optional)</UILabel>
              <Textarea
                id="source-create-notes"
                className="min-h-[60px] bg-white"
                value={createForm.notes}
                onChange={(event) => setCreateForm((form) => ({ ...form, notes: event.target.value }))}
                placeholder="Internal context for the editorial team"
              />
            </div>
          </div>
          {createErrors?.form && <p className="mt-2 text-xs text-red-600">{createErrors.form[0]}</p>}
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => void submitCreate()} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
              Register
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {loading && !result ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : error && !result ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          {error}
        </p>
      ) : result && result.sources.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
          No evidence records match — register the first source above.
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {result?.sources.map((source) => (
            <li key={source.id} className="rounded-lg border border-zinc-200 bg-white shadow-sm">
              <div className="p-3.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={`text-[10px] font-normal ${verificationStyle[source.verification] ?? ''}`}>
                    {source.verification === 'VERIFIED' && <BadgeCheck className="mr-1 h-3 w-3" aria-hidden="true" />}
                    {source.verification === 'UNRELIABLE' && <ShieldX className="mr-1 h-3 w-3" aria-hidden="true" />}
                    {source.verification}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] font-normal ${sourceTypeStyle[source.type] ?? ''}`}>
                    {source.type.replace(/_/g, ' ')}
                  </Badge>
                  {(source.usageCount ?? 0) > 0 && (
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                      cited {source.usageCount}×
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold leading-snug">{source.title}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {source.publisher}
                  {source.publishedAt && ` · published ${new Date(source.publishedAt).toLocaleDateString()}`}
                  {' '}· retrieved {new Date(source.retrievedAt).toLocaleDateString()}
                  {source.verifiedAt && ` · verified ${new Date(source.verifiedAt).toLocaleDateString()}`}
                </p>
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex min-h-[24px] items-center gap-1 break-all text-xs font-medium text-emerald-700 hover:text-emerald-800"
                >
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="break-all">{source.url}</span>
                </a>

                {/* Verification workflow (server-driven affordances — §20) */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {source.allowedTransitions?.includes('verify') && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 border-emerald-200 text-xs text-emerald-700 hover:bg-emerald-50"
                      onClick={() => void runVerification(source, 'verify')}
                      disabled={busyAction !== null}
                    >
                      {busyAction === `${source.id}:verify` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Verify
                    </Button>
                  )}
                  {source.allowedTransitions?.includes('recheck') && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 text-xs"
                      onClick={() => void runVerification(source, 'recheck')}
                      disabled={busyAction !== null}
                    >
                      {busyAction === `${source.id}:recheck` ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                      Recheck
                    </Button>
                  )}
                  {source.allowedTransitions?.includes('reject') && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1.5 border-red-200 text-xs text-red-600 hover:bg-red-50"
                      onClick={() => setRejectTarget(source)}
                      disabled={busyAction !== null}
                    >
                      <ShieldX className="h-3.5 w-3.5" aria-hidden="true" />
                      Reject
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => setExpandedId(expandedId === source.id ? null : source.id)}
                    aria-expanded={expandedId === source.id}
                    className="ml-auto flex min-h-[32px] items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-800"
                  >
                    {expandedId === source.id ? (
                      <ChevronDown className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="h-4 w-4" aria-hidden="true" />
                    )}
                    Where cited
                  </button>
                </div>
              </div>

              {/* Usage detail */}
              {expandedId === source.id && (
                <div className="border-t border-zinc-100 p-3">
                  {!detail ? (
                    <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      Loading citations…
                    </p>
                  ) : detail.usage.length === 0 ? (
                    <p className="text-xs text-zinc-500">
                      Not cited yet — attach it to a content item in the Link manager.
                    </p>
                  ) : (
                    <ul className="space-y-1.5" role="list">
                      {detail.usage.map((usage) => (
                        <li
                          key={usage.itemId}
                          className="flex flex-wrap items-center gap-1.5 rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-1.5 text-xs"
                        >
                          <Badge variant="outline" className="text-[9px] font-normal text-zinc-500">
                            {usage.itemStatus}
                          </Badge>
                          <span className="min-w-0 flex-1 truncate font-medium">{usage.itemTitle}</span>
                          <span className="font-mono text-[10px] text-zinc-400">
                            {usage.languageCode}/{usage.format.replace(/_/g, ' ').toLowerCase()}
                          </span>
                          {usage.claim && (
                            <span className="w-full truncate italic text-zinc-500">claim: {usage.claim}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {detail?.notes && (
                    <p className="mt-2 text-[10px] italic text-zinc-400">Notes: {detail.notes}</p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Pagination */}
      {result && result.pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page <= 1 || loading}
          >
            Previous
          </Button>
          <span>
            Page {result.pagination.page} of {totalPages} · {result.pagination.total} records
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      )}

      {/* Reject confirm (§24 — trust revoked, links preserved) */}
      <AlertDialog open={rejectTarget !== null} onOpenChange={(open) => !open && setRejectTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this source UNRELIABLE?</AlertDialogTitle>
            <AlertDialogDescription>
              {rejectTarget?.title} — trust is revoked, but the record and its existing citations are
              preserved as provenance history (§36). It cannot be attached to new content while
              unreliable. You can recheck it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (rejectTarget) void runVerification(rejectTarget, 'reject')
                setRejectTarget(null)
              }}
            >
              Reject source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
