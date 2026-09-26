'use client'

/**
 * GlobIQ — Knowledge Admin Console (P2-S1)
 *
 * Privileged surface for KnowledgeUnit CRUD + lifecycle (Master Plan §6/§7/§11
 * dedup, §36 lifecycle + no silent edits, §38 scoped roles): status-filtered
 * list, unit editor (editability per status), one-click lifecycle transitions
 * (flag_outdated opens a reason dialog — §25/§36 correction provenance), and a
 * create form. COUNTRY_ADMIN manages own-country units; global units are
 * read-only for them — every affordance comes from the server (§20).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Archive,
  BadgeCheck,
  Clock8,
  FileEdit,
  Globe2,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  Undo2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

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

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface AdminUnit {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  canonicalBody: string
  type: string
  status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
  difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { id: string; slug: string; canonicalName: string; status: string }
  validity: { from: string | null; until: string | null; currentlyValid: boolean }
  notes: string | null
  orderIndex: number
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'metadata' | 'none'
  allowedTransitions: string[]
}

interface AdminListResult {
  units: AdminUnit[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

const STATUS_OPTIONS = ['', 'DRAFT', 'IN_REVIEW', 'VERIFIED', 'OUTDATED', 'ARCHIVED'] as const
const TYPE_OPTIONS = ['FACT', 'CONCEPT', 'TIMELINE', 'PERSON_PROFILE', 'PLACE_PROFILE', 'ORGANISATION_PROFILE', 'COMPARISON'] as const
const DIFFICULTY_OPTIONS = ['BASIC', 'INTERMEDIATE', 'ADVANCED'] as const

const statusStyle: Record<string, string> = {
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  VERIFIED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  OUTDATED: 'border-orange-200 bg-orange-50 text-orange-700',
  ARCHIVED: 'border-zinc-200 bg-zinc-100 text-zinc-400',
}

const TRANSITION_META: Record<string, { label: string; icon: typeof Send; className: string }> = {
  submit_review: { label: 'Submit for review', icon: Send, className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' },
  send_back: { label: 'Send back to draft', icon: Undo2, className: 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50' },
  verify: { label: 'Verify & publish', icon: BadgeCheck, className: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  flag_outdated: { label: 'Flag outdated…', icon: ShieldAlert, className: 'border-orange-300 bg-orange-50 text-orange-700 hover:bg-orange-100' },
  reverify: { label: 'Re-verify', icon: BadgeCheck, className: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  archive: { label: 'Archive', icon: Archive, className: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' },
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

export function KnowledgeAdmin() {
  const { toast } = useToast()
  const token = useAuth((state) => state.token)
  const role = useAuth((state) => state.user?.role ?? 'READER')

  const [result, setResult] = useState<AdminListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AdminUnit | null>(null)
  const [busy, setBusy] = useState(false)

  // Editor state
  const [name, setName] = useState('')
  const [summary, setSummary] = useState('')
  const [body, setBody] = useState('')
  const [difficulty, setDifficulty] = useState<'BASIC' | 'INTERMEDIATE' | 'ADVANCED'>('BASIC')
  const [notes, setNotes] = useState('')
  const [orderIndex, setOrderIndex] = useState('0')

  // Lifecycle dialogs
  const [flagOpen, setFlagOpen] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const [archiveOpen, setArchiveOpen] = useState(false)

  // Create form
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [createSummary, setCreateSummary] = useState('')
  const [createBody, setCreateBody] = useState('')
  const [createType, setCreateType] = useState<(typeof TYPE_OPTIONS)[number]>('FACT')
  const [createDifficulty, setCreateDifficulty] = useState<'BASIC' | 'INTERMEDIATE' | 'ADVANCED'>('BASIC')
  const [createScope, setCreateScope] = useState<'GLOBAL' | 'COUNTRY'>('COUNTRY')
  const [createCountry, setCreateCountry] = useState('IN')
  const [createValidFrom, setCreateValidFrom] = useState('')
  const [createTopic, setCreateTopic] = useState('')
  const [topicOptions, setTopicOptions] = useState<Array<{ slug: string; label: string }>>([])

  const authHeaders = useCallback(
    (json = false): HeadersInit => ({
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token]
  )

  const fetchList = useCallback(async () => {
    if (!token) return
    setLoading(true)
    const params = new URLSearchParams({ pageSize: '50' })
    if (statusFilter) params.set('status', statusFilter)
    if (search.trim()) params.set('q', search.trim())
    try {
      const response = await fetch(`/api/knowledge/admin/units?${params.toString()}`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminListResult>
      if (payload.status === 'ok' && payload.data) setResult(payload.data)
      else toast({ title: 'Could not load units', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, statusFilter, search, authHeaders, toast])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // Topic options for the create form (admin taxonomy tree, §13).
  useEffect(() => {
    if (!token || !createOpen || topicOptions.length > 0) return
    fetch('/api/taxonomy/admin/tree', { headers: authHeaders(), cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ tree: Array<{ slug: string; canonicalName: string; children: unknown[] }> }>) => {
        if (payload.status === 'ok' && payload.data) {
          const flat: Array<{ slug: string; label: string }> = []
          const walk = (nodes: Array<{ slug: string; canonicalName: string; children: unknown[] }>): void => {
            for (const node of nodes) {
              flat.push({ slug: node.slug, label: node.canonicalName })
              walk(node.children as typeof nodes)
            }
          }
          walk(payload.data.tree)
          setTopicOptions(flat)
        }
      })
      .catch(() => setTopicOptions([]))
  }, [token, createOpen, topicOptions.length, authHeaders])

  const selectUnit = useCallback((unit: AdminUnit) => {
    setSelected(unit)
    setName(unit.canonicalName)
    setSummary(unit.canonicalSummary ?? '')
    setBody(unit.canonicalBody)
    setDifficulty(unit.difficulty)
    setNotes(unit.notes ?? '')
    setOrderIndex(String(unit.orderIndex))
    setFlagReason('')
  }, [])

  const patchUnit = useCallback(
    async (id: string, patch: Record<string, unknown>, successMessage: string) => {
      setBusy(true)
      try {
        const response = await fetch(`/api/knowledge/admin/units/${id}`, {
          method: 'PATCH',
          headers: authHeaders(true),
          body: JSON.stringify(patch),
        })
        const payload = (await response.json()) as Envelope<{ unit: AdminUnit }>
        if (payload.status === 'ok' && payload.data) {
          setSelected(payload.data.unit)
          toast({ title: successMessage })
          void fetchList()
          return true
        }
        toast({ title: 'Update rejected', description: payload.error?.message, variant: 'destructive' })
        return false
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
        return false
      } finally {
        setBusy(false)
      }
    },
    [authHeaders, fetchList, toast]
  )

  const runTransition = useCallback(
    async (id: string, action: string, reason?: string) => {
      setBusy(true)
      try {
        const response = await fetch(`/api/knowledge/admin/units/${id}/transition`, {
          method: 'POST',
          headers: authHeaders(true),
          body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
        })
        const payload = (await response.json()) as Envelope<{ unit: AdminUnit }>
        if (payload.status === 'ok' && payload.data) {
          setSelected(payload.data.unit)
          toast({ title: `Unit is now ${payload.data.unit.status}` })
          void fetchList()
          return true
        }
        toast({ title: 'Transition rejected', description: payload.error?.message, variant: 'destructive' })
        return false
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
        return false
      } finally {
        setBusy(false)
      }
    },
    [authHeaders, fetchList, toast]
  )

  const createUnit = useCallback(async () => {
    setBusy(true)
    try {
      const response = await fetch('/api/knowledge/admin/units', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({
          canonicalName: createName,
          slug: createSlug || slugify(createName),
          canonicalSummary: createSummary || undefined,
          canonicalBody: createBody,
          type: createType,
          difficulty: createDifficulty,
          scope: role === 'COUNTRY_ADMIN' ? 'COUNTRY' : createScope,
          ...(role === 'ADMIN' && createScope === 'COUNTRY' ? { country: createCountry } : {}),
          topic: createTopic,
          ...(createValidFrom ? { validFrom: new Date(createValidFrom).toISOString() } : {}),
        }),
      })
      const payload = (await response.json()) as Envelope<{ unit: AdminUnit }>
      if (payload.status === 'ok' && payload.data) {
        toast({ title: 'Unit created as DRAFT', description: 'Submit it for review when ready.' })
        setCreateOpen(false)
        setCreateName(''); setCreateSlug(''); setCreateSummary(''); setCreateBody(''); setCreateValidFrom('')
        void fetchList()
        selectUnit(payload.data.unit)
        return true
      }
      toast({ title: 'Create rejected', description: payload.error?.message, variant: 'destructive' })
      return false
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
      return false
    } finally {
      setBusy(false)
    }
  }, [authHeaders, createBody, createCountry, createDifficulty, createName, createScope, createSlug, createSummary, createTopic, createType, createValidFrom, fetchList, role, selectUnit, toast])

  const selectedEditable = selected !== null && selected.canEdit
  const contentEditable = selected !== null && selected.editability === 'full'
  const metadataEditable = selected !== null && (selected.editability === 'full' || selected.editability === 'metadata')

  return (
    <div className="space-y-4">
      {/* Scoped banner */}
      {role === 'COUNTRY_ADMIN' && (
        <p className="flex items-center gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800">
          <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Country admin — manage own-country units; global units are read-only.
        </p>
      )}
      {role === 'ADMIN' && (
        <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <Globe2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Platform admin — full control: global + all countries, incl. verify/archive.
        </p>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-36 space-y-1.5">
          <UILabel htmlFor="ku-admin-status" className="text-xs text-zinc-500">Status</UILabel>
          <Select value={statusFilter || 'all'} onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}>
            <SelectTrigger id="ku-admin-status" className="h-9 bg-white" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.filter(Boolean).map((option) => (
                <SelectItem key={option} value={option}>{option.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="min-w-40 flex-1 space-y-1.5">
          <UILabel htmlFor="ku-admin-search" className="text-xs text-zinc-500">Search</UILabel>
          <Input
            id="ku-admin-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && void fetchList()}
            placeholder="Name or slug…"
            className="h-9 bg-white"
          />
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => void fetchList()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
        <Button size="sm" className="h-9 gap-2" onClick={() => setCreateOpen((open) => !open)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          New unit
        </Button>
      </div>

      {/* Create form */}
      {createOpen && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Plus className="h-4 w-4 text-emerald-700" aria-hidden="true" />
            Create a knowledge unit (§7 canonical record — enters DRAFT)
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <UILabel htmlFor="ku-create-name" className="text-xs">Canonical name *</UILabel>
              <Input id="ku-create-name" value={createName} onChange={(e) => { setCreateName(e.target.value); if (!createSlug) setCreateSlug(slugify(e.target.value)) }} placeholder="e.g. Kesavananda Bharati Case — 1973" className="bg-white" />
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="ku-create-slug" className="text-xs">Slug (URL, immutable)</UILabel>
              <Input id="ku-create-slug" value={createSlug} onChange={(e) => setCreateSlug(slugify(e.target.value))} placeholder="auto-generated" className="bg-white font-mono text-xs" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <UILabel htmlFor="ku-create-summary" className="text-xs">One-line summary (the quick fact, §22)</UILabel>
              <Input id="ku-create-summary" value={createSummary} onChange={(e) => setCreateSummary(e.target.value)} placeholder="One sentence a learner retains." className="bg-white" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <UILabel htmlFor="ku-create-body" className="text-xs">Canonical body * (English-reference; other languages are P2-S2 representations)</UILabel>
              <Textarea id="ku-create-body" value={createBody} onChange={(e) => setCreateBody(e.target.value)} placeholder="The full canonical knowledge — facts, anchors, exam-relevant detail. Min 20 characters." className="min-h-24 bg-white" />
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="ku-create-type" className="text-xs">Type (§23) *</UILabel>
              <Select value={createType} onValueChange={(v) => setCreateType(v as typeof createType)}>
                <SelectTrigger id="ku-create-type" className="bg-white" aria-label="Type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>{option.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="ku-create-difficulty" className="text-xs">Difficulty</UILabel>
              <Select value={createDifficulty} onValueChange={(v) => setCreateDifficulty(v as typeof createDifficulty)}>
                <SelectTrigger id="ku-create-difficulty" className="bg-white" aria-label="Difficulty"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIFFICULTY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="ku-create-topic" className="text-xs">Canonical topic *</UILabel>
              <Select value={createTopic} onValueChange={setCreateTopic}>
                <SelectTrigger id="ku-create-topic" className="bg-white" aria-label="Topic">
                  <SelectValue placeholder={topicOptions.length ? 'Choose…' : 'Loading…'} />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {topicOptions.map((option) => (
                    <SelectItem key={option.slug} value={option.slug}>{option.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="ku-create-validfrom" className="text-xs">Valid from (optional)</UILabel>
              <Input id="ku-create-validfrom" type="date" value={createValidFrom} onChange={(e) => setCreateValidFrom(e.target.value)} className="bg-white" />
            </div>
            {role === 'ADMIN' && (
              <>
                <div className="space-y-1.5">
                  <UILabel htmlFor="ku-create-scope" className="text-xs">Country scope (§14)</UILabel>
                  <Select value={createScope} onValueChange={(v) => setCreateScope(v as 'GLOBAL' | 'COUNTRY')}>
                    <SelectTrigger id="ku-create-scope" className="bg-white" aria-label="Scope"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GLOBAL">GLOBAL — all markets</SelectItem>
                      <SelectItem value="COUNTRY">COUNTRY — one market</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {createScope === 'COUNTRY' && (
                  <div className="space-y-1.5">
                    <UILabel htmlFor="ku-create-country" className="text-xs">Country</UILabel>
                    <Select value={createCountry} onValueChange={setCreateCountry}>
                      <SelectTrigger id="ku-create-country" className="bg-white" aria-label="Country"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {['IN', 'GB', 'FR'].map((iso) => (
                          <SelectItem key={iso} value={iso}>{iso}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => void createUnit()} disabled={busy || !createName || !createBody || !createTopic}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
              Create DRAFT unit
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)}>Cancel</Button>
            {role === 'COUNTRY_ADMIN' && (
              <span className="text-xs text-teal-700">Scope: COUNTRY (your home country, implied)</span>
            )}
          </div>
        </div>
      )}

      {/* List + editor */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* List */}
        <div className="lg:col-span-2">
          <p className="mb-2 text-xs font-medium text-zinc-500" aria-live="polite">
            {result ? `${result.pagination.total} unit${result.pagination.total === 1 ? '' : 's'}` : '…'}
          </p>
          <div className="globiq-scroll max-h-[26rem] space-y-2 overflow-y-auto pr-1">
            {loading && !result ? (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            ) : result && result.units.length > 0 ? (
              result.units.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => selectUnit(unit)}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    selected?.id === unit.id
                      ? 'border-emerald-400 bg-emerald-50/50'
                      : 'border-zinc-200 bg-white hover:border-emerald-300'
                  }`}
                  aria-pressed={selected?.id === unit.id}
                >
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] font-normal ${statusStyle[unit.status]}`}>
                      {unit.status.replace('_', ' ')}
                    </Badge>
                    <span className="text-[10px] text-zinc-400">{unit.type.replace('_', ' ')}</span>
                    {unit.scope === 'GLOBAL' ? (
                      <Globe2 className="ml-auto h-3 w-3 text-zinc-400" aria-label="Global" />
                    ) : (
                      <span className="ml-auto font-mono text-[10px] text-teal-700">{unit.countryIso}</span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-sm font-medium leading-snug">{unit.canonicalName}</p>
                  <p className="truncate text-[10px] text-zinc-400">{unit.topic.canonicalName}</p>
                </button>
              ))
            ) : (
              <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
                No units match this filter.
              </p>
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="lg:col-span-3">
          {!selected ? (
            <p className="flex h-full min-h-40 items-center justify-center rounded-lg border border-dashed border-zinc-300 text-sm text-zinc-400">
              Select a unit to edit or transition it.
            </p>
          ) : (
            <div className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
              {/* Header */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`font-normal ${statusStyle[selected.status]}`}>
                  {selected.status.replace('_', ' ')}
                </Badge>
                <Badge variant="secondary" className="font-mono text-[10px] font-normal">{selected.type.replace('_', ' ')}</Badge>
                {selected.scope === 'COUNTRY' ? (
                  <Badge variant="outline" className="border-teal-200 bg-teal-50 font-normal text-teal-700">
                    <MapPin className="mr-1 h-3 w-3" aria-hidden="true" />
                    {selected.countryIso}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-normal text-zinc-500">
                    <Globe2 className="mr-1 h-3 w-3" aria-hidden="true" />
                    GLOBAL
                  </Badge>
                )}
                <span className="ml-auto font-mono text-[10px] text-zinc-400">{selected.slug}</span>
              </div>

              {/* Lifecycle note */}
              {selected.editability === 'metadata' && (
                <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800" role="status">
                  <Clock8 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  VERIFIED — body locked (§36 no silent edits). Flag as outdated to open the correction
                  cycle, edit, then re-verify. Metadata stays editable.
                </p>
              )}
              {selected.editability === 'none' && (
                <p className="flex items-start gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500" role="status">
                  <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ARCHIVED — read-only end-of-life record.
                </p>
              )}
              {!selected.canEdit && selected.editability !== 'none' && (
                <p className="flex items-start gap-2 rounded-md border border-teal-200 bg-teal-50 px-3 py-2 text-xs text-teal-800" role="status">
                  <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  Read-only for your role — global units are platform-admin managed (§20).
                </p>
              )}

              {/* Fields */}
              <div className="grid grid-cols-1 gap-3">
                <div className="space-y-1.5">
                  <UILabel htmlFor="ku-edit-name" className="text-xs">Canonical name</UILabel>
                  <Input
                    id="ku-edit-name" value={name} onChange={(e) => setName(e.target.value)}
                    disabled={!selectedEditable || !contentEditable} className="bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <UILabel htmlFor="ku-edit-summary" className="text-xs">Summary (quick fact)</UILabel>
                  <Input
                    id="ku-edit-summary" value={summary} onChange={(e) => setSummary(e.target.value)}
                    disabled={!selectedEditable || !contentEditable} className="bg-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <UILabel htmlFor="ku-edit-body" className="text-xs">Canonical body</UILabel>
                  <Textarea
                    id="ku-edit-body" value={body} onChange={(e) => setBody(e.target.value)}
                    disabled={!selectedEditable || !contentEditable}
                    className="globiq-scroll min-h-32 bg-white text-xs leading-relaxed"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <UILabel htmlFor="ku-edit-difficulty" className="text-xs">Difficulty</UILabel>
                    <Select
                      value={difficulty}
                      onValueChange={(v) => setDifficulty(v as typeof difficulty)}
                      disabled={!selectedEditable || !metadataEditable}
                    >
                      <SelectTrigger id="ku-edit-difficulty" className="bg-white" aria-label="Difficulty">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DIFFICULTY_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>{option}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <UILabel htmlFor="ku-edit-order" className="text-xs">Order index</UILabel>
                    <Input
                      id="ku-edit-order" value={orderIndex}
                      onChange={(e) => setOrderIndex(e.target.value)}
                      disabled={!selectedEditable || !metadataEditable} className="bg-white"
                      inputMode="numeric"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <UILabel className="text-xs text-zinc-400">Topic / scope (immutable)</UILabel>
                    <p className="truncate rounded-md border border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                      {selected.topic.canonicalName}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <UILabel htmlFor="ku-edit-notes" className="text-xs">Internal notes</UILabel>
                  <Textarea
                    id="ku-edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                    disabled={!selectedEditable || !metadataEditable}
                    className="min-h-14 bg-white text-xs"
                  />
                </div>
              </div>

              {/* Validity */}
              <p className="text-xs text-zinc-500">
                Validity:{' '}
                {selected.validity.from ? `from ${new Date(selected.validity.from).toLocaleDateString()}` : 'evergreen'}
                {selected.validity.until ? ` until ${new Date(selected.validity.until).toLocaleDateString()}` : ''}
                {' · '}
                <span className={selected.validity.currentlyValid ? 'text-emerald-700' : 'text-red-600'}>
                  {selected.validity.currentlyValid ? 'currently valid' : 'outside window'}
                </span>
              </p>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
                <Button
                  size="sm" className="gap-2"
                  disabled={!selectedEditable || busy || (!contentEditable && false)}
                  onClick={async () => {
                    const patch: Record<string, unknown> = {}
                    if (contentEditable) {
                      if (name !== selected.canonicalName) patch.canonicalName = name
                      if (summary !== (selected.canonicalSummary ?? '')) patch.canonicalSummary = summary || null
                      if (body !== selected.canonicalBody) patch.canonicalBody = body
                    }
                    if (metadataEditable) {
                      if (difficulty !== selected.difficulty) patch.difficulty = difficulty
                      if (notes !== (selected.notes ?? '')) patch.notes = notes || null
                      const order = Number.parseInt(orderIndex, 10)
                      if (!Number.isNaN(order) && order !== selected.orderIndex) patch.orderIndex = order
                    }
                    if (Object.keys(patch).length === 0) {
                      toast({ title: 'Nothing to save' })
                      return
                    }
                    await patchUnit(selected.id, patch, 'Saved — audit trail updated')
                  }}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                  Save changes
                </Button>

                <span className="ml-1 h-6 w-px bg-zinc-200" aria-hidden="true" />

                {selected.allowedTransitions.map((action) => {
                  const meta = TRANSITION_META[action]
                  if (!meta) return null
                  const Icon = meta.icon
                  const disabled = busy || (!selected.canEdit)
                  return (
                    <Button
                      key={action}
                      variant="outline" size="sm"
                      className={`gap-2 ${meta.className}`}
                      disabled={disabled}
                      onClick={() => {
                        if (action === 'flag_outdated') { setFlagOpen(true); return }
                        if (action === 'archive') { setArchiveOpen(true); return }
                        void runTransition(selected.id, action)
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      {meta.label}
                    </Button>
                  )
                })}
              </div>
              <p className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <FileEdit className="h-3 w-3" aria-hidden="true" />
                Every save and transition is audited with before/after state (P1-S5 trail).
              </p>
            </div>
          )}
        </div>
      </div>

      {/* flag_outdated reason dialog (§25/§36) */}
      <AlertDialog open={flagOpen} onOpenChange={setFlagOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-orange-600" aria-hidden="true" />
              Flag as outdated
            </AlertDialogTitle>
            <AlertDialogDescription>
              This opens the correction cycle (§36): the body becomes editable, the unit stays
              verified-history-auditable, and re-verification is required to publish again. A reason
              is recorded in the audit trail.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <UILabel htmlFor="ku-flag-reason" className="text-xs">Reason (required)</UILabel>
            <Textarea
              id="ku-flag-reason" value={flagReason} onChange={(e) => setFlagReason(e.target.value)}
              placeholder="e.g. 2024 amendment changed the composition…"
              className="min-h-20"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!flagReason.trim()}
              onClick={() => {
                void runTransition(selected!.id, 'flag_outdated', flagReason.trim())
                setFlagOpen(false)
              }}
            >
              Flag outdated
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* archive confirm */}
      <AlertDialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Archive className="h-5 w-5 text-red-600" aria-hidden="true" />
              Archive this unit?
            </AlertDialogTitle>
            <AlertDialogDescription>
              “{selected?.canonicalName}” becomes a read-only end-of-life record (§36). This is
              reversible only by database intervention — prefer keeping it VERIFIED if unsure.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                void runTransition(selected!.id, 'archive')
                setArchiveOpen(false)
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {loading && (
        <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Loading…
        </p>
      )}
    </div>
  )
}
