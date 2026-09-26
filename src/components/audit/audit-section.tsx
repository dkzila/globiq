'use client'

/**
 * GlobIQ — Audit Section (P1-S5)
 *
 * Admin-only view of the accountability trail (Master Plan §6 AuditLog, §19,
 * §30, §38): who did what, to which object, when — with before/after state
 * for every privileged mutation and every denied attempt.
 *
 * Rendered only when the caller holds `audit:read` (server-affordance via
 * /api/auth/me — the server re-checks on every request; this never gates
 * data by itself, §20).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  Ban,
  ChevronDown,
  ChevronRight,
  Clock3,
  FileClock,
  Loader2,
  RefreshCw,
  ScrollText,
  Search,
  ShieldCheck,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

// ---------- API contract (mirrors /api/audit) ----------

interface AuditItem {
  id: string
  action: string
  actor: { id: string | null; email: string | null; role: string | null }
  objectType: string
  objectId: string | null
  objectLabel: string | null
  before: unknown
  after: unknown
  metadata: unknown
  ip: string | null
  createdAt: string
}

interface AuditResult {
  items: AuditItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; last24h: number; topActions: Array<{ action: string; count: number }> }
  facets: { actions: string[]; objectTypes: string[] }
}

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

// ---------- Presentation helpers ----------

type ActionKind = 'denied' | 'auth' | 'taxonomy' | 'config' | 'other'

function actionKind(action: string): ActionKind {
  if (action.includes('denied') || action.includes('failed')) return 'denied'
  if (action.startsWith('auth.') || action.startsWith('user.')) return 'auth'
  if (action.startsWith('taxonomy.')) return 'taxonomy'
  if (action.startsWith('country.') || action.startsWith('language.')) return 'config'
  return 'other'
}

const actionBadgeClass: Record<ActionKind, string> = {
  denied: 'border-red-200 bg-red-50 text-red-700',
  auth: 'border-zinc-200 bg-zinc-50 text-zinc-700',
  taxonomy: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  config: 'border-amber-200 bg-amber-50 text-amber-700',
  other: 'border-zinc-200 bg-white text-zinc-600',
}

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return '—'
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ---------- Component ----------

export function AuditSection() {
  const { toast } = useToast()
  const user = useAuth((state) => state.user)
  const token = useAuth((state) => state.token)
  const permissions = useAuth((state) => state.permissions)
  const canRead = user !== null && permissions.includes('audit:read')

  const [result, setResult] = useState<AuditResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [action, setAction] = useState<string>('all')
  const [objectType, setObjectType] = useState<string>('all')
  const [actorInput, setActorInput] = useState('')
  const [actorFilter, setActorFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const requestId = useRef(0)

  // Reset filters when the signed-in user changes (e.g. switching accounts) —
  // the React "adjust state during render" pattern; no effect needed.
  const userId = user?.id ?? null
  const prevUserId = useRef(userId)
  if (prevUserId.current !== userId) {
    prevUserId.current = userId
    setPage(1)
    setAction('all')
    setObjectType('all')
    setActorInput('')
    setActorFilter('')
    setExpanded(null)
    setResult(null)
  }

  const fetchAudit = useCallback(async () => {
    if (!token) return
    const id = ++requestId.current
    setLoading(true)
    const params = new URLSearchParams({ page: String(page), pageSize: '10' })
    if (action !== 'all') params.set('action', action)
    if (objectType !== 'all') params.set('objectType', objectType)
    if (actorFilter.trim()) params.set('actor', actorFilter.trim())
    try {
      const response = await fetch(`/api/audit?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AuditResult>
      if (id !== requestId.current) return // stale response
      if (payload.status === 'ok' && payload.data) {
        setResult(payload.data)
      } else {
        toast({
          title: 'Could not load the audit trail',
          description: payload.error?.message ?? 'Please try again.',
          variant: 'destructive',
        })
      }
    } catch {
      if (id === requestId.current) {
        toast({ title: 'Network error', description: 'Could not reach /api/audit.', variant: 'destructive' })
      }
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [token, page, action, objectType, actorFilter, toast])

  useEffect(() => {
    if (canRead) void fetchAudit()
  }, [canRead, fetchAudit, reloadKey])

  const actions = useMemo(() => result?.facets.actions ?? [], [result])
  const objectTypes = useMemo(() => result?.facets.objectTypes ?? [], [result])

  if (!canRead) return null

  const pagination = result?.pagination
  const summary = result?.summary

  return (
    <motion.section
      aria-labelledby="audit-heading"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.05 }}
      className="mt-10 space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ScrollText className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="audit-heading" className="text-xl font-semibold tracking-tight">
            Audit trail
          </h2>
          <Badge variant="outline" className="border-red-200 bg-red-50 font-normal text-red-700">
            ADMIN ONLY
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 gap-2"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
          aria-label="Refresh audit trail"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Every privileged operation is recorded with before/after state — and so is every{' '}
        <strong className="font-semibold text-zinc-800">denied</strong> attempt (Master Plan §19,
        §30). Actor identity survives account deletion; secrets are redacted at write time.
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Accountability log
          </CardTitle>
          <CardDescription>
            Append-only, deterministic ordering (§37). Filters apply server-side.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Summary chips */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <FileClock className="h-3.5 w-3.5" aria-hidden="true" />
                Events (current filter)
              </p>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {loading && !result ? <Skeleton className="h-8 w-16" /> : (summary?.total ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                Last 24 hours
              </p>
              <div className="mt-1 text-2xl font-semibold tabular-nums">
                {loading && !result ? <Skeleton className="h-8 w-16" /> : (summary?.last24h ?? 0).toLocaleString()}
              </div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
                <Ban className="h-3.5 w-3.5" aria-hidden="true" />
                Top action
              </p>
              <div className="mt-1 truncate font-mono text-sm font-semibold" title={summary?.topActions[0]?.action ?? '—'}>
                {loading && !result ? (
                  <Skeleton className="h-6 w-32" />
                ) : (
                  <>
                    {summary?.topActions[0]?.action ?? '—'}
                    {summary?.topActions[0] && (
                      <span className="ml-1.5 font-sans font-normal text-zinc-400">
                        ×{summary.topActions[0].count}
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <UILabel htmlFor="audit-action" className="text-xs text-zinc-500">
                Action
              </UILabel>
              <Select
                value={action}
                onValueChange={(value) => {
                  setAction(value)
                  setPage(1)
                }}
              >
                <SelectTrigger id="audit-action" className="h-9 w-full bg-white" aria-label="Filter by action">
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  {actions.map((item) => (
                    <SelectItem key={item} value={item} className="font-mono text-xs">
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="audit-object-type" className="text-xs text-zinc-500">
                Object type
              </UILabel>
              <Select
                value={objectType}
                onValueChange={(value) => {
                  setObjectType(value)
                  setPage(1)
                }}
              >
                <SelectTrigger
                  id="audit-object-type"
                  className="h-9 w-full bg-white"
                  aria-label="Filter by object type"
                >
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {objectTypes.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="audit-actor" className="text-xs text-zinc-500">
                Actor (email contains)
              </UILabel>
              <form
                className="relative"
                onSubmit={(event) => {
                  event.preventDefault()
                  setActorFilter(actorInput)
                  setPage(1)
                }}
              >
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400"
                  aria-hidden="true"
                />
                <Input
                  id="audit-actor"
                  value={actorInput}
                  onChange={(event) => setActorInput(event.target.value)}
                  placeholder="admin@globiq.dev"
                  className="h-9 pl-8"
                  autoComplete="off"
                />
              </form>
            </div>
          </div>

          {/* Table */}
          <div className="overflow-hidden rounded-lg border border-zinc-200">
            <div className="globiq-scroll max-h-[28rem] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-zinc-50">
                  <TableRow className="hover:bg-zinc-50">
                    <TableHead className="w-8" aria-label="Expand" />
                    <TableHead className="text-xs">When</TableHead>
                    <TableHead className="text-xs">Action</TableHead>
                    <TableHead className="text-xs">Actor</TableHead>
                    <TableHead className="hidden text-xs md:table-cell">Object</TableHead>
                    <TableHead className="hidden text-xs lg:table-cell">IP</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading && !result ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <TableRow key={`skeleton-${index}`}>
                        <TableCell colSpan={6}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : result && result.items.length > 0 ? (
                    result.items.map((item) => {
                      const isOpen = expanded === item.id
                      return (
                        <Fragment key={item.id}>
                          <TableRow
                            className="cursor-pointer bg-white hover:bg-zinc-50"
                            onClick={() => setExpanded(isOpen ? null : item.id)}
                            aria-expanded={isOpen}
                          >
                            <TableCell className="py-2.5">
                              {isOpen ? (
                                <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                              )}
                            </TableCell>
                            <TableCell className="whitespace-nowrap py-2.5 text-xs text-zinc-500">
                              {formatTime(item.createdAt)}
                            </TableCell>
                            <TableCell className="py-2.5">
                              <Badge
                                variant="outline"
                                className={`font-mono text-[10px] font-normal ${actionBadgeClass[actionKind(item.action)]}`}
                              >
                                {item.action}
                              </Badge>
                            </TableCell>
                            <TableCell className="max-w-[10rem] truncate py-2.5 text-xs">
                              <span className="font-medium">{item.actor.email ?? 'anonymous'}</span>
                              {item.actor.role && (
                                <span className="ml-1 text-zinc-400">({item.actor.role})</span>
                              )}
                            </TableCell>
                            <TableCell className="hidden max-w-[10rem] truncate py-2.5 text-xs text-zinc-600 md:table-cell">
                              {item.objectType}
                              {item.objectLabel ? ` · ${item.objectLabel}` : ''}
                            </TableCell>
                            <TableCell className="hidden py-2.5 font-mono text-[10px] text-zinc-400 lg:table-cell">
                              {item.ip ?? '—'}
                            </TableCell>
                          </TableRow>
                          {isOpen && (
                            <TableRow className="bg-zinc-50/60 hover:bg-zinc-50/60">
                              <TableCell colSpan={6} className="p-4">
                                <div className="grid gap-3 lg:grid-cols-2">
                                  <div>
                                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                      Before
                                    </p>
                                    <pre className="globiq-scroll max-h-56 overflow-auto rounded-md border border-zinc-200 bg-red-50/50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700">
                                      {formatJson(item.before)}
                                    </pre>
                                  </div>
                                  <div>
                                    <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                      After
                                      <ArrowRight className="h-3 w-3 text-emerald-600" aria-hidden="true" />
                                    </p>
                                    <pre className="globiq-scroll max-h-56 overflow-auto rounded-md border border-zinc-200 bg-emerald-50/50 p-3 font-mono text-[11px] leading-relaxed text-zinc-700">
                                      {formatJson(item.after)}
                                    </pre>
                                  </div>
                                </div>
                                <div className="mt-3">
                                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                                    Metadata
                                  </p>
                                  <pre className="globiq-scroll max-h-40 overflow-auto rounded-md border border-zinc-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-zinc-600">
                                    {formatJson(item.metadata)}
                                  </pre>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-zinc-400">
                        No audit events match the current filter.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Pagination */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-500" aria-live="polite">
              {pagination
                ? `Page ${pagination.page} of ${pagination.totalPages} · ${pagination.total.toLocaleString()} event${pagination.total === 1 ? '' : 's'}`
                : '—'}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!pagination || pagination.page <= 1 || loading}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                aria-label="Previous page"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={!pagination || pagination.page >= pagination.totalPages || loading}
                onClick={() => setPage((current) => current + 1)}
                aria-label="Next page"
              >
                Next
              </Button>
            </div>
          </div>

          {loading && result ? (
            <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Loading…
            </p>
          ) : null}
        </CardContent>
      </Card>
    </motion.section>
  )
}
