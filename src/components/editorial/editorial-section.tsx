'use client'

/**
 * GlobIQ — Editorial Section (P2-S4)
 *
 * The §19 editorial workspace on the foundation page: the EditorialTask board
 * (§6) with server-driven affordances (§20), the §18 role rules made visible
 * (writers claim/start/resolve their tasks; editors manage the board), the
 * §20 staff-scope directory for assignment, and the workflow wiring notice —
 * submit_review opens review tasks; publish/schedule/retire close them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  Loader2,
  PlayCircle,
  Plus,
  RotateCcw,
  Search,
  UserCheck,
  Users,
  XCircle,
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
import { Textarea } from '@/components/ui/textarea'

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

interface TaskDto {
  id: string
  type: string
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
  countryIso: string | null
  language: { code: string; name: string } | null
  objectType: string
  objectId: string
  objectLabel: string
  title: string
  notes: string | null
  resolutionNote: string | null
  assignee: { id: string; email: string; name: string | null } | null
  dueAt: string | null
  startedAt: string | null
  resolvedAt: string | null
  resolvedBy: string | null
  createdAt: string
  updatedAt: string
  allowedActions: string[]
  canManage: boolean
}

interface BoardResult {
  tasks: TaskDto[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
  summary: { total: number; open: number; inProgress: number; resolved: number; cancelled: number }
  facets: { types: string[] }
}

interface StaffDto {
  id: string
  email: string
  name: string | null
  role: 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'
  homeCountryIso: string | null
  languageScopeCode: string | null
}

interface ItemPick {
  id: string
  title: string
  status: string
  objectLabel: string
}

const TASK_TYPE_OPTIONS = [
  'EDITORIAL_REVIEW',
  'FACT_CHECK',
  'LOCALISATION_REVIEW',
  'SEO_REVIEW',
  'EXAM_MAPPING_REVIEW',
  'CORRECTION',
  'GENERAL',
] as const

const TYPE_LABELS: Record<string, string> = {
  EDITORIAL_REVIEW: 'Editorial review',
  FACT_CHECK: 'Fact / source check',
  LOCALISATION_REVIEW: 'Localisation review',
  SEO_REVIEW: 'SEO review',
  EXAM_MAPPING_REVIEW: 'Exam mapping review',
  CORRECTION: 'Correction',
  GENERAL: 'General',
}

const statusStyle: Record<string, string> = {
  OPEN: 'border-sky-200 bg-sky-50 text-sky-700',
  IN_PROGRESS: 'border-amber-200 bg-amber-50 text-amber-700',
  RESOLVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELLED: 'border-zinc-300 bg-zinc-100 text-zinc-500',
}

const priorityStyle: Record<string, string> = {
  LOW: 'border-zinc-200 bg-zinc-50 text-zinc-500',
  MEDIUM: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  HIGH: 'border-orange-200 bg-orange-50 text-orange-700',
  URGENT: 'border-red-200 bg-red-50 text-red-700',
}

const COUNTRY_OPTIONS = ['', 'global', 'IN', 'FR', 'UK'] as const

export function EditorialSection() {
  const token = useAuth((state) => state.token)
  const user = useAuth((state) => state.user)
  const permissions = useAuth((state) => state.permissions)
  const canWork = permissions.includes('editorial:work')
  const canPublish = permissions.includes('content:publish') // editors
  const { toast } = useToast()

  // Board query state.
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [countryFilter, setCountryFilter] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [board, setBoard] = useState<BoardResult | null>(null)
  const [boardError, setBoardError] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)

  // Resolve-with-note inline panel.
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const [resolveNote, setResolveNote] = useState('')

  // Staff directory (editors).
  const [staff, setStaff] = useState<StaffDto[] | null>(null)

  // Create form (editors).
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    type: 'FACT_CHECK',
    title: '',
    notes: '',
    assigneeId: '',
    priority: 'MEDIUM',
    dueAt: '',
  })
  const [itemSearch, setItemSearch] = useState('')
  const [itemPicks, setItemPicks] = useState<ItemPick[] | null>(null)
  const [itemSearching, setItemSearching] = useState(false)
  const [pickedItemId, setPickedItemId] = useState('')
  const [createErrors, setCreateErrors] = useState<Record<string, string[]> | null>(null)
  const [creating, setCreating] = useState(false)

  const isAdmin = user?.role === 'ADMIN'

  const apiError = (payload: Envelope<unknown>): string =>
    payload.error?.message ?? 'The operation failed'

  // ---------- Board load ----------
  const fetchBoard = useCallback(async () => {
    if (!token || !canWork) return
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (typeFilter) params.set('type', typeFilter)
    if (assigneeFilter) params.set('assignee', assigneeFilter)
    if (countryFilter) params.set('country', countryFilter)
    if (query.trim()) params.set('q', query.trim())
    params.set('page', String(page))
    params.set('pageSize', '10')
    try {
      const response = await fetch(`/api/editorial/tasks?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<BoardResult>
      if (payload.status === 'ok' && payload.data) {
        setBoard(payload.data)
        setBoardError(null)
      } else {
        setBoardError(apiError(payload))
        setBoard({ tasks: [], pagination: { page: 1, pageSize: 10, total: 0, totalPages: 1 }, summary: { total: 0, open: 0, inProgress: 0, resolved: 0, cancelled: 0 }, facets: { types: [] } })
      }
    } catch {
      setBoardError('Network error — please retry.')
    }
  }, [token, canWork, statusFilter, typeFilter, assigneeFilter, countryFilter, query, page])

  useEffect(() => {
    void fetchBoard()
  }, [fetchBoard])

  // ---------- Staff directory (editors, for assignment UI) ----------
  useEffect(() => {
    if (!token || !canPublish) return
    let cancelled = false
    async function run() {
      const response = await fetch('/api/editorial/assignees', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ staff: StaffDto[] }>
      if (!cancelled) setStaff(payload.status === 'ok' && payload.data ? payload.data.staff : [])
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, canPublish])

  // ---------- Content item search for the create form ----------
  useEffect(() => {
    if (!createOpen || !token || itemSearch.trim().length < 3) {
      setItemPicks(null)
      return
    }
    let cancelled = false
    setItemSearching(true)
    async function run() {
      const params = new URLSearchParams({ q: itemSearch.trim(), pageSize: '8' })
      const response = await fetch(`/api/content/admin/items?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{
        items: Array<{
          id: string
          title: string
          status: string
          unit: { slug: string }
          language: { code: string }
          format: string
        }>
      }>
      if (cancelled) return
      setItemPicks(
        payload.status === 'ok' && payload.data
          ? payload.data.items.map((item) => ({
              id: item.id,
              title: item.title,
              status: item.status,
              objectLabel: `${item.unit.slug}/${item.language.code}/${item.format}`,
            }))
          : []
      )
      setItemSearching(false)
    }
    const timer = setTimeout(() => void run(), 350) // debounce
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [createOpen, token, itemSearch])

  // ---------- Actions ----------
  const runTaskAction = useCallback(
    async (task: TaskDto, action: string, resolutionNote?: string) => {
      if (!token) return
      setBusyAction(`${task.id}:${action}`)
      try {
        const response = await fetch(`/api/editorial/tasks/${task.id}/transition`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(resolutionNote !== undefined ? { action, resolutionNote } : { action }),
        })
        const payload = (await response.json()) as Envelope<{ task: TaskDto }>
        if (payload.status === 'ok' && payload.data) {
          setBoard((current) =>
            current
              ? {
                  ...current,
                  tasks: current.tasks.map((entry) =>
                    entry.id === payload.data!.task.id ? payload.data!.task : entry
                  ),
                }
              : current
          )
          toast({ title: `Done — ${action}`, description: TYPE_LABELS[task.type] ?? task.type })
          setResolvingId(null)
          setResolveNote('')
          void fetchBoard() // refresh summary counts
        } else {
          toast({ title: 'Action failed', description: apiError(payload), variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
      } finally {
        setBusyAction(null)
      }
    },
    [token, toast, fetchBoard]
  )

  const reassign = useCallback(
    async (task: TaskDto, assigneeId: string | null) => {
      if (!token) return
      setBusyAction(`${task.id}:assign`)
      try {
        const response = await fetch(`/api/editorial/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ assigneeId }),
        })
        const payload = (await response.json()) as Envelope<{ task: TaskDto }>
        if (payload.status === 'ok' && payload.data) {
          setBoard((current) =>
            current
              ? {
                  ...current,
                  tasks: current.tasks.map((entry) =>
                    entry.id === payload.data!.task.id ? payload.data!.task : entry
                  ),
                }
              : current
          )
          toast({
            title: assigneeId ? 'Task assigned' : 'Assignment cleared',
            description: 'Back to the unclaimed pool.' ,
          })
        } else {
          toast({ title: 'Could not assign', description: apiError(payload), variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
      } finally {
        setBusyAction(null)
      }
    },
    [token, toast]
  )

  const submitCreate = useCallback(async () => {
    if (!token) return
    setCreating(true)
    setCreateErrors(null)
    try {
      const response = await fetch('/api/editorial/tasks', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: createForm.type,
          objectId: pickedItemId,
          title: createForm.title,
          ...(createForm.notes.trim() ? { notes: createForm.notes.trim() } : {}),
          ...(createForm.assigneeId ? { assigneeId: createForm.assigneeId } : {}),
          priority: createForm.priority,
          ...(createForm.dueAt ? { dueAt: new Date(createForm.dueAt).toISOString() } : {}),
        }),
      })
      const payload = (await response.json()) as Envelope<{ task: TaskDto }>
      if (payload.status === 'ok' && payload.data) {
        setCreateOpen(false)
        setCreateForm({ type: 'FACT_CHECK', title: '', notes: '', assigneeId: '', priority: 'MEDIUM', dueAt: '' })
        setPickedItemId('')
        setItemSearch('')
        setItemPicks(null)
        toast({ title: 'Work item created', description: 'Opened on the board (§19).' })
        setPage(1)
        void fetchBoard()
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
  }, [token, createForm, pickedItemId, fetchBoard])

  const typeOptions = useMemo(() => {
    const facetTypes = board?.facets.types ?? []
    return TASK_TYPE_OPTIONS.filter((type) => facetTypes.length === 0 || facetTypes.includes(type))
  }, [board?.facets.types])

  // ---------- Render ----------

  return (
    <section aria-labelledby="editorial-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="editorial-heading" className="text-xl font-semibold tracking-tight">
            Editorial workspace — the workflow board
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §19 · tasks · review cycle · staff scopes
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Every submission opens a review work item (§19); publishing, scheduling or retiring closes
        them. <span className="font-medium text-zinc-800">Writers</span> claim and resolve assigned
        tasks but never publish (§18); <span className="font-medium text-zinc-800">editors</span>{' '}
        manage the board with explicit country/language scopes (§20) — checked server-side on every
        operation.
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Task board</CardTitle>
          <CardDescription>
            Scheduled releases publish automatically at their time (§19 step 7); corrections route
            here as CORRECTION tasks once the public feedback loop lands (P8-S3).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!canWork ? (
            <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
              The editorial workspace requires a staff role (WRITER / COUNTRY_ADMIN / ADMIN). Sign
              in as staff to work the board — readers see the outcome on published content above.
            </p>
          ) : (
            <>
              {/* Summary chips */}
              {board ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="border-sky-200 bg-sky-50 font-normal text-sky-700">
                    {board.summary.open} open
                  </Badge>
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 font-normal text-amber-700">
                    {board.summary.inProgress} in progress
                  </Badge>
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
                    {board.summary.resolved} resolved
                  </Badge>
                  <Badge variant="outline" className="border-zinc-300 bg-zinc-100 font-normal text-zinc-500">
                    {board.summary.cancelled} cancelled
                  </Badge>
                  <span className="text-zinc-400">
                    {board.summary.total} in your scope
                    {user?.languageScope ? ` · language-scoped: ${user.languageScope.name}` : ''}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-5 w-20" />
                </div>
              )}

              {/* Filters */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <div className="space-y-1">
                  <UILabel htmlFor="task-filter-status" className="text-[10px] uppercase tracking-wide text-zinc-400">
                    Status
                  </UILabel>
                  <Select value={statusFilter || 'all'} onValueChange={(value) => { setPage(1); setStatusFilter(value === 'all' ? '' : value) }}>
                    <SelectTrigger id="task-filter-status" className="h-9 text-xs" aria-label="Filter by status">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="OPEN">Open</SelectItem>
                      <SelectItem value="IN_PROGRESS">In progress</SelectItem>
                      <SelectItem value="RESOLVED">Resolved</SelectItem>
                      <SelectItem value="CANCELLED">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <UILabel htmlFor="task-filter-type" className="text-[10px] uppercase tracking-wide text-zinc-400">
                    Type
                  </UILabel>
                  <Select value={typeFilter || 'all'} onValueChange={(value) => { setPage(1); setTypeFilter(value === 'all' ? '' : value) }}>
                    <SelectTrigger id="task-filter-type" className="h-9 text-xs" aria-label="Filter by type">
                      <SelectValue placeholder="All" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      {TASK_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type}>
                          {TYPE_LABELS[type]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <UILabel htmlFor="task-filter-assignee" className="text-[10px] uppercase tracking-wide text-zinc-400">
                    Assignee
                  </UILabel>
                  <Select value={assigneeFilter || 'any'} onValueChange={(value) => { setPage(1); setAssigneeFilter(value === 'any' ? '' : value) }}>
                    <SelectTrigger id="task-filter-assignee" className="h-9 text-xs" aria-label="Filter by assignee">
                      <SelectValue placeholder="Anyone" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Anyone</SelectItem>
                      <SelectItem value="me">Assigned to me</SelectItem>
                      <SelectItem value="unassigned">Unclaimed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {isAdmin ? (
                  <div className="space-y-1">
                    <UILabel htmlFor="task-filter-country" className="text-[10px] uppercase tracking-wide text-zinc-400">
                      Workspace
                    </UILabel>
                    <Select value={countryFilter || 'all'} onValueChange={(value) => { setPage(1); setCountryFilter(value === 'all' ? '' : value) }}>
                      <SelectTrigger id="task-filter-country" className="h-9 text-xs" aria-label="Filter by country workspace">
                        <SelectValue placeholder="All" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All workspaces</SelectItem>
                        {COUNTRY_OPTIONS.filter((code) => code !== '').map((code) => (
                          <SelectItem key={code} value={code}>
                            {code === 'global' ? 'Global (platform)' : code}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <div className="space-y-1">
                  <UILabel htmlFor="task-filter-q" className="text-[10px] uppercase tracking-wide text-zinc-400">
                    Search
                  </UILabel>
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                    <Input
                      id="task-filter-q"
                      className="h-9 pl-8 text-xs"
                      placeholder="Title or object…"
                      value={query}
                      onChange={(event) => {
                        setPage(1)
                        setQuery(event.target.value)
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Create (editors) */}
              {canPublish && (
                <div className="rounded-md border border-zinc-200 bg-zinc-50/60 p-3">
                  {!createOpen ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() => setCreateOpen(true)}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      New work item
                    </Button>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-zinc-700">
                        New work item (§6 EditorialTask — editors create, §18)
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <UILabel htmlFor="task-create-type" className="text-xs text-zinc-500">Type</UILabel>
                          <Select value={createForm.type} onValueChange={(value) => setCreateForm((form) => ({ ...form, type: value }))}>
                            <SelectTrigger id="task-create-type" className="h-9 text-xs" aria-label="Task type">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TASK_TYPE_OPTIONS.map((type) => (
                                <SelectItem key={type} value={type}>
                                  {TYPE_LABELS[type]}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <UILabel htmlFor="task-create-priority" className="text-xs text-zinc-500">Priority</UILabel>
                          <Select value={createForm.priority} onValueChange={(value) => setCreateForm((form) => ({ ...form, priority: value }))}>
                            <SelectTrigger id="task-create-priority" className="h-9 text-xs" aria-label="Priority">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => (
                                <SelectItem key={priority} value={priority}>
                                  {priority.toLowerCase()}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <UILabel htmlFor="task-create-title" className="text-xs text-zinc-500">Title</UILabel>
                        <Input
                          id="task-create-title"
                          className="h-9 text-xs"
                          placeholder="e.g. Verify the National Space Day citation"
                          value={createForm.title}
                          onChange={(event) => setCreateForm((form) => ({ ...form, title: event.target.value }))}
                        />
                        {createErrors?.title && <p className="text-xs text-red-600">{createErrors.title[0]}</p>}
                      </div>
                      <div className="space-y-1">
                        <UILabel htmlFor="task-create-item" className="text-xs text-zinc-500">
                          Work object — search content items
                        </UILabel>
                        <Input
                          id="task-create-item"
                          className="h-9 text-xs"
                          placeholder="Type 3+ characters to search content…"
                          value={itemSearch}
                          onChange={(event) => {
                            setItemSearch(event.target.value)
                            setPickedItemId('')
                          }}
                        />
                        {itemSearching && <p className="text-xs text-zinc-400">Searching…</p>}
                        {itemPicks && itemPicks.length === 0 && !itemSearching && (
                          <p className="text-xs text-zinc-400">No matching content items.</p>
                        )}
                        {itemPicks && itemPicks.length > 0 && (
                          <div className="globiq-scroll max-h-36 space-y-1 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1">
                            {itemPicks.map((pick) => (
                              <button
                                key={pick.id}
                                type="button"
                                onClick={() => {
                                  setPickedItemId(pick.id)
                                  setItemSearch(pick.title)
                                }}
                                className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-zinc-50 ${
                                  pickedItemId === pick.id ? 'bg-emerald-50 text-emerald-800' : 'text-zinc-700'
                                }`}
                              >
                                <span className="font-medium">{pick.title}</span>
                                <span className="ml-1 text-zinc-400">
                                  · {pick.objectLabel} · {pick.status.toLowerCase()}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {createErrors?.objectId && <p className="text-xs text-red-600">{createErrors.objectId[0]}</p>}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <UILabel htmlFor="task-create-assignee" className="text-xs text-zinc-500">Assignee (optional)</UILabel>
                          <Select
                            value={createForm.assigneeId || 'unassigned'}
                            onValueChange={(value) => setCreateForm((form) => ({ ...form, assigneeId: value === 'unassigned' ? '' : value }))}
                          >
                            <SelectTrigger id="task-create-assignee" className="h-9 text-xs" aria-label="Assignee">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="unassigned">Unassigned (unclaimed pool)</SelectItem>
                              {(staff ?? []).map((member) => (
                                <SelectItem key={member.id} value={member.id}>
                                  {member.name ?? member.email} · {member.role.toLowerCase()}
                                  {member.languageScopeCode ? ` (${member.languageScopeCode})` : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <UILabel htmlFor="task-create-due" className="text-xs text-zinc-500">Due (optional)</UILabel>
                          <Input
                            id="task-create-due"
                            type="datetime-local"
                            className="h-9 text-xs"
                            value={createForm.dueAt}
                            onChange={(event) => setCreateForm((form) => ({ ...form, dueAt: event.target.value }))}
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <UILabel htmlFor="task-create-notes" className="text-xs text-zinc-500">Notes (optional)</UILabel>
                        <Textarea
                          id="task-create-notes"
                          className="min-h-[60px] text-xs"
                          placeholder="Instructions for the assignee…"
                          value={createForm.notes}
                          onChange={(event) => setCreateForm((form) => ({ ...form, notes: event.target.value }))}
                        />
                      </div>
                      {createErrors?.form && <p className="text-xs text-red-600">{createErrors.form[0]}</p>}
                      <div className="flex items-center gap-2">
                        <Button size="sm" className="gap-2" onClick={() => void submitCreate()} disabled={creating || !pickedItemId || createForm.title.trim().length < 3}>
                          {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                          Create task
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setCreateOpen(false); setCreateErrors(null) }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Board list */}
              {boardError && (
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
                  {boardError}
                </p>
              )}
              {!board ? (
                <div className="space-y-2">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : board.tasks.length === 0 ? (
                <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
                  No tasks match this view. Submit content for review to open one (§19), or create a
                  work item above.
                </p>
              ) : (
                <ul className="space-y-2">
                  {board.tasks.map((task) => (
                    <li key={task.id} className="min-w-0 rounded-lg border border-zinc-200 bg-white p-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] font-normal ${statusStyle[task.status] ?? ''}`}>
                          {task.status.replace(/_/g, ' ').toLowerCase()}
                        </Badge>
                        <Badge variant="outline" className={`text-[10px] font-normal ${priorityStyle[task.priority] ?? ''}`}>
                          {task.priority.toLowerCase()}
                        </Badge>
                        <Badge variant="outline" className="border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700">
                          {TYPE_LABELS[task.type] ?? task.type}
                        </Badge>
                        {task.countryIso ? (
                          <Badge variant="secondary" className="text-[10px] font-normal">{task.countryIso}</Badge>
                        ) : (
                          <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                            global
                          </Badge>
                        )}
                        {task.language && (
                          <Badge variant="secondary" className="font-mono text-[10px] font-normal">
                            {task.language.code}
                          </Badge>
                        )}
                        <span className="ml-auto font-mono text-[10px] text-zinc-400">{task.objectLabel}</span>
                      </div>
                      <p className="mt-2 min-w-0 break-words text-sm font-semibold leading-snug">{task.title}</p>
                      {task.notes && (
                        <p className="mt-1 break-words text-xs text-zinc-500">{task.notes}</p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-500">
                        <span className="flex items-center gap-1">
                          <UserCheck className="h-3 w-3" aria-hidden="true" />
                          {task.assignee
                            ? task.assignee.name ?? task.assignee.email
                            : 'unassigned'}
                        </span>
                        {task.dueAt && (
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" aria-hidden="true" />
                            due {new Date(task.dueAt).toLocaleString()}
                          </span>
                        )}
                        {task.resolvedAt && task.resolvedBy && (
                          <span className="flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                            resolved by {task.resolvedBy}
                          </span>
                        )}
                      </div>
                      {task.resolutionNote && (
                        <p className="mt-1.5 rounded-md border border-zinc-100 bg-zinc-50 px-2 py-1.5 text-[11px] italic text-zinc-500">
                          {task.resolutionNote}
                        </p>
                      )}

                      {/* Actions — server-driven affordances (§20) */}
                      {(task.allowedActions.length > 0 || task.canManage) && (
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          {task.allowedActions.includes('claim') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              onClick={() => void runTaskAction(task, 'claim')}
                              disabled={busyAction !== null}
                            >
                              <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
                              Claim
                            </Button>
                          )}
                          {task.allowedActions.includes('start') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              onClick={() => void runTaskAction(task, 'start')}
                              disabled={busyAction !== null}
                            >
                              <PlayCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              Start
                            </Button>
                          )}
                          {task.allowedActions.includes('resolve') && resolvingId !== task.id && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 border-emerald-300 text-xs text-emerald-700 hover:bg-emerald-50"
                              onClick={() => {
                                setResolvingId(task.id)
                                setResolveNote('')
                              }}
                              disabled={busyAction !== null}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              Resolve
                            </Button>
                          )}
                          {task.allowedActions.includes('cancel') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-xs text-red-600 hover:bg-red-50"
                              onClick={() => void runTaskAction(task, 'cancel')}
                              disabled={busyAction !== null}
                            >
                              <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                              Cancel
                            </Button>
                          )}
                          {task.allowedActions.includes('reopen') && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 gap-1.5 text-xs"
                              onClick={() => void runTaskAction(task, 'reopen')}
                              disabled={busyAction !== null}
                            >
                              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              Reopen
                            </Button>
                          )}
                          {canPublish && staff && task.status !== 'RESOLVED' && task.status !== 'CANCELLED' && (
                            <Select
                              value={task.assignee?.id ?? 'unassigned'}
                              onValueChange={(value) => void reassign(task, value === 'unassigned' ? null : value)}
                            >
                              <SelectTrigger
                                className="ml-auto h-8 w-full max-w-[220px] text-xs"
                                aria-label={`Reassign ${task.title}`}
                              >
                                <SelectValue placeholder="Reassign…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="unassigned">Unassigned (unclaimed pool)</SelectItem>
                                {staff.map((member) => (
                                  <SelectItem key={member.id} value={member.id}>
                                    <span className="flex items-center gap-1">
                                      <Users className="h-3 w-3" aria-hidden="true" />
                                      {member.name ?? member.email} · {member.role.toLowerCase()}
                                      {member.languageScopeCode ? ` (${member.languageScopeCode})` : ''}
                                    </span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )}

                      {/* Resolve-with-note inline panel */}
                      {resolvingId === task.id && (
                        <div className="mt-2 space-y-1.5 rounded-md border border-emerald-200 bg-emerald-50/50 p-2">
                          <UILabel htmlFor={`resolve-note-${task.id}`} className="text-xs text-zinc-600">
                            Resolution note (optional — recorded on the task, §19)
                          </UILabel>
                          <Textarea
                            id={`resolve-note-${task.id}`}
                            className="min-h-[56px] text-xs"
                            placeholder="e.g. Verified against the ISRO record; claim stands."
                            value={resolveNote}
                            onChange={(event) => setResolveNote(event.target.value)}
                          />
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              className="h-8 gap-1.5 bg-emerald-600 text-xs text-white hover:bg-emerald-700"
                              onClick={() => void runTaskAction(task, 'resolve', resolveNote.trim())}
                              disabled={busyAction !== null}
                            >
                              {busyAction === `${task.id}:resolve` ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              Mark resolved
                            </Button>
                            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setResolvingId(null)}>
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Pagination */}
              {board && board.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>
                    Page {board.pagination.page} of {board.pagination.totalPages} · {board.pagination.total} tasks
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setPage((current) => Math.max(1, current - 1))}
                      disabled={page <= 1}
                    >
                      <CircleDot className="mr-1 h-3 w-3" aria-hidden="true" /> Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      onClick={() => setPage((current) => Math.min(board.pagination.totalPages, current + 1))}
                      disabled={page >= board.pagination.totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
