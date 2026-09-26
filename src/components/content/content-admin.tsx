'use client'

/**
 * GlobIQ — Content Admin Console (P2-S2)
 *
 * Privileged surface for ContentItem CRUD + lifecycle + revisions (Master Plan
 * §7 one rendering per unit×language×format, §19 published content immutable
 * at the revision level, §23 per-format rules, §35 per-country languages,
 * §36 corrections publish new revisions with provenance — never silent edits,
 * §38 scoped roles). The editor separates the LIVE REVISION (what the public
 * sees) from the WORKING COPY (staging); every affordance comes from the
 * server (§20) and is re-checked on each operation.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  BadgeCheck,
  BookMarked,
  Bot,
  ChevronDown,
  ChevronRight,
  Clock8,
  Eye,
  FilePlus2,
  Globe2,
  History,
  Loader2,
  MapPin,
  Pencil,
  RefreshCw,
  Save,
  Send,
  ShieldAlert,
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

import type { PublicUnitRef } from './content-section'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

interface RevisionRef {
  id: string
  revisionNumber: number
  title: string
  body: string
  changeSummary: string | null
  aiAssisted: boolean
  publishedAt: string
  publishedBy: string | null
}

interface AdminItem {
  id: string
  status: 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'RETIRED'
  format: string
  language: { code: string; name: string; nativeName: string | null }
  title: string
  body: string
  unit: {
    id: string
    slug: string
    canonicalName: string
    status: string
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
    topicSlug: string | null
  }
  liveRevision: RevisionRef | null
  revisionCount: number
  aiAssisted: boolean
  sourceCount: number
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'none'
  allowedTransitions: string[]
  unitVerified: boolean
}

interface RevisionList {
  itemId: string
  unit: { slug: string; canonicalName: string }
  language: { code: string; name: string }
  format: string
  revisions: RevisionRef[]
}

const STATUS_OPTIONS = ['', 'DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED'] as const
const FORMAT_OPTIONS = [
  'FACT_CARD',
  'EXPLAINER',
  'REVISION_NOTE',
  'CURRENT_EVENT_UPDATE',
  'TIMELINE',
  'PROFILE',
  'COMPARISON',
] as const

/** §23 per-format hints (mirrors server rules — the server validates authoritatively). */
const FORMAT_HINTS: Record<string, string> = {
  FACT_CARD: 'One crisp paragraph (20–1,500 chars) — the quick-fact layer',
  EXPLAINER: 'Full article (300–50,000 chars) with genuine depth',
  REVISION_NOTE: 'Compact structured takeaways (60–10,000 chars)',
  CURRENT_EVENT_UPDATE: 'Source-backed update on what changed (120–20,000 chars)',
  TIMELINE: 'One event per line: “date — event” (100–30,000 chars)',
  PROFILE: 'Structured person/place/org profile (120–30,000 chars)',
  COMPARISON: 'Side-by-side comparison (120–30,000 chars)',
}

