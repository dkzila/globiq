'use client'

/**
 * GlobIQ — Exams & Versions section (P3-S1)
 *
 * Master Plan §6 (Exam/ExamVersion), §14 (every exam belongs to exactly one
 * country — scope enforced server-side, this UI only renders server truth),
 * §16 (canonical exam paths), §18/§20 (exam operations are Country Admin /
 * Admin work — writers never see the console affordances), §36 (versioned
 * structures: append-only windows, retire needs a reason, pre-effective
 * corrections removable), §38 (editorial console + the public directory the
 * future exam pages build on in P3-S5).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  Ban,
  CalendarClock,
  GraduationCap,
  History,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ---------- API envelope + DTO mirrors ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface VersionRef {
  id: string
  label: string
  effectiveFrom: string
  effectiveTo: string | null
  source: string | null
  notes: string | null
  isCurrent: boolean
  isUpcoming: boolean
  createdAt: string
  updatedAt: string
}

interface AdminExam {
  id: string
  slug: string
  code: string
  name: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
  countryIso: string
  countryName: string
  description: string | null
  notes: string | null
  currentVersion: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  versionCount: number
  createdAt: string
  updatedAt: string
  canEdit: boolean
  editability: 'full' | 'metadata' | 'none'
  allowedTransitions: string[]
  versions?: VersionRef[]
}

interface AdminListResult {
  exams: AdminExam[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

interface PublicExam {
  id: string
  slug: string
  name: string
  code: string
  organiser: string
  level: string
  description: string | null
  countryIso: string
  currentVersion: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  versionCount: number
  canonicalPath: string
}

interface PublicListResult {
  exams: PublicExam[]
  pagination: { total: number }
  country: { isoCode: string; name: string }
}

interface CountryRef {
  isoCode: string
  name: string
  status: string
}

// ---------- Presentation helpers ----------

const STATUS_STYLE: Record<string, string> = {
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  ACTIVE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  INACTIVE: 'border-amber-200 bg-amber-50 text-amber-700',
  RETIRED: 'border-zinc-200 bg-zinc-100 text-zinc-400',
}

const LEVEL_STYLE: Record<string, string> = {
  NATIONAL: 'border-teal-200 bg-teal-50 text-teal-700',
  STATE: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  REGIONAL: 'border-lime-200 bg-lime-50 text-lime-700',
}

const TRANSITION_META: Record<string, { label: string; icon: typeof BadgeCheck; className: string }> = {
  activate: { label: 'Activate', icon: BadgeCheck, className: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  deactivate: { label: 'Deactivate', icon: Ban, className: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100' },
  reactivate: { label: 'Reactivate', icon: BadgeCheck, className: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  retire: { label: 'Retire…', icon: Ban, className: 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100' },
}

function day(value: string): string {
  return value.slice(0, 10)
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
}

// ---------- Component ----------

export function ExamsSection() {
  const { toast } = useToast()
  const token = useAuth((state) => state.token)
  const role = useAuth((state) => state.user?.role ?? 'READER')
  const permissions = useAuth((state) => state.permissions)
  const canManage = permissions.includes('exam:manage')

  // Admin list state
  const [result, setResult] = useState<AdminListResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AdminExam | null>(null)
  const [busy, setBusy] = useState(false)

  // Exam editor state
  const [name, setName] = useState('')
  const [organiser, setOrganiser] = useState('')
  const [level, setLevel] = useState<'NATIONAL' | 'STATE' | 'REGIONAL'>('NATIONAL')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')

  // Retire dialog
  const [retireOpen, setRetireOpen] = useState(false)
  const [retireReason, setRetireReason] = useState('')

  // Version create form
  const [versionLabel, setVersionLabel] = useState('')
  const [versionFrom, setVersionFrom] = useState('')
  const [versionTo, setVersionTo] = useState('')
  const [versionSource, setVersionSource] = useState('')
  const [versionNotes, setVersionNotes] = useState('')

  // Version metadata editor
  const [editingVersion, setEditingVersion] = useState<VersionRef | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editSource, setEditSource] = useState('')

  // Create exam form
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [createCode, setCreateCode] = useState('')
  const [createOrganiser, setCreateOrganiser] = useState('')
  const [createLevel, setCreateLevel] = useState<'NATIONAL' | 'STATE' | 'REGIONAL'>('NATIONAL')
  const [createCountry, setCreateCountry] = useState('IN')
  const [createDescription, setCreateDescription] = useState('')

  // Public directory state
  const [publicCountry, setPublicCountry] = useState('IN')
  const [publicResult, setPublicResult] = useState<PublicListResult | null>(null)
  const [publicLoading, setPublicLoading] = useState(false)
  const [activeCountries, setActiveCountries] = useState<CountryRef[]>([])

  const authHeaders = useCallback(
    (json = false): HeadersInit => ({
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token]
  )

  // ---------- Admin list ----------

  const fetchList = useCallback(async () => {
    if (!token || !canManage) return
    setLoading(true)
    const params = new URLSearchParams({ pageSize: '50' })
    if (statusFilter && statusFilter !== 'ALL') params.set('status', statusFilter)
    if (search.trim()) params.set('q', search.trim())
    try {
      const response = await fetch(`/api/exams/admin/exams?${params.toString()}`, {
        headers: authHeaders(),
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<AdminListResult>
      if (payload.status === 'ok' && payload.data) setResult(payload.data)
      else toast({ title: 'Could not load exams', description: payload.error?.message, variant: 'destructive' })
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [token, canManage, statusFilter, search, authHeaders, toast])

  useEffect(() => {
    void fetchList()
  }, [fetchList])

  // ---------- Public directory ----------

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: CountryRef[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          setActiveCountries(payload.data.countries.filter((country) => country.status === 'ACTIVE'))
        }
      })
      .catch(() => setActiveCountries([]))
  }, [])

  const fetchPublic = useCallback(async (country: string) => {
    setPublicLoading(true)
    try {
      const response = await fetch(`/api/exams?country=${country}&pageSize=50`, { cache: 'no-store' })
      const payload = (await response.json()) as Envelope<PublicListResult>
      if (payload.status === 'ok' && payload.data) setPublicResult(payload.data)
      else setPublicResult(null)
    } catch {
      setPublicResult(null)
    } finally {
      setPublicLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchPublic(publicCountry)
  }, [publicCountry, fetchPublic])

  // ---------- Selection / editor ----------

  const selectExam = useCallback(
    async (exam: AdminExam) => {
      setBusy(true)
      try {
        const response = await fetch(`/api/exams/admin/exams/${exam.id}`, {
          headers: authHeaders(),
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ exam: AdminExam }>
        if (payload.status === 'ok' && payload.data) {
          const detail = payload.data.exam
          setSelected(detail)
          setName(detail.name)
          setOrganiser(detail.organiser)
          setLevel(detail.level)
          setDescription(detail.description ?? '')
          setNotes(detail.notes ?? '')
          setVersionLabel('')
          setVersionFrom('')
          setVersionTo('')
          setVersionSource('')
          setVersionNotes('')
          setEditingVersion(null)
          setRetireReason('')
        } else {
          toast({ title: 'Could not open exam', description: payload.error?.message, variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
      } finally {
        setBusy(false)
      }
    },
    [authHeaders, toast]
  )

  const applyExamResult = useCallback((exam: AdminExam) => {
    setSelected(exam)
    setName(exam.name)
    setOrganiser(exam.organiser)
    setLevel(exam.level)
    setDescription(exam.description ?? '')
    setNotes(exam.notes ?? '')
  }, [])

  const request = useCallback(
    async (
      path: string,
      init: RequestInit,
      successMessage: string
    ): Promise<AdminExam | null> => {
      setBusy(true)
      try {
        const response = await fetch(path, {
          ...init,
          headers: { ...authHeaders(true), ...(init.headers ?? {}) },
        })
        const payload = (await response.json()) as Envelope<{ exam: AdminExam }>
        if (payload.status === 'ok' && payload.data) {
          toast({ title: successMessage })
          void fetchList()
          void fetchPublic(publicCountry)
          return payload.data.exam
        }
        toast({ title: 'Operation failed', description: payload.error?.message, variant: 'destructive' })
        return null
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
        return null
      } finally {
        setBusy(false)
      }
    },
    [authHeaders, fetchList, fetchPublic, publicCountry, toast]
  )

  const saveExam = useCallback(async () => {
    if (!selected) return
    const updated = await request(
      `/api/exams/admin/exams/${selected.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim(),
          organiser: organiser.trim(),
          level,
          ...(description.trim() ? { description: description.trim() } : { description: null }),
          ...(notes.trim() ? { notes: notes.trim() } : { notes: null }),
        }),
      },
      'Exam updated'
    )
    if (updated) applyExamResult(updated)
  }, [selected, name, organiser, level, description, notes, request, applyExamResult])

  const doTransition = useCallback(
    async (action: string, reason?: string) => {
      if (!selected) return
      const updated = await request(
        `/api/exams/admin/exams/${selected.id}/transition`,
        { method: 'POST', body: JSON.stringify({ action, ...(reason ? { reason } : {}) }) },
        `Exam ${action === 'retire' ? 'retired' : `${action}d`}`
      )
      if (updated) applyExamResult(updated)
    },
    [selected, request, applyExamResult]
  )

  const createVersion = useCallback(async () => {
    if (!selected) return
    const updated = await request(
      `/api/exams/admin/exams/${selected.id}/versions`,
      {
        method: 'POST',
        body: JSON.stringify({
          label: versionLabel.trim(),
          ...(versionFrom ? { effectiveFrom: versionFrom } : {}),
          ...(versionTo ? { effectiveTo: versionTo } : {}),
          ...(versionSource.trim() ? { source: versionSource.trim() } : {}),
          ...(versionNotes.trim() ? { notes: versionNotes.trim() } : {}),
        }),
      },
      'New exam version created (§36)'
    )
    if (updated) {
      applyExamResult(updated)
      setVersionLabel('')
      setVersionFrom('')
      setVersionTo('')
      setVersionSource('')
      setVersionNotes('')
    }
  }, [selected, versionLabel, versionFrom, versionTo, versionSource, versionNotes, request, applyExamResult])

  const saveVersionMetadata = useCallback(async () => {
    if (!selected || !editingVersion) return
    const updated = await request(
      `/api/exams/admin/exams/${selected.id}/versions/${editingVersion.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          label: editLabel.trim(),
          ...(editSource.trim() ? { source: editSource.trim() } : { source: null }),
        }),
      },
      'Version metadata updated'
    )
    if (updated) {
      applyExamResult(updated)
      setEditingVersion(null)
    }
  }, [selected, editingVersion, editLabel, editSource, request, applyExamResult])

  const removeVersion = useCallback(
    async (version: VersionRef) => {
      if (!selected) return
      const updated = await request(
        `/api/exams/admin/exams/${selected.id}/versions/${version.id}`,
        { method: 'DELETE' },
        'Future-dated version removed — predecessor reopened'
      )
      if (updated) applyExamResult(updated)
    },
    [selected, request, applyExamResult]
  )

  const createExam = useCallback(async () => {
    const created = await request(
      '/api/exams/admin/exams',
      {
        method: 'POST',
        body: JSON.stringify({
          name: createName.trim(),
          slug: createSlug.trim(),
          code: createCode.trim().toUpperCase(),
          organiser: createOrganiser.trim(),
          level: createLevel,
          country: createCountry,
          ...(createDescription.trim() ? { description: createDescription.trim() } : {}),
        }),
      },
      'Exam created (DRAFT)'
    )
    if (created) {
      setCreateOpen(false)
      setCreateName('')
      setCreateSlug('')
      setCreateCode('')
      setCreateOrganiser('')
      setCreateLevel('NATIONAL')
      setCreateDescription('')
      applyExamResult(created)
    }
  }, [
    createName,
    createSlug,
    createCode,
    createOrganiser,
    createLevel,
    createCountry,
    createDescription,
    request,
    applyExamResult,
  ])

  const versions = useMemo(() => selected?.versions ?? [], [selected])

  // ---------- Render ----------

  return (
    <section aria-labelledby="exams-heading" className="mt-10 space-y-4">
      <div className="flex items-center gap-2">
        <GraduationCap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="exams-heading" className="text-xl font-semibold tracking-tight">
          Exams &amp; versions (P3-S1)
        </h2>
        <Badge variant="outline" className="font-mono text-[10px] font-normal text-zinc-500">
          §6 · §14 · §36
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Country-specific exam definitions with versioned structures: every exam belongs to exactly one
        country (§14), and syllabus changes create a <strong>new ExamVersion</strong> instead of editing
        history (§36). The currently effective version is the anchor the §11 combination engine resolves.
      </p>

      <Tabs defaultValue={canManage ? 'console' : 'directory'}>
        <TabsList>
          {canManage && <TabsTrigger value="console">Editorial console</TabsTrigger>}
          <TabsTrigger value="directory">Public directory</TabsTrigger>
        </TabsList>

        {/* ---------- Editorial console (§38) ---------- */}
        {canManage && (
          <TabsContent value="console" className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[200px] flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search name, code, organiser…"
                  className="pl-9"
                  aria-label="Search exams"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[150px]" aria-label="Filter by status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All statuses</SelectItem>
                  <SelectItem value="DRAFT">DRAFT</SelectItem>
                  <SelectItem value="ACTIVE">ACTIVE</SelectItem>
                  <SelectItem value="INACTIVE">INACTIVE</SelectItem>
                  <SelectItem value="RETIRED">RETIRED</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" onClick={() => void fetchList()} disabled={loading} className="h-9 gap-2">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh
              </Button>
              <Button size="sm" onClick={() => setCreateOpen((open) => !open)} className="h-9 gap-2">
                <Plus className="h-4 w-4" aria-hidden="true" />
                New exam
              </Button>
            </div>

            {/* Create form */}
            {createOpen && (
              <Card className="border-emerald-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Create exam — enters DRAFT</CardTitle>
                  <CardDescription>
                    slug + code + country are immutable identity (§37 stable identifiers).
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <UILabel htmlFor="exam-name">Exam name</UILabel>
                    <Input
                      id="exam-name"
                      value={createName}
                      onChange={(event) => {
                        setCreateName(event.target.value)
                        if (!createSlug) setCreateSlug(slugify(event.target.value))
                      }}
                      placeholder="UPSC Civil Services Examination"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <UILabel htmlFor="exam-slug">Slug (URL-stable)</UILabel>
                    <Input
                      id="exam-slug"
                      value={createSlug}
                      onChange={(event) => setCreateSlug(event.target.value)}
                      placeholder="upsc-civil-services"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <UILabel htmlFor="exam-code">Code</UILabel>
                    <Input
                      id="exam-code"
                      value={createCode}
                      onChange={(event) => setCreateCode(event.target.value.toUpperCase())}
                      placeholder="UPSC-CSE"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <UILabel htmlFor="exam-organiser">Organiser (conducting body)</UILabel>
                    <Input
                      id="exam-organiser"
                      value={createOrganiser}
                      onChange={(event) => setCreateOrganiser(event.target.value)}
                      placeholder="Union Public Service Commission"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <UILabel>Level</UILabel>
                    <Select value={createLevel} onValueChange={(value) => setCreateLevel(value as typeof createLevel)}>
                      <SelectTrigger aria-label="Exam level">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="NATIONAL">NATIONAL</SelectItem>
                        <SelectItem value="STATE">STATE</SelectItem>
                        <SelectItem value="REGIONAL">REGIONAL</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <UILabel>Country (§14 — exactly one)</UILabel>
                    {role === 'ADMIN' ? (
                      <Select value={createCountry} onValueChange={setCreateCountry}>
                        <SelectTrigger aria-label="Owning country">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activeCountries.map((country) => (
                            <SelectItem key={country.isoCode} value={country.isoCode}>
                              {country.name} ({country.isoCode})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input value="Your country (fixed)" disabled />
                    )}
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <UILabel htmlFor="exam-description">Description (optional)</UILabel>
                    <Textarea
                      id="exam-description"
                      value={createDescription}
                      onChange={(event) => setCreateDescription(event.target.value)}
                      rows={2}
                      placeholder="What this exam is, who runs it, what it selects for…"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Button onClick={() => void createExam()} disabled={busy} className="gap-2">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                      Create exam
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* List */}
            {loading && !result ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : result && result.exams.length > 0 ? (
              <div className="max-h-96 space-y-2 overflow-y-auto pr-1 globiq-scroll" role="list" aria-label="Exams">
                {result.exams.map((exam) => (
                  <button
                    key={exam.id}
                    type="button"
                    role="listitem"
                    onClick={() => void selectExam(exam)}
                    className={`w-full rounded-lg border p-3 text-left shadow-sm transition-colors hover:border-emerald-300 ${
                      selected?.id === exam.id ? 'border-emerald-400 bg-emerald-50/50' : 'border-zinc-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {exam.name} <span className="font-mono text-xs text-zinc-400">{exam.code}</span>
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-500">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden="true" /> {exam.countryIso}
                          </span>
                          <span>·</span>
                          <span>{exam.organiser}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] ${LEVEL_STYLE[exam.level]}`}>
                          {exam.level}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_STYLE[exam.status]}`}>
                          {exam.status}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] font-normal">
                          <History className="mr-1 h-3 w-3" aria-hidden="true" />
                          {exam.versionCount}
                        </Badge>
                      </div>
                    </div>
                    {exam.currentVersion && (
                      <p className="mt-1.5 truncate text-xs text-emerald-700">
                        <CalendarClock className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        {exam.currentVersion.label} · since {day(exam.currentVersion.effectiveFrom)}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                No exams yet — create the first one above.
              </p>
            )}

            {/* Detail: editor + lifecycle + versions */}
            {selected && (
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">{selected.name}</CardTitle>
                      <CardDescription className="font-mono text-xs">
                        /{selected.slug}/ · {selected.countryName} ({selected.countryIso}) ·{' '}
                        {selected.editability === 'none' ? 'read-only (RETIRED)' : `${selected.editability} edit`}
                      </CardDescription>
                    </div>
                    <Badge variant="outline" className={STATUS_STYLE[selected.status]}>
                      {selected.status}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Lifecycle */}
                  <div className="flex flex-wrap gap-2">
                    {selected.allowedTransitions.map((action) => {
                      const meta = TRANSITION_META[action]
                      if (!meta) return null
                      const Icon = meta.icon
                      return (
                        <Button
                          key={action}
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            if (action === 'retire') setRetireOpen(true)
                            else void doTransition(action)
                          }}
                          className={`h-9 gap-2 ${meta.className}`}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          {meta.label}
                        </Button>
                      )
                    })}
                    {selected.allowedTransitions.length === 0 && (
                      <p className="text-xs text-zinc-400">No transitions available (end-of-life).</p>
                    )}
                  </div>

                  <Separator />

                  {/* Metadata editor */}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <UILabel htmlFor="edit-name">Name</UILabel>
                      <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!selected.canEdit} />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="edit-organiser">Organiser</UILabel>
                      <Input id="edit-organiser" value={organiser} onChange={(event) => setOrganiser(event.target.value)} disabled={!selected.canEdit} />
                    </div>
                    <div className="space-y-1.5">
                      <UILabel>Level</UILabel>
                      <Select value={level} onValueChange={(value) => setLevel(value as typeof level)} disabled={!selected.canEdit}>
                        <SelectTrigger aria-label="Exam level">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NATIONAL">NATIONAL</SelectItem>
                          <SelectItem value="STATE">STATE</SelectItem>
                          <SelectItem value="REGIONAL">REGIONAL</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <UILabel htmlFor="edit-notes">Internal notes</UILabel>
                      <Input id="edit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!selected.canEdit} />
                    </div>
                    <div className="space-y-1.5 sm:col-span-2">
                      <UILabel htmlFor="edit-description">Description</UILabel>
                      <Textarea id="edit-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} disabled={!selected.canEdit} />
                    </div>
                    <div className="sm:col-span-2">
                      <Button size="sm" onClick={() => void saveExam()} disabled={busy || !selected.canEdit} className="gap-2">
                        <Save className="h-4 w-4" aria-hidden="true" />
                        Save changes
                      </Button>
                    </div>
                  </div>

                  <Separator />

                  {/* Versions (§36) */}
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <History className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                      <h4 className="text-sm font-semibold">Version history (§36 — append-only)</h4>
                    </div>
                    <p className="text-xs text-zinc-500">
                      Windows are day-granular and immutable; a new version closes the open one the day
                      before it starts. Future-dated mistakes can be removed; effective history never changes.
                    </p>

                    {versions.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
                        No versions yet — the exam has no syllabus structure until one is created (P3-S2
                        builds the SyllabusNode tree on top of a version).
                      </p>
                    ) : (
                      <ol className="space-y-2">
                        {versions.map((version) => (
                          <li
                            key={version.id}
                            className={`rounded-lg border p-3 ${
                              version.isCurrent ? 'border-emerald-300 bg-emerald-50/40' : 'border-zinc-200 bg-white'
                            }`}
                          >
                            {editingVersion?.id === version.id ? (
                              <div className="space-y-2">
                                <Input value={editLabel} onChange={(event) => setEditLabel(event.target.value)} aria-label="Version label" />
                                <Input value={editSource} onChange={(event) => setEditSource(event.target.value)} placeholder="Source (official notification)" aria-label="Version source" />
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => void saveVersionMetadata()} disabled={busy} className="gap-1.5">
                                    <Save className="h-3.5 w-3.5" aria-hidden="true" /> Save metadata
                                  </Button>
                                  <Button size="sm" variant="ghost" onClick={() => setEditingVersion(null)}>
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                                    {version.label}
                                    {version.isCurrent && (
                                      <Badge variant="outline" className="text-[10px] text-emerald-700">
                                        <ShieldCheck className="mr-1 h-3 w-3" aria-hidden="true" /> CURRENT
                                      </Badge>
                                    )}
                                    {version.isUpcoming && (
                                      <Badge variant="outline" className="text-[10px] text-amber-700">
                                        UPCOMING
                                      </Badge>
                                    )}
                                  </p>
                                  <p className="mt-0.5 font-mono text-xs text-zinc-500">
                                    {day(version.effectiveFrom)} → {version.effectiveTo ? day(version.effectiveTo) : 'open'}
                                  </p>
                                  {version.source && <p className="mt-0.5 truncate text-xs text-zinc-500">{version.source}</p>}
                                </div>
                                <div className="flex shrink-0 gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      setEditingVersion(version)
                                      setEditLabel(version.label)
                                      setEditSource(version.source ?? '')
                                    }}
                                    aria-label={`Edit metadata of ${version.label}`}
                                  >
                                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                  {version.isUpcoming && (
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="text-red-600 hover:bg-red-50"
                                      onClick={() => void removeVersion(version)}
                                      disabled={busy}
                                      aria-label={`Remove future-dated version ${version.label}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}

                    {/* New version form */}
                    {selected.status !== 'RETIRED' && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3">
                        <p className="mb-2 text-xs font-medium text-emerald-800">
                          New version — syllabus change (creates a new ExamVersion, closes the open one)
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input value={versionLabel} onChange={(event) => setVersionLabel(event.target.value)} placeholder="Label, e.g. 2026 syllabus" aria-label="Version label" />
                          <Input type="date" value={versionFrom} onChange={(event) => setVersionFrom(event.target.value)} aria-label="Effective from (defaults to today)" />
                          <Input type="date" value={versionTo} onChange={(event) => setVersionTo(event.target.value)} aria-label="Effective to (optional, inclusive)" />
                          <Input value={versionSource} onChange={(event) => setVersionSource(event.target.value)} placeholder="Source (official notification / URL)" aria-label="Version source" />
                          <div className="sm:col-span-2">
                            <Button size="sm" onClick={() => void createVersion()} disabled={busy || !versionLabel.trim()} className="gap-2">
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                              Create version
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        )}

        {/* ---------- Public directory (§38 public app) ---------- */}
        <TabsContent value="directory" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={publicCountry} onValueChange={setPublicCountry}>
              <SelectTrigger className="w-[200px]" aria-label="Country context">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {activeCountries.map((country) => (
                  <SelectItem key={country.isoCode} value={country.isoCode}>
                    {country.name} ({country.isoCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-zinc-500">
              What a reader sees: ACTIVE exams with their currently effective version (§11 resolution)
              and §16 canonical path. Full exam pages land in P3-S5.
            </p>
          </div>

          {publicLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : publicResult && publicResult.exams.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {publicResult.exams.map((exam) => (
                <Card key={exam.id} className="border-zinc-200 shadow-sm">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-sm">{exam.name}</CardTitle>
                      <Badge variant="outline" className={`shrink-0 text-[10px] ${LEVEL_STYLE[exam.level] ?? ''}`}>
                        {exam.level}
                      </Badge>
                    </div>
                    <CardDescription className="text-xs">
                      {exam.organiser} · <span className="font-mono">{exam.code}</span>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {exam.currentVersion ? (
                      <p className="text-xs text-emerald-700">
                        <CalendarClock className="mr-1 inline h-3 w-3" aria-hidden="true" />
                        {exam.currentVersion.label} · since {day(exam.currentVersion.effectiveFrom)}
                      </p>
                    ) : (
                      <p className="text-xs text-amber-600">No version in effect yet</p>
                    )}
                    <p className="truncate font-mono text-[11px] text-zinc-400">{exam.canonicalPath}</p>
                    {exam.description && <p className="line-clamp-2 text-xs text-zinc-500">{exam.description}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-zinc-200 bg-white p-4 text-sm text-zinc-500">
              No public exams for this country yet.
            </p>
          )}
        </TabsContent>
      </Tabs>

      {/* Retire reason dialog (§36 provenance) */}
      <AlertDialog open={retireOpen} onOpenChange={setRetireOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire this exam?</AlertDialogTitle>
            <AlertDialogDescription>
              End-of-life: the exam becomes read-only and disappears from the public directory. A reason
              is required and recorded in the audit trail (§36).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={retireReason}
            onChange={(event) => setRetireReason(event.target.value)}
            placeholder="Why is this exam being retired? (e.g. discontinued by the conducting body)"
            rows={3}
            aria-label="Retire reason"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!retireReason.trim() || busy}
              onClick={() => void doTransition('retire', retireReason.trim())}
            >
              Retire exam
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