const statusStyle: Record<string, string> = {
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  RETIRED: 'border-zinc-300 bg-zinc-100 text-zinc-500',
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

interface AdminProps {
  country: string
  unit: PublicUnitRef | null
  countryLanguages: Array<{ code: string; name: string; nativeName: string | null }>
}

export function ContentAdmin({ unit, countryLanguages }: AdminProps) {
  const token = useAuth((state) => state.token)
  const user = useAuth((state) => state.user)
  const { toast } = useToast()

  const [statusFilter, setStatusFilter] = useState<string>('')
  const [items, setItems] = useState<AdminItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Query-keyed editor draft (React 19: no sync setState in effects) — the
  // key is the selected item id; a mismatch means "show the server values".
  const [editorDraft, setEditorDraft] = useState<{
    key: string
    title: string
    body: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  // Publish dialog (republish of live content requires a change summary — §36).
  const [publishDialog, setPublishDialog] = useState(false)
  const [changeSummary, setChangeSummary] = useState('')
  const [retireConfirm, setRetireConfirm] = useState(false)

  // Create form.
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ format: 'FACT_CARD', language: '', title: '', body: '', aiAssisted: false })
  const [createErrors, setCreateErrors] = useState<Record<string, string[]> | null>(null)
  const [creating, setCreating] = useState(false)

  // §24/§26 AI-provenance toggle (working copy — snapshotted at publish).
  const [aiToggleBusy, setAiToggleBusy] = useState(false)

  // Revision history (query-keyed — keyed to the selected item + a refresh tick).
  const [historyTick, setHistoryTick] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyState, setHistoryState] = useState<{ key: string; data: RevisionList } | null>(null)
  const [expandedRevision, setExpandedRevision] = useState<number | null>(null)

  // Global units may use ANY active language (§35 applies per-country only to
  // country-scoped units) — fetched from the gated /api/languages registry.
  const [globalLanguages, setGlobalLanguages] = useState<Array<{ code: string; name: string; nativeName: string | null }> | null>(null)
  useEffect(() => {
    if (!token || unit?.scope !== 'GLOBAL') return
    let cancelled = false
    async function run() {
      const response = await fetch('/api/languages', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ languages: Array<{ code: string; name: string; nativeName: string | null }> }>
      if (!cancelled) setGlobalLanguages(payload.status === 'ok' && payload.data ? payload.data.languages : [])
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, unit?.scope])

  const isCountryAdmin = user?.role === 'COUNTRY_ADMIN'
  const unitReadOnlyForRole = unit?.scope === 'GLOBAL' && isCountryAdmin

  const languageOptions = useMemo(() => {
    if (unit?.scope === 'COUNTRY') return countryLanguages
    return globalLanguages ?? []
  }, [unit?.scope, countryLanguages, globalLanguages])

  const fetchItems = useCallback(async () => {
    if (!token || !unit) {
      setItems(null)
      return
    }
    setError(null)
    const params = new URLSearchParams({ unit: unit.slug })
    if (statusFilter) params.set('status', statusFilter)
    try {
      const response = await fetch(`/api/content/admin/items?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ items: AdminItem[] }>
      if (payload.status === 'ok' && payload.data) {
        setItems(payload.data.items)
      } else {
        setError(payload.error?.message ?? 'Could not load content items')
        setItems([])
      }
    } catch {
      setError('Network error — please retry.')
      setItems([])
    }
  }, [token, unit, statusFilter])

  useEffect(() => {
    setSelectedId(null)
    setHistoryOpen(false)
    setCreateOpen(false)
    void fetchItems()
  }, [fetchItems])

  const selected = useMemo(
    () => items?.find((item) => item.id === selectedId) ?? null,
    [items, selectedId]
  )

  // The editor state follows the selected item: when the draft is absent or
  // keyed to another item, the inputs render the server's working copy.
  const editor =
    selected && editorDraft?.key === selected.id
      ? editorDraft
      : selected
        ? { key: selected.id, title: selected.title, body: selected.body }
        : null

  // §24/§26 AI-provenance toggle (working copy — snapshotted at publish).
  const toggleAiAssisted = useCallback(async () => {
    if (!token || !selected || !selected.canEdit) return
    setAiToggleBusy(true)
    try {
      const response = await fetch(`/api/content/admin/items/${selected.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiAssisted: !selected.aiAssisted }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminItem }>
      if (payload.status === 'ok' && payload.data) {
        setItems((current) =>
          current ? current.map((entry) => (entry.id === payload.data!.item.id ? payload.data!.item : entry)) : current
        )
        toast({
          title: payload.data.item.aiAssisted ? 'Marked AI-assisted' : 'AI-assist flag cleared',
          description: 'Working-copy state — frozen onto the next published revision (§26).',
        })
      } else {
        toast({ title: 'Could not update', description: apiError(payload), variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setAiToggleBusy(false)
    }
  }, [token, selected, toast])

  // Revision history loads when opened (and after each publish).
  useEffect(() => {
    if (!historyOpen || !token || !selected) return
    let cancelled = false
    async function run() {
      const response = await fetch(`/api/content/admin/items/${selected!.id}/revisions`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<RevisionList>
      if (cancelled) return
      if (payload.status === 'ok' && payload.data) {
        setHistoryState({ key: `${selected!.id}:${historyTick}`, data: payload.data })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [historyOpen, historyTick, token, selected])

  const historyData =
    historyState && selected && historyState.key === `${selected.id}:${historyTick}`
      ? historyState.data
      : null

  const apiError = (payload: Envelope<unknown>): string =>
    payload.error?.message ?? 'The operation failed'

  // ---------- Actions ----------

  const saveWorkingCopy = useCallback(async () => {
    if (!token || !selected || !editor) return
    setSaving(true)
    try {
      const response = await fetch(`/api/content/admin/items/${selected.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editor.title, body: editor.body }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminItem }>
      if (payload.status === 'ok' && payload.data) {
        setEditorDraft(null) // re-sync the editor to the server's working copy
        setItems((current) =>
          current ? current.map((entry) => (entry.id === payload.data!.item.id ? payload.data!.item : entry)) : current
        )
        toast({
          title: 'Working copy saved',
          description:
            payload.data.item.status === 'PUBLISHED'
              ? 'Staged — the public still sees the live revision until you publish a new one (§36).'
              : 'Saved.',
        })
      } else {
        toast({ title: 'Could not save', description: apiError(payload), variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }, [token, selected, editor, toast])

  const runTransition = useCallback(
    async (action: string, summary?: string) => {
      if (!token || !selected) return
      setBusyAction(action)
      try {
        const response = await fetch(`/api/content/admin/items/${selected.id}/transition`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(summary !== undefined ? { action, changeSummary: summary } : { action }),
        })
        const payload = (await response.json()) as Envelope<{ item: AdminItem }>
        if (payload.status === 'ok' && payload.data) {
          setItems((current) =>
            current ? current.map((entry) => (entry.id === payload.data!.item.id ? payload.data!.item : entry)) : current
          )
          setHistoryTick((tick) => tick + 1)
          toast({
            title:
              action === 'publish'
                ? `Published revision ${payload.data.item.liveRevision?.revisionNumber ?? ''}`
                : `Done — ${action.replace(/_/g, ' ')}`,
            description:
              action === 'publish'
                ? 'An immutable snapshot was appended; previous versions are preserved (§36).'
                : undefined,
          })
        } else {
          toast({ title: 'Transition failed', description: apiError(payload), variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
      } finally {
        setBusyAction(null)
      }
    },
    [token, selected, toast]
  )

  const submitCreate = useCallback(async () => {
    if (!token || !unit) return
    setCreating(true)
    setCreateErrors(null)
    try {
      const response = await fetch('/api/content/admin/items', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit: unit.slug, ...createForm }),
      })
      const payload = (await response.json()) as Envelope<{ item: AdminItem }>
      if (payload.status === 'ok' && payload.data) {
        setItems((current) => [payload.data!.item, ...(current ?? [])])
        setCreateOpen(false)
        setCreateForm({ format: 'FACT_CARD', language: createForm.language, title: '', body: '', aiAssisted: false })
        toast({ title: 'Representation created', description: 'Entered DRAFT — submit for review, then publish.' })
        setSelectedId(payload.data.item.id)
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
  }, [token, unit, createForm, toast])

  // ---------- Render ----------

  if (!unit) {
    return (
      <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
        Select a knowledge unit above to manage its representations.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {/* Scope banners (§38) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="border-zinc-200 bg-zinc-50 font-normal text-zinc-600">
          {unit.scope === 'GLOBAL' ? (
            <>
              <Globe2 className="mr-1 h-3 w-3" aria-hidden="true" /> global unit
            </>
          ) : (
            <>
              <MapPin className="mr-1 h-3 w-3" aria-hidden="true" /> {unit.countryIso} unit
            </>
          )}
        </Badge>
        {unitReadOnlyForRole && (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">
            <ShieldAlert className="mr-1 h-3 w-3" aria-hidden="true" />
            global units are platform-admin only (read-only for country admins)
          </Badge>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Select value={statusFilter || 'all'} onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}>
            <SelectTrigger className="h-8 w-[150px] bg-white text-xs" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUS_OPTIONS.filter(Boolean).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-2"
            onClick={() => void fetchItems()}
            disabled={items === null}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
        {!unitReadOnlyForRole && (
          <Button
            size="sm"
            className="h-8 gap-2"
            onClick={() => {
              setCreateOpen((open) => !open)
              if (!createForm.language && languageOptions.length > 0) {
                setCreateForm((form) => ({ ...form, language: languageOptions[0]!.code }))
              }
            }}
          >
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            New representation
          </Button>
        )}
      </div>

      {/* Create form (§7 identity: one unit × one language × one format) */}
      {createOpen && !unitReadOnlyForRole && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
          <p className="text-sm font-semibold">New representation of “{unit.canonicalName}”</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            One rendering per language × format (§7) — the fact itself is never re-entered.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <UILabel htmlFor="content-create-format" className="text-xs text-zinc-500">Format</UILabel>
              <Select
                value={createForm.format}
                onValueChange={(value) => setCreateForm((form) => ({ ...form, format: value }))}
              >
                <SelectTrigger id="content-create-format" className="h-9 w-full bg-white" aria-label="Format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMAT_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-zinc-400">{FORMAT_HINTS[createForm.format]}</p>
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="content-create-language" className="text-xs text-zinc-500">
                Language{unit.scope === 'COUNTRY' ? ' (configured for this market, §35)' : ' (any active language)'}
              </UILabel>
              <Select
                value={createForm.language || undefined}
                onValueChange={(value) => setCreateForm((form) => ({ ...form, language: value }))}
              >
                <SelectTrigger id="content-create-language" className="h-9 w-full bg-white" aria-label="Language">
                  <SelectValue placeholder={languageOptions.length ? 'Choose…' : 'Loading…'} />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.code} value={option.code}>
                      {option.nativeName ?? option.name} ({option.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <UILabel htmlFor="content-create-title" className="text-xs text-zinc-500">Title</UILabel>
              <Input
                id="content-create-title"
                className="bg-white"
                value={createForm.title}
                onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))}
                placeholder="Working title"
                aria-invalid={Boolean(createErrors?.title)}
              />
              {createErrors?.title && <p className="text-xs text-red-600">{createErrors.title[0]}</p>}
            </div>
            <label className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-1.5 text-xs text-zinc-600">
              <input
                type="checkbox"
                checked={createForm.aiAssisted}
                onChange={(event) => setCreateForm((form) => ({ ...form, aiAssisted: event.target.checked }))}
                className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
              />
              Drafted with AI assistance (§26 — provenance flag on every published revision)
            </label>
            <div className="space-y-1.5">
              <UILabel htmlFor="content-create-body" className="text-xs text-zinc-500">Body</UILabel>
              <Textarea
                id="content-create-body"
                className="min-h-[110px] bg-white"
                value={createForm.body}
                onChange={(event) => setCreateForm((form) => ({ ...form, body: event.target.value }))}
                placeholder={FORMAT_HINTS[createForm.format]}
                aria-invalid={Boolean(createErrors?.body)}
              />
              {createErrors?.body && <p className="text-xs text-red-600">{createErrors.body[0]}</p>}
              {createErrors?.form && <p className="text-xs text-red-600">{createErrors.form[0]}</p>}
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" className="gap-2" onClick={() => void submitCreate()} disabled={creating || !createForm.language}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FilePlus2 className="h-4 w-4" aria-hidden="true" />}
              Create draft
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* List */}
      {items === null ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : error ? (
        <p className="flex items-start gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-4 text-sm text-zinc-500" role="status">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
          No representations of this unit yet — create the first one.
        </p>
      ) : (
        <ul className="space-y-2" role="list">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id === selectedId ? null : item.id)}
                aria-expanded={item.id === selectedId}
                className={`w-full rounded-lg border p-3.5 text-left shadow-sm transition-colors ${
                  item.id === selectedId
                    ? 'border-emerald-400 bg-emerald-50/40'
                    : 'border-zinc-200 bg-white hover:border-emerald-300'
                }`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className={`text-[10px] font-normal ${statusStyle[item.status] ?? ''}`}>
                    {item.status}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] font-normal ${formatStyle[item.format] ?? ''}`}>
                    {item.format.replace(/_/g, ' ')}
                  </Badge>
                  <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                    {item.language.code}
                  </Badge>
                  {item.revisionCount > 0 && (
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                      <History className="mr-1 h-3 w-3" aria-hidden="true" />
                      {item.revisionCount} revision{item.revisionCount === 1 ? '' : 's'}
                    </Badge>
                  )}
                  {item.sourceCount > 0 && (
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700">
                      <BookMarked className="mr-1 h-3 w-3" aria-hidden="true" />
                      {item.sourceCount} source{item.sourceCount === 1 ? '' : 's'}
                    </Badge>
                  )}
                  {item.aiAssisted && (
                    <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] font-normal text-amber-700">
                      <Bot className="mr-1 h-3 w-3" aria-hidden="true" />
                      AI-assisted
                    </Badge>
                  )}
                  {!item.canEdit && (
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-400">
                      read-only
                    </Badge>
                  )}
                </div>
                <p className="mt-2 text-sm font-semibold leading-snug">{item.title}</p>
                {item.liveRevision && (
                  <p className="mt-1 text-[10px] text-zinc-400">
                    live: rev {item.liveRevision.revisionNumber} · published{' '}
                    {new Date(item.liveRevision.publishedAt).toLocaleDateString()}
                    {item.liveRevision.changeSummary ? ` · “${item.liveRevision.changeSummary}”` : ''}
                  </p>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Editor */}
      {selected && editor && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={`font-normal ${statusStyle[selected.status] ?? ''}`}>
                {selected.status}
              </Badge>
              <Badge variant="outline" className={`font-normal ${formatStyle[selected.format] ?? ''}`}>
                {selected.format.replace(/_/g, ' ')}
              </Badge>
              <Badge variant="secondary" className="font-normal">
                {selected.language.nativeName ?? selected.language.name} ({selected.language.code})
              </Badge>
              {selected.sourceCount > 0 && (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
                  <BookMarked className="mr-1 h-3 w-3" aria-hidden="true" />
                  {selected.sourceCount} source{selected.sourceCount === 1 ? '' : 's'} (§24)
                </Badge>
              )}
              {selected.aiAssisted && (
                <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">
                  <Bot className="mr-1 h-3 w-3" aria-hidden="true" />
                  AI-assisted (§26)
                </Badge>
              )}
              <span className="text-xs text-zinc-400">of {selected.unit.canonicalName}</span>
            </div>
            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 font-normal text-zinc-500">
              {selected.unit.scope === 'GLOBAL' ? 'global unit' : `${selected.unit.countryIso} unit`}
              {selected.unitVerified ? ' · VERIFIED' : ` · unit ${selected.unit.status.toLowerCase()}`}
            </Badge>
          </div>

          {/* Live revision panel — what the public sees (§19/§36) */}
          {selected.liveRevision ? (
            <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 p-3">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                Live revision — what the public sees (rev {selected.liveRevision.revisionNumber})
              </p>
              <p className="mt-1.5 text-sm font-medium">{selected.liveRevision.title}</p>
              <div className="globiq-scroll mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-white p-2 text-xs leading-relaxed text-zinc-600">
                {selected.liveRevision.body}
              </div>
              <p className="mt-2 text-[10px] text-zinc-400">
                Published {new Date(selected.liveRevision.publishedAt).toLocaleString()}
                {selected.liveRevision.publishedBy && ` by ${selected.liveRevision.publishedBy}`}
                {selected.liveRevision.changeSummary && (
                  <> · update note: <span className="italic">{selected.liveRevision.changeSummary}</span></>
                )}
                . Immutable (§36).
              </p>
            </div>
          ) : (
            <p className="mt-3 rounded-md border border-dashed border-zinc-300 px-3 py-2 text-xs text-zinc-500">
              Not published yet — no revision exists. Publishing snapshots the working copy into an
              immutable revision (§36).
            </p>
          )}

          {/* Working copy editor */}
          <div className="mt-4 space-y-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700">
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Working copy
              {selected.status === 'PUBLISHED' && (
                <span className="font-normal text-amber-700">
                  — staged: public reads keep the live revision until you publish a new one
                </span>
              )}
            </p>
            {selected.status === 'RETIRED' && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Retired items are read-only (§36) — end-of-life. Create a new representation if the
                content is needed again.
              </p>
            )}
            <div className="space-y-1.5">
              <UILabel htmlFor="content-editor-title" className="text-xs text-zinc-500">Title</UILabel>
              <Input
                id="content-editor-title"
                value={editor.title}
                disabled={!selected.canEdit}
                onChange={(event) =>
                  setEditorDraft({ key: selected.id, title: event.target.value, body: editor.body })
                }
              />
            </div>
            <div className="space-y-1.5">
              <UILabel htmlFor="content-editor-body" className="text-xs text-zinc-500">
                Body ({FORMAT_HINTS[selected.format]})
              </UILabel>
              <Textarea
                id="content-editor-body"
                className="min-h-[140px]"
                value={editor.body}
                disabled={!selected.canEdit}
                onChange={(event) =>
                  setEditorDraft({ key: selected.id, title: editor.title, body: event.target.value })
                }
              />
            </div>
            {/* §24/§26 AI-provenance toggle — working-copy state, snapshotted at publish */}
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-100 bg-zinc-50/60 px-2.5 py-2">
              <label className="flex min-h-[32px] cursor-pointer items-center gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={selected.aiAssisted}
                  onChange={() => void toggleAiAssisted()}
                  disabled={!selected.canEdit || aiToggleBusy}
                  className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
                />
                {aiToggleBusy ? 'Saving…' : 'Drafted with AI assistance (§26 provenance)'}
              </label>
              <span className="text-[10px] text-zinc-400">
                Frozen onto the published revision — readers see the flag on the live snapshot.
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                className="gap-2"
                onClick={() => void saveWorkingCopy()}
                disabled={
                  !selected.canEdit ||
                  saving ||
                  (editor.title === selected.title && editor.body === selected.body)
                }
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                Save working copy
              </Button>

              {/* Transitions (server-driven affordances — §20) */}
              {selected.allowedTransitions.includes('submit_review') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void runTransition('submit_review')}
                  disabled={busyAction !== null}
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  Submit review
                </Button>
              )}
              {selected.allowedTransitions.includes('send_back') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => void runTransition('send_back')}
                  disabled={busyAction !== null}
                >
                  <Undo2 className="h-4 w-4" aria-hidden="true" />
                  Send back
                </Button>
              )}
              {selected.allowedTransitions.includes('publish') && (
                <Button
                  size="sm"
                  className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={() => {
                    if (selected.status === 'PUBLISHED') {
                      setChangeSummary('')
                      setPublishDialog(true)
                    } else {
                      void runTransition('publish')
                    }
                  }}
                  disabled={busyAction !== null || !selected.unitVerified}
                  title={
                    selected.unitVerified
                      ? 'Snapshot the working copy into an immutable revision'
                      : `The owning unit is ${selected.unit.status} — publishing requires VERIFIED`
                  }
                >
                  {busyAction === 'publish' ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                  )}
                  {selected.status === 'PUBLISHED' ? 'Publish new revision' : 'Publish'}
                </Button>
              )}
              {selected.allowedTransitions.includes('retire') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-red-600 hover:text-red-700"
                  onClick={() => setRetireConfirm(true)}
                  disabled={busyAction !== null}
                >
                  <Archive className="h-4 w-4" aria-hidden="true" />
                  Retire
                </Button>
              )}
            </div>
          </div>

          {/* Revision history (§36) */}
          <div className="mt-4 border-t border-zinc-100 pt-3">
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              className="flex min-h-[36px] w-full items-center gap-1.5 text-xs font-semibold text-zinc-700 hover:text-zinc-900"
            >
              {historyOpen ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              Revision history ({selected.revisionCount})
            </button>
            {historyOpen && (
              <div className="mt-2 space-y-2">
                {!historyData ? (
                  <p className="flex items-center gap-2 text-xs text-zinc-400" aria-live="polite">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Loading history…
                  </p>
                ) : historyData.revisions.length === 0 ? (
                  <p className="text-xs text-zinc-500">No revisions yet.</p>
                ) : (
                  historyData.revisions.map((revision) => (
                    <div key={revision.id} className="rounded-md border border-zinc-200">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedRevision(expandedRevision === revision.revisionNumber ? null : revision.revisionNumber)
                        }
                        aria-expanded={expandedRevision === revision.revisionNumber}
                        className="flex w-full flex-wrap items-center gap-2 p-2.5 text-left"
                      >
                        <Badge
                          variant="outline"
                          className={`text-[10px] font-normal ${
                            selected.liveRevision?.revisionNumber === revision.revisionNumber
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                          }`}
                        >
                          rev {revision.revisionNumber}
                          {selected.liveRevision?.revisionNumber === revision.revisionNumber && ' · live'}
                        </Badge>
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{revision.title}</span>
                        <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                          <Clock8 className="h-3 w-3" aria-hidden="true" />
                          {new Date(revision.publishedAt).toLocaleString()}
                        </span>
                        {revision.aiAssisted && (
                          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[9px] font-normal text-amber-700">
                            <Bot className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                            AI
                          </Badge>
                        )}
                        {expandedRevision === revision.revisionNumber ? (
                          <ChevronDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                        )}
                      </button>
                      {expandedRevision === revision.revisionNumber && (
                        <div className="border-t border-zinc-100 p-2.5">
                          {revision.changeSummary && (
                            <p className="mb-2 text-xs italic text-zinc-500">
                              Change note: {revision.changeSummary}
                            </p>
                          )}
                          <div className="globiq-scroll max-h-40 overflow-y-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600">
                            {revision.body}
                          </div>
                          <p className="mt-1.5 text-[10px] text-zinc-400">
                            Published by {revision.publishedBy ?? 'unknown'} — immutable snapshot (§36).
                          </p>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Republish dialog — change summary required (§25/§36) */}
      <AlertDialog open={publishDialog} onOpenChange={setPublishDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Publish a new revision</AlertDialogTitle>
            <AlertDialogDescription>
              The working copy differs from the live revision (rev{' '}
              {selected?.liveRevision?.revisionNumber}). Publishing appends an immutable revision and
              moves the public pointer — the previous version stays preserved forever (§36). A change
              summary is required so the correction is never silent.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <UILabel htmlFor="content-change-summary">Change summary</UILabel>
            <Textarea
              id="content-change-summary"
              value={changeSummary}
              onChange={(event) => setChangeSummary(event.target.value)}
              placeholder="e.g. Corrected the launch vehicle designation after source re-check"
              className="min-h-[70px]"
            />
            {changeSummary.trim().length === 0 && (
              <p className="text-xs text-amber-600">A non-empty summary is required to publish.</p>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setChangeSummary('')}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={changeSummary.trim().length === 0 || busyAction !== null}
              onClick={() => {
                setPublishDialog(false)
                void runTransition('publish', changeSummary.trim())
              }}
            >
              {busyAction === 'publish' ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                'Publish revision'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Retire confirm (§19 step 10) */}
      <AlertDialog open={retireConfirm} onOpenChange={setRetireConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this content item?</AlertDialogTitle>
            <AlertDialogDescription>
              Retiring withdraws the item from the public surface immediately and makes it read-only
              (§19 archive/withdraw, §36). Its revision history is preserved. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                setRetireConfirm(false)
                void runTransition('retire')
              }}
            >
              Retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
