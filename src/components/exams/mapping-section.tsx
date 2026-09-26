'use client'

/**
 * GlobIQ — Exam Mapping section (P3-S3)
 *
 * Master Plan §6 (ExamMapping row), §8 (the requirement layer: relevance,
 * priority, required_depth, expected_scope, question_likelihood, source_basis,
 * effective_period, notes — "both exams point to the SAME Knowledge Unit"),
 * §11 (step 3: the tree expands into mapped units; the P3-S4 union engine
 * consumes this data), §12 (mappings keep flowing on the CURRENT version —
 * current affairs attach the moment they're mapped), §13 (SyllabusNode →
 * ExamMapping is the only exam→knowledge path), §14 (unit scope country-
 * guarded server-side), §16 (knowledge-page paths), §36 (staged/live editable,
 * superseded = history), §38 (editorial console + public app). This UI renders
 * server truth — every mutation is re-checked server-side (§20).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookMarked,
  CalendarRange,
  Link2,
  Loader2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Snowflake,
  Trash2,
  X,
  Zap,
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
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

// ---------- API envelope + DTO mirrors (§37 client-agnostic contract) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface AdminExamRef {
  id: string
  slug: string
  name: string
  code: string
  status: string
  countryIso: string
  countryName: string
}

interface VersionRef {
  id: string
  label: string
  effectiveFrom: string
  effectiveTo: string | null
  isCurrent: boolean
  isUpcoming: boolean
  nodeCount: number
  mappingCount: number
}

type Depth = 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
type Priority = 'CORE' | 'SUPPORTING' | 'LOW'
type Relevance = 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'
type Likelihood = 'HIGH' | 'MEDIUM' | 'LOW'
type Editability = 'staged' | 'live' | 'frozen' | 'locked'

const DEPTHS: Depth[] = ['ONE_LINE', 'FACT', 'CONCEPT', 'DETAILED', 'ANALYTICAL']
const PRIORITIES: Priority[] = ['CORE', 'SUPPORTING', 'LOW']
const RELEVANCES: Relevance[] = ['DIRECT', 'PARTIAL', 'CONTEXTUAL']
const LIKELIHOODS: Likelihood[] = ['HIGH', 'MEDIUM', 'LOW']

interface AdminMappingDto {
  id: string
  unit: {
    id: string
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    status: string
    topicSlug: string | null
  }
  relevance: Relevance
  priority: Priority
  requiredDepth: Depth
  questionLikelihood: Likelihood
  expectedScope: string | null
  sourceBasis: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  notes: string | null
}

interface AdminMappingNodeDto {
  id: string
  name: string
  depth: number
  priority: number
  topic: { slug: string; canonicalName: string } | null
  mappingCount: number
  mappings: AdminMappingDto[]
  children: AdminMappingNodeDto[]
}

interface AdminVersionMappingsDto {
  exam: {
    id: string
    slug: string
    name: string
    code: string
    status: string
    countryIso: string
    countryName: string
  }
  version: VersionRef
  editability: Editability
  editabilityReason: string
  mappingCount: number
  nodeCount: number
  tree: AdminMappingNodeDto[]
}

interface UnitMappingContextDto {
  examSlug: string
  examName: string
  examCode: string
  versionLabel: string
  versionIsCurrent: boolean
  nodeName: string
  requiredDepth: Depth
}

interface MappingUnitOptionDto {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  status: string
  topic: { slug: string; canonicalName: string } | null
  mappedOn: UnitMappingContextDto[]
}

interface PublicCoverageMappingDto {
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
  }
  canonicalPath: string
  requiredDepth: Depth
  priority: Priority
  relevance: Relevance
  expectedScope: string | null
  questionLikelihood: Likelihood
  effectiveFrom: string | null
  effectiveTo: string | null
}

interface PublicCoverageNodeDto {
  name: string
  depth: number
  priority: number
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  mappings: PublicCoverageMappingDto[]
  children: PublicCoverageNodeDto[]
}

interface PublicExamCoverageDto {
  exam: { slug: string; name: string; code: string }
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null; isCurrent: boolean } | null
  unitCount: number
  mappingCount: number
  nodes: PublicCoverageNodeDto[]
  language: { code: string; name: string; nativeName: string | null }
}

interface PublicExamRef {
  id: string
  slug: string
  name: string
  currentVersion: { id: string; label: string } | null
}

interface CountryRef {
  isoCode: string
  name: string
  status: string
  isDefault: boolean
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

// ---------- Presentation helpers ----------

const EDITABILITY_STYLE: Record<Editability, string> = {
  staged: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  live: 'bg-teal-50 text-teal-800 border-teal-200',
  frozen: 'bg-amber-50 text-amber-800 border-amber-200',
  locked: 'bg-rose-50 text-rose-800 border-rose-200',
}

const DEPTH_STYLE: Record<Depth, string> = {
  ONE_LINE: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  FACT: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CONCEPT: 'border-teal-200 bg-teal-50 text-teal-700',
  DETAILED: 'border-amber-200 bg-amber-50 text-amber-800',
  ANALYTICAL: 'border-rose-200 bg-rose-50 text-rose-700',
}

const DEPTH_LABEL: Record<Depth, string> = {
  ONE_LINE: 'One line',
  FACT: 'Fact',
  CONCEPT: 'Concept',
  DETAILED: 'Detailed',
  ANALYTICAL: 'Analytical',
}

const PRIORITY_STYLE: Record<Priority, string> = {
  CORE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  SUPPORTING: 'border-zinc-200 bg-white text-zinc-600',
  LOW: 'border-zinc-200 bg-zinc-50 text-zinc-400',
}

const LIKELIHOOD_LABEL: Record<Likelihood, string> = {
  HIGH: 'Often asked',
  MEDIUM: 'Sometimes asked',
  LOW: 'Rarely asked',
}

const fmtDay = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')

function DepthChip({ depth }: { depth: Depth }) {
  return (
    <Badge variant="outline" className={`shrink-0 text-[10px] font-medium ${DEPTH_STYLE[depth]}`}>
      {DEPTH_LABEL[depth]}
    </Badge>
  )
}

/** Flattens the mapping tree for the node select (depth for indentation). */
function flattenNodes(
  nodes: AdminMappingNodeDto[],
  depth = 0,
  out: Array<{ node: AdminMappingNodeDto; depth: number }> = []
): Array<{ node: AdminMappingNodeDto; depth: number }> {
  for (const node of nodes) {
    out.push({ node, depth })
    flattenNodes(node.children, depth + 1, out)
  }
  return out
}

// ---------- Component ----------

export function MappingSection() {
  const { toast } = useToast()
  const token = useAuth((state) => state.token)
  const permissions = useAuth((state) => state.permissions)
  const canManage = permissions.includes('exam:manage')

  const authHeaders = useCallback(
    (json = false): HeadersInit => ({
      ...(json ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token]
  )

  // ---------- Console state ----------
  const [exams, setExams] = useState<AdminExamRef[]>([])
  const [examId, setExamId] = useState<string>('')
  const [versions, setVersions] = useState<VersionRef[]>([])
  const [versionId, setVersionId] = useState<string>('')
  const [view, setView] = useState<AdminVersionMappingsDto | null>(null)
  const [viewLoading, setViewLoading] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string>('')

  // Unit search (picker)
  const [unitQuery, setUnitQuery] = useState('')
  const [unitResults, setUnitResults] = useState<MappingUnitOptionDto[]>([])
  const [unitSearching, setUnitSearching] = useState(false)
  const [pickedUnit, setPickedUnit] = useState<MappingUnitOptionDto | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Add-mapping form
  const [addNodeId, setAddNodeId] = useState<string>('')
  const [addDepth, setAddDepth] = useState<Depth>('CONCEPT')
  const [addPriority, setAddPriority] = useState<Priority>('SUPPORTING')
  const [addRelevance, setAddRelevance] = useState<Relevance>('DIRECT')
  const [addLikelihood, setAddLikelihood] = useState<Likelihood>('MEDIUM')
  const [addScope, setAddScope] = useState('')
  const [addBasis, setAddBasis] = useState('')
  const [addFrom, setAddFrom] = useState('')
  const [addUntil, setAddUntil] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Inline edit form
  const [editId, setEditId] = useState<string | null>(null)
  const [editDepth, setEditDepth] = useState<Depth>('CONCEPT')
  const [editPriority, setEditPriority] = useState<Priority>('SUPPORTING')
  const [editLikelihood, setEditLikelihood] = useState<Likelihood>('MEDIUM')
  const [editScope, setEditScope] = useState('')
  const [editBasis, setEditBasis] = useState('')
  const [editFrom, setEditFrom] = useState('')
  const [editUntil, setEditUntil] = useState('')
  const [editNotes, setEditNotes] = useState('')

  // ---------- Public state ----------
  const [countries, setCountries] = useState<CountryRef[]>([])
  const [publicCountry, setPublicCountry] = useState('IN')
  const [publicLanguage, setPublicLanguage] = useState('en')
  const [publicExams, setPublicExams] = useState<PublicExamRef[]>([])
  const [publicSlug, setPublicSlug] = useState('')
  const [coverage, setCoverage] = useState<PublicExamCoverageDto | null>(null)
  const [publicLoading, setPublicLoading] = useState(false)

  const selectedExam = exams.find((exam) => exam.id === examId)
  const selectedNode = useMemo(() => {
    if (!view) return null
    return flattenNodes(view.tree).find((entry) => entry.node.id === selectedNodeId)?.node ?? null
  }, [view, selectedNodeId])
  const writable = view?.editability === 'staged' || view?.editability === 'live'
  const flatNodes = useMemo(() => (view ? flattenNodes(view.tree) : []), [view])

  // ---------- Console data loading ----------

  const loadExams = useCallback(async () => {
    if (!token || !canManage) return
    try {
      const response = await fetch('/api/exams/admin/exams?pageSize=100', {
        headers: authHeaders(),
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ exams: AdminExamRef[] }>
      if (payload.status === 'ok' && payload.data) {
        setExams(payload.data.exams)
        setExamId((current) =>
          current && payload.data!.exams.some((exam) => exam.id === current)
            ? current
            : payload.data!.exams[0]?.id ?? ''
        )
      }
    } catch {
      toast({ title: 'Network error while loading exams', variant: 'destructive' })
    }
  }, [token, canManage, authHeaders, toast])

  useEffect(() => {
    void loadExams()
  }, [loadExams])

  // Exam detail → versions (default to the CURRENT version — where live mapping happens).
  useEffect(() => {
    if (!token || !examId) {
      setVersions([])
      setVersionId('')
      return
    }
    let cancelled = false
    fetch(`/api/exams/admin/exams/${examId}`, { headers: authHeaders(), cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ exam?: { versions?: VersionRef[] } }>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data?.exam?.versions) {
          const list = payload.data.exam.versions
          setVersions(list)
          const current = list.find((version) => version.isCurrent) ?? list[0]
          setVersionId(current?.id ?? '')
        } else {
          setVersions([])
          setVersionId('')
        }
      })
      .catch(() => {
        if (!cancelled) toast({ title: 'Could not load exam versions', variant: 'destructive' })
      })
    return () => {
      cancelled = true
    }
  }, [token, examId, authHeaders, toast])

  const loadView = useCallback(async () => {
    if (!token || !examId || !versionId) {
      setView(null)
      return
    }
    setViewLoading(true)
    try {
      const response = await fetch(
        `/api/exams/admin/exams/${examId}/versions/${versionId}/mappings`,
        { headers: authHeaders(), cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ mappings: AdminVersionMappingsDto }>
      if (payload.status === 'ok' && payload.data) setView(payload.data.mappings)
      else {
        setView(null)
        toast({
          title: 'Could not load the exam mappings',
          description: payload.error?.message,
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setViewLoading(false)
    }
  }, [token, examId, versionId, authHeaders, toast])

  useEffect(() => {
    setEditId(null)
    setPickedUnit(null)
    setUnitResults([])
    setSelectedNodeId('')
    void loadView()
  }, [loadView])

  // ---------- Unit search (debounced, §14 country-guarded server-side) ----------

  const runUnitSearch = useCallback(
    async (q: string) => {
      if (!token || !examId || !versionId || q.trim().length < 2) {
        setUnitResults([])
        return
      }
      setUnitSearching(true)
      try {
        const params = new URLSearchParams({ q: q.trim() })
        const response = await fetch(
          `/api/exams/admin/exams/${examId}/versions/${versionId}/mappings/units?${params.toString()}`,
          { headers: authHeaders(), cache: 'no-store' }
        )
        const payload = (await response.json()) as Envelope<{ units: MappingUnitOptionDto[] }>
        if (payload.status === 'ok' && payload.data) setUnitResults(payload.data.units)
        else setUnitResults([])
      } catch {
        setUnitResults([])
      } finally {
        setUnitSearching(false)
      }
    },
    [token, examId, versionId, authHeaders]
  )

  const onUnitQueryChange = (value: string) => {
    setUnitQuery(value)
    setPickedUnit(null)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => void runUnitSearch(value), 350)
  }

  // ---------- Console mutations ----------

  const mutate = useCallback(
    async (url: string, init: RequestInit, successMessage: string) => {
      setSaving(true)
      try {
        const response = await fetch(url, { headers: authHeaders(true), cache: 'no-store', ...init })
        const payload = (await response.json()) as Envelope<{ mappings: AdminVersionMappingsDto }>
        if (payload.status === 'ok' && payload.data) {
          setView(payload.data.mappings)
          toast({ title: successMessage })
          return true
        }
        toast({ title: 'Operation failed', description: payload.error?.message, variant: 'destructive' })
        return false
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
        return false
      } finally {
        setSaving(false)
      }
    },
    [authHeaders, toast]
  )

  const resetAddForm = () => {
    setPickedUnit(null)
    setUnitQuery('')
    setUnitResults([])
    setAddScope('')
    setAddBasis('')
    setAddFrom('')
    setAddUntil('')
    setAddNotes('')
    setAddDepth('CONCEPT')
    setAddPriority('SUPPORTING')
    setAddRelevance('DIRECT')
    setAddLikelihood('MEDIUM')
  }

  const submitAdd = async () => {
    if (!examId || !versionId || !pickedUnit || !addNodeId) return
    const ok = await mutate(
      `/api/exams/admin/exams/${examId}/versions/${versionId}/mappings`,
      {
        method: 'POST',
        body: JSON.stringify({
          unitRef: pickedUnit.id,
          nodeId: addNodeId,
          relevance: addRelevance,
          priority: addPriority,
          requiredDepth: addDepth,
          questionLikelihood: addLikelihood,
          expectedScope: addScope.trim() || null,
          sourceBasis: addBasis.trim() || null,
          effectiveFrom: addFrom ? new Date(addFrom).toISOString() : null,
          effectiveTo: addUntil ? new Date(addUntil).toISOString() : null,
          notes: addNotes.trim() || null,
        }),
      },
      'Knowledge unit mapped'
    )
    if (ok) {
      resetAddForm()
      setSelectedNodeId(addNodeId)
    }
  }

  const startEdit = (mapping: AdminMappingDto) => {
    setEditId(mapping.id)
    setEditDepth(mapping.requiredDepth)
    setEditPriority(mapping.priority)
    setEditLikelihood(mapping.questionLikelihood)
    setEditScope(mapping.expectedScope ?? '')
    setEditBasis(mapping.sourceBasis ?? '')
    setEditFrom(mapping.effectiveFrom ? mapping.effectiveFrom.slice(0, 10) : '')
    setEditUntil(mapping.effectiveTo ? mapping.effectiveTo.slice(0, 10) : '')
    setEditNotes(mapping.notes ?? '')
  }

  const submitEdit = async (mapping: AdminMappingDto) => {
    if (!examId || !versionId) return
    const ok = await mutate(
      `/api/exams/admin/exams/${examId}/versions/${versionId}/mappings/${mapping.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          relevance: mapping.relevance, // anchors + relevance unchanged (kept explicit)
          priority: editPriority,
          requiredDepth: editDepth,
          questionLikelihood: editLikelihood,
          expectedScope: editScope.trim() || null,
          sourceBasis: editBasis.trim() || null,
          effectiveFrom: editFrom ? new Date(editFrom).toISOString() : null,
          effectiveTo: editUntil ? new Date(editUntil).toISOString() : null,
          notes: editNotes.trim() || null,
        }),
      },
      'Mapping updated'
    )
    if (ok) setEditId(null)
  }

  const removeMapping = async (mapping: AdminMappingDto) => {
    if (!examId || !versionId) return
    await mutate(
      `/api/exams/admin/exams/${examId}/versions/${versionId}/mappings/${mapping.id}`,
      { method: 'DELETE' },
      'Mapping removed'
    )
  }

  // ---------- Public data loading ----------

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: CountryRef[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          const active = payload.data.countries.filter((country) => country.status === 'ACTIVE')
          setCountries(active)
          if (!active.some((country) => country.isoCode === publicCountry)) {
            setPublicCountry(active[0]?.isoCode ?? 'IN')
          }
        }
      })
      .catch(() => undefined)
  }, [])

  const selectedCountry = countries.find((country) => country.isoCode === publicCountry)

  useEffect(() => {
    if (!selectedCountry) return
    setPublicLanguage(selectedCountry.defaultLanguage.code)
    let cancelled = false
    fetch(`/api/exams?country=${publicCountry}&pageSize=50`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ exams: PublicExamRef[] }>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setPublicExams(payload.data.exams)
          setPublicSlug((current) =>
            current && payload.data!.exams.some((exam) => exam.slug === current)
              ? current
              : payload.data!.exams[0]?.slug ?? ''
          )
        } else {
          setPublicExams([])
          setPublicSlug('')
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [publicCountry, selectedCountry])

  useEffect(() => {
    if (!publicSlug || !selectedCountry) {
      setCoverage(null)
      return
    }
    let cancelled = false
    setPublicLoading(true)
    const params = new URLSearchParams({ country: publicCountry, language: publicLanguage })
    fetch(`/api/exams/${publicSlug}/coverage?${params.toString()}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ coverage: PublicExamCoverageDto }>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) setCoverage(payload.data.coverage)
        else setCoverage(null)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPublicLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [publicSlug, publicCountry, publicLanguage, selectedCountry])

  // ---------- Render helpers (console tree) ----------

  const renderConsoleNode = (node: AdminMappingNodeDto): React.ReactNode => {
    const selected = selectedNodeId === node.id
    return (
      <li key={node.id} className="list-none">
        <button
          type="button"
          onClick={() => {
            setSelectedNodeId(node.id)
            setAddNodeId(node.id)
          }}
          className={`my-0.5 flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
            selected ? 'bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200' : 'hover:bg-zinc-50'
          }`}
          aria-pressed={selected}
        >
          <span
            className="min-w-0 flex-1 truncate"
            style={{ paddingLeft: `${node.depth * 14}px` }}
            title={node.name}
          >
            {node.name}
          </span>
          {node.topic ? (
            <Badge variant="outline" className="hidden shrink-0 max-w-[130px] border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700 sm:inline-flex">
              <span className="truncate">{node.topic.canonicalName}</span>
            </Badge>
          ) : null}
          {node.mappingCount > 0 ? (
            <Badge className="shrink-0 bg-emerald-600 text-[10px] hover:bg-emerald-600">
              {node.mappingCount} mapped
            </Badge>
          ) : null}
        </button>
        {node.children.length > 0 ? <ul>{node.children.map(renderConsoleNode)}</ul> : null}
      </li>
    )
  }

  // ---------- Render helpers (public coverage tree) ----------

  const renderPublicNode = (node: PublicCoverageNodeDto): React.ReactNode => (
    <li key={`${node.name}-${node.depth}-${node.priority}`} className="list-none">
      <div className="my-1 rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="min-w-0 flex-1 text-sm font-medium text-zinc-900"
            style={{ paddingLeft: `${node.depth * 10}px` }}
          >
            {node.name}
          </span>
          {node.topic ? (
            <Badge variant="outline" className="shrink-0 border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700">
              {node.topic.label}
            </Badge>
          ) : null}
        </div>
        {node.mappings.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {node.mappings.map((mapping) => (
              <li
                key={`${node.name}-${mapping.unit.slug}`}
                className="rounded-md border border-zinc-100 bg-zinc-50/60 p-2.5"
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-0 flex-1 text-sm font-medium text-zinc-800">
                    {mapping.unit.canonicalName}
                  </span>
                  <DepthChip depth={mapping.requiredDepth} />
                  <Badge variant="outline" className={`shrink-0 text-[10px] ${PRIORITY_STYLE[mapping.priority]}`}>
                    {mapping.priority.toLowerCase()}
                  </Badge>
                  {mapping.questionLikelihood === 'HIGH' ? (
                    <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                      <Zap className="mr-1 h-3 w-3" aria-hidden="true" />
                      {LIKELIHOOD_LABEL[mapping.questionLikelihood]}
                    </Badge>
                  ) : null}
                </div>
                {mapping.unit.canonicalSummary ? (
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{mapping.unit.canonicalSummary}</p>
                ) : null}
                {mapping.expectedScope ? (
                  <p className="mt-1 text-xs leading-relaxed text-zinc-600">
                    <span className="font-medium text-zinc-700">Scope:</span> {mapping.expectedScope}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <code className="truncate">{mapping.canonicalPath}</code>
                  </span>
                  {mapping.effectiveFrom || mapping.effectiveTo ? (
                    <span className="inline-flex items-center gap-1">
                      <CalendarRange className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {fmtDay(mapping.effectiveFrom) || '…'} → {fmtDay(mapping.effectiveTo) || 'open'}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {node.children.length > 0 ? <ul>{node.children.map(renderPublicNode)}</ul> : null}
    </li>
  )

  // ---------- Component render ----------

  return (
    <Card className="scroll-mt-20 border-zinc-200 shadow-sm" id="mappings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Network className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Exam mappings — the §8 requirement layer (P3-S3)
        </CardTitle>
        <CardDescription>
          The same canonical KnowledgeUnit maps to many exams at different depths — a relationship,
          never copied content. Mappings anchor on version-pinned syllabus nodes (§13) and keep
          flowing on the current version (§12); superseded windows are §36 history.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={canManage ? 'console' : 'public'}>
          <TabsList className="mb-3 flex w-full max-w-md">
            {canManage ? <TabsTrigger value="console" className="flex-1">Editorial console</TabsTrigger> : null}
            <TabsTrigger value="public" className="flex-1">Public coverage</TabsTrigger>
          </TabsList>

          {/* ---------- Editorial console ---------- */}
          {canManage ? (
            <TabsContent value="console" className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <UILabel className="text-xs font-medium text-zinc-500">Exam (§14 country-scoped)</UILabel>
                  <Select value={examId} onValueChange={setExamId} disabled={exams.length === 0}>
                    <SelectTrigger aria-label="Exam" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                      <SelectValue placeholder={exams.length === 0 ? 'No exams visible' : 'Pick an exam'} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                      {exams.map((exam) => (
                        <SelectItem key={exam.id} value={exam.id} className="max-w-full">
                          <span className="min-w-0 truncate">
                            {exam.name} · {exam.countryIso} ({exam.status})
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <UILabel className="text-xs font-medium text-zinc-500">Exam version (§36 window)</UILabel>
                  <Select value={versionId} onValueChange={setVersionId} disabled={versions.length === 0}>
                    <SelectTrigger aria-label="Exam version" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                      <SelectValue placeholder={versions.length === 0 ? 'No versions yet' : 'Pick a version'} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                      {versions.map((version) => (
                        <SelectItem key={version.id} value={version.id} className="max-w-full">
                          <span className="min-w-0 truncate">
                            {version.label} · {version.nodeCount} nodes · {version.mappingCount} mapped
                            {version.isCurrent ? ' · CURRENT' : version.isUpcoming ? ' · UPCOMING' : ''}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {viewLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-24 w-4/5" />
                  <Skeleton className="h-24 w-3/5" />
                </div>
              ) : view ? (
                <>
                  {/* Editability banner (§36 mapping rule) */}
                  <div
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${EDITABILITY_STYLE[view.editability]}`}
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {view.editability === 'frozen' ? <Snowflake className="h-4 w-4" aria-hidden="true" /> : null}
                      {view.editability === 'staged'
                        ? 'Staged — tree + mappings editable'
                        : view.editability === 'live'
                          ? 'Live — tree frozen, mappings editable (§12)'
                          : view.editability === 'frozen'
                            ? 'Superseded — mappings are history (§36)'
                            : 'Retired — read-only'}
                    </span>
                    <span className="text-xs opacity-80">
                      {view.exam.name} · {view.version.label} · {view.mappingCount} mapping
                      {view.mappingCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400">{view.editabilityReason}</p>

                  {/* Node tree — pick a node to manage its mappings */}
                  <div
                    className="max-h-72 overflow-y-auto globiq-scroll rounded-lg border border-zinc-200 bg-white p-2"
                    role="tree"
                    aria-label="Syllabus nodes"
                  >
                    {view.tree.length === 0 ? (
                      <p className="p-4 text-sm text-zinc-500">
                        This version has no syllabus nodes yet — build the tree in the Syllabus console
                        above before mapping knowledge.
                      </p>
                    ) : (
                      <ul>{view.tree.map(renderConsoleNode)}</ul>
                    )}
                  </div>

                  {/* Selected node's mappings */}
                  {selectedNode ? (
                    <>
                      <Separator />
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <BookMarked className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-zinc-900">
                            {selectedNode.name}
                          </p>
                          <Badge variant="secondary" className="font-normal">
                            {selectedNode.mappings.length} mapped
                          </Badge>
                        </div>
                        {selectedNode.mappings.length === 0 ? (
                          <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-500">
                            No knowledge units mapped to this node yet.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {selectedNode.mappings.map((mapping) => {
                              const editing = editId === mapping.id
                              return (
                                <li key={mapping.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="min-w-0 flex-1 text-sm font-medium text-zinc-900">
                                      {mapping.unit.canonicalName}
                                    </span>
                                    <DepthChip depth={mapping.requiredDepth} />
                                    <Badge variant="outline" className={`shrink-0 text-[10px] ${PRIORITY_STYLE[mapping.priority]}`}>
                                      {mapping.priority.toLowerCase()}
                                    </Badge>
                                    <Badge variant="outline" className="shrink-0 border-zinc-200 bg-white text-[10px] text-zinc-500">
                                      {mapping.relevance.toLowerCase()}
                                    </Badge>
                                    <Badge variant="outline" className="shrink-0 border-zinc-200 bg-white text-[10px] text-zinc-500">
                                      {LIKELIHOOD_LABEL[mapping.questionLikelihood]}
                                    </Badge>
                                    {mapping.unit.status !== 'VERIFIED' ? (
                                      <Badge variant="outline" className="shrink-0 border-amber-200 bg-amber-50 text-[10px] text-amber-800">
                                        {mapping.unit.status} (hidden publicly)
                                      </Badge>
                                    ) : null}
                                  </div>
                                  {mapping.expectedScope || mapping.sourceBasis || mapping.effectiveFrom || mapping.effectiveTo || mapping.notes ? (
                                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs text-zinc-600 sm:grid-cols-2">
                                      {mapping.expectedScope ? (
                                        <div className="sm:col-span-2">
                                          <dt className="inline font-medium text-zinc-700">Scope: </dt>
                                          <dd className="inline">{mapping.expectedScope}</dd>
                                        </div>
                                      ) : null}
                                      {mapping.sourceBasis ? (
                                        <div className="sm:col-span-2">
                                          <dt className="inline font-medium text-zinc-700">Basis: </dt>
                                          <dd className="inline">{mapping.sourceBasis}</dd>
                                        </div>
                                      ) : null}
                                      {mapping.effectiveFrom || mapping.effectiveTo ? (
                                        <div>
                                          <dt className="inline font-medium text-zinc-700">Valid: </dt>
                                          <dd className="inline">
                                            {fmtDay(mapping.effectiveFrom) || '…'} → {fmtDay(mapping.effectiveTo) || 'open'}
                                          </dd>
                                        </div>
                                      ) : null}
                                      {mapping.notes ? (
                                        <div className="sm:col-span-2">
                                          <dt className="inline font-medium text-zinc-700">Notes: </dt>
                                          <dd className="inline">{mapping.notes}</dd>
                                        </div>
                                      ) : null}
                                    </dl>
                                  ) : null}
                                  {writable ? (
                                    <div className="mt-2 flex justify-end gap-2">
                                      <Button size="sm" variant="ghost" onClick={() => startEdit(mapping)}>
                                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit
                                      </Button>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="text-rose-600 hover:text-rose-700"
                                        onClick={() => void removeMapping(mapping)}
                                        disabled={saving}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
                                      </Button>
                                    </div>
                                  ) : null}

                                  {editing ? (
                                    <div className="mt-3 space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Required depth (§8)</UILabel>
                                          <Select value={editDepth} onValueChange={(value) => setEditDepth(value as Depth)}>
                                            <SelectTrigger aria-label="Required depth" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                              {DEPTHS.map((depth) => (
                                                <SelectItem key={depth} value={depth}>
                                                  {DEPTH_LABEL[depth]}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Priority</UILabel>
                                          <Select value={editPriority} onValueChange={(value) => setEditPriority(value as Priority)}>
                                            <SelectTrigger aria-label="Priority" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                              {PRIORITIES.map((priority) => (
                                                <SelectItem key={priority} value={priority}>
                                                  {priority.toLowerCase()}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Question likelihood</UILabel>
                                          <Select value={editLikelihood} onValueChange={(value) => setEditLikelihood(value as Likelihood)}>
                                            <SelectTrigger aria-label="Question likelihood" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                              <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                              {LIKELIHOODS.map((likelihood) => (
                                                <SelectItem key={likelihood} value={likelihood}>
                                                  {LIKELIHOOD_LABEL[likelihood]}
                                                </SelectItem>
                                              ))}
                                            </SelectContent>
                                          </Select>
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Expected scope</UILabel>
                                          <Input value={editScope} onChange={(event) => setEditScope(event.target.value)} maxLength={500} aria-label="Expected scope" />
                                        </div>
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Source basis (why this mapping exists)</UILabel>
                                          <Input value={editBasis} onChange={(event) => setEditBasis(event.target.value)} maxLength={500} aria-label="Source basis" />
                                        </div>
                                      </div>
                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Valid from (optional)</UILabel>
                                          <Input type="date" value={editFrom} onChange={(event) => setEditFrom(event.target.value)} aria-label="Valid from" />
                                        </div>
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Valid until (optional)</UILabel>
                                          <Input type="date" value={editUntil} onChange={(event) => setEditUntil(event.target.value)} aria-label="Valid until" />
                                        </div>
                                        <div className="space-y-1">
                                          <UILabel className="text-xs text-zinc-500">Notes</UILabel>
                                          <Input value={editNotes} onChange={(event) => setEditNotes(event.target.value)} maxLength={2000} aria-label="Editorial notes" />
                                        </div>
                                      </div>
                                      <div className="flex justify-end gap-2">
                                        <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                                          <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                                        </Button>
                                        <Button size="sm" onClick={() => void submitEdit(mapping)} disabled={saving}>
                                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />} Save
                                        </Button>
                                      </div>
                                    </div>
                                  ) : null}
                                </li>
                              )
                            })}
                          </ul>
                        )}
                      </div>
                    </>
                  ) : null}

                  {/* Add-mapping form (staged/live only) */}
                  {writable && view.tree.length > 0 ? (
                    <>
                      <Separator />
                      <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                          <Plus className="h-4 w-4" aria-hidden="true" />
                          Map a knowledge unit (§8)
                        </div>

                        {/* Step 1: unit search */}
                        <div className="space-y-1.5">
                          <UILabel className="text-xs text-zinc-500">
                            Knowledge unit (GLOBAL or {view.exam.countryName}&apos;s — §14)
                          </UILabel>
                          {pickedUnit ? (
                            <div className="flex items-start justify-between gap-2 rounded-md border border-emerald-300 bg-white p-2.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-zinc-900">{pickedUnit.canonicalName}</p>
                                <p className="text-xs text-zinc-500">
                                  {pickedUnit.type.toLowerCase()} · {pickedUnit.difficulty.toLowerCase()}
                                  {pickedUnit.topic ? ` · ${pickedUnit.topic.canonicalName}` : ''}
                                  {pickedUnit.status !== 'VERIFIED' ? ` · ${pickedUnit.status} (hidden publicly until verified)` : ''}
                                </p>
                                {pickedUnit.mappedOn.length > 0 ? (
                                  <div className="mt-1.5 space-y-0.5">
                                    <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-400">
                                      Already mapped at
                                    </p>
                                    {pickedUnit.mappedOn.slice(0, 4).map((context) => (
                                      <p key={`${context.examSlug}-${context.versionLabel}-${context.nodeName}`} className="text-[11px] text-zinc-500">
                                        {context.examCode} · {context.nodeName} —{' '}
                                        <span className="font-medium text-zinc-700">{DEPTH_LABEL[context.requiredDepth]}</span>
                                        {context.versionIsCurrent ? ' (current)' : ' (older version)'}
                                      </p>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                              <Button size="sm" variant="ghost" onClick={resetAddForm} aria-label="Pick a different unit">
                                <X className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </div>
                          ) : (
                            <>
                              <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
                                <Input
                                  value={unitQuery}
                                  onChange={(event) => onUnitQueryChange(event.target.value)}
                                  placeholder="Search canonical units by name (min 2 characters)…"
                                  className="pl-8"
                                  maxLength={200}
                                  aria-label="Search knowledge units"
                                />
                                {unitSearching ? (
                                  <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-zinc-400" aria-hidden="true" />
                                ) : null}
                              </div>
                              {unitQuery.trim().length >= 2 ? (
                                <div className="max-h-48 overflow-y-auto globiq-scroll rounded-md border border-zinc-200 bg-white">
                                  {unitResults.length === 0 ? (
                                    <p className="p-3 text-sm text-zinc-500">
                                      No country-visible units match &quot;{unitQuery.trim()}&quot;.
                                    </p>
                                  ) : (
                                    unitResults.map((unit) => (
                                      <button
                                        key={unit.id}
                                        type="button"
                                        onClick={() => {
                                          setPickedUnit(unit)
                                          if (!addNodeId && selectedNodeId) setAddNodeId(selectedNodeId)
                                        }}
                                        className="block w-full border-b border-zinc-100 p-2.5 text-left last:border-b-0 hover:bg-emerald-50/60"
                                      >
                                        <span className="block truncate text-sm font-medium text-zinc-900">
                                          {unit.canonicalName}
                                        </span>
                                        <span className="block truncate text-xs text-zinc-500">
                                          {unit.type.toLowerCase()} · {unit.difficulty.toLowerCase()}
                                          {unit.mappedOn.length > 0
                                            ? ` · already mapped to ${unit.mappedOn.length} node${unit.mappedOn.length === 1 ? '' : 's'}`
                                            : ''}
                                        </span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>

                        {/* Step 2: node + §8 fields */}
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Syllabus node (§13 anchor)</UILabel>
                            <Select value={addNodeId} onValueChange={setAddNodeId}>
                              <SelectTrigger aria-label="Syllabus node" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                <SelectValue placeholder="Pick a node" />
                              </SelectTrigger>
                              <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                {flatNodes.map(({ node, depth }) => (
                                  <SelectItem key={node.id} value={node.id} className="max-w-full">
                                    <span className="min-w-0 truncate">{'· '.repeat(depth)}{node.name}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Required depth (§8)</UILabel>
                            <Select value={addDepth} onValueChange={(value) => setAddDepth(value as Depth)}>
                              <SelectTrigger aria-label="Required depth" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                {DEPTHS.map((depth) => (
                                  <SelectItem key={depth} value={depth}>
                                    {DEPTH_LABEL[depth]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Priority</UILabel>
                            <Select value={addPriority} onValueChange={(value) => setAddPriority(value as Priority)}>
                              <SelectTrigger aria-label="Priority" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                {PRIORITIES.map((priority) => (
                                  <SelectItem key={priority} value={priority}>
                                    {priority.toLowerCase()}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Relevance</UILabel>
                            <Select value={addRelevance} onValueChange={(value) => setAddRelevance(value as Relevance)}>
                              <SelectTrigger aria-label="Relevance" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                {RELEVANCES.map((relevance) => (
                                  <SelectItem key={relevance} value={relevance}>
                                    {relevance.toLowerCase()}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Question likelihood</UILabel>
                            <Select value={addLikelihood} onValueChange={(value) => setAddLikelihood(value as Likelihood)}>
                              <SelectTrigger aria-label="Question likelihood" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                {LIKELIHOODS.map((likelihood) => (
                                  <SelectItem key={likelihood} value={likelihood}>
                                    {LIKELIHOOD_LABEL[likelihood]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Expected scope (what portion matters)</UILabel>
                            <Input value={addScope} onChange={(event) => setAddScope(event.target.value)} maxLength={500} aria-label="Expected scope" placeholder="e.g. Article numbers and the six rights by name" />
                          </div>
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Source basis (why this mapping exists)</UILabel>
                            <Input value={addBasis} onChange={(event) => setAddBasis(event.target.value)} maxLength={500} aria-label="Source basis" placeholder="e.g. Named in the official notification §3" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Valid from (optional)</UILabel>
                            <Input type="date" value={addFrom} onChange={(event) => setAddFrom(event.target.value)} aria-label="Valid from" />
                          </div>
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Valid until (optional)</UILabel>
                            <Input type="date" value={addUntil} onChange={(event) => setAddUntil(event.target.value)} aria-label="Valid until" />
                          </div>
                          <div className="space-y-1">
                            <UILabel className="text-xs text-zinc-500">Notes</UILabel>
                            <Input value={addNotes} onChange={(event) => setAddNotes(event.target.value)} maxLength={2000} aria-label="Editorial notes" />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="ghost" onClick={resetAddForm}>
                            <X className="h-3.5 w-3.5" aria-hidden="true" /> Clear
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => void submitAdd()}
                            disabled={saving || !pickedUnit || !addNodeId}
                          >
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />} Map unit
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : null}

                  {!writable && view.mappingCount > 0 ? (
                    <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      This version&apos;s {view.mappingCount} mapping{view.mappingCount === 1 ? '' : 's'} are §36
                      history — read-only. Corrections belong to the next ExamVersion.
                    </p>
                  ) : null}
                </>
              ) : versions.length === 0 && selectedExam ? (
                <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                  This exam has no versions yet — create one in the Exams console first.
                </p>
              ) : null}
            </TabsContent>
          ) : null}

          {/* ---------- Public coverage ---------- */}
          <TabsContent value="public" className="space-y-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="space-y-1.5">
                <UILabel className="text-xs font-medium text-zinc-500">Country (§14)</UILabel>
                <Select value={publicCountry} onValueChange={setPublicCountry} disabled={countries.length === 0}>
                  <SelectTrigger aria-label="Country" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                    <SelectValue placeholder="Pick a country" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                    {countries.map((country) => (
                      <SelectItem key={country.isoCode} value={country.isoCode} className="max-w-full">
                        <span className="min-w-0 truncate">{country.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <UILabel className="text-xs font-medium text-zinc-500">Language (§35)</UILabel>
                <Select value={publicLanguage} onValueChange={setPublicLanguage}>
                  <SelectTrigger aria-label="Language" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                    <SelectValue placeholder="Pick a language" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                    {(selectedCountry?.languages ?? []).map((language) => (
                      <SelectItem key={language.code} value={language.code} className="max-w-full">
                        <span className="min-w-0 truncate">
                          {language.name}
                          {selectedCountry && language.code === selectedCountry.defaultLanguage.code ? ' (default)' : ''}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <UILabel className="text-xs font-medium text-zinc-500">Exam</UILabel>
                <Select value={publicSlug} onValueChange={setPublicSlug} disabled={publicExams.length === 0}>
                  <SelectTrigger aria-label="Exam" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                    <SelectValue placeholder={publicExams.length === 0 ? 'No active exams' : 'Pick an exam'} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                    {publicExams.map((exam) => (
                      <SelectItem key={exam.slug} value={exam.slug} className="max-w-full">
                        <span className="min-w-0 truncate">{exam.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {publicLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-24 w-4/5" />
                <Skeleton className="h-24 w-3/5" />
              </div>
            ) : coverage ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm">
                  <span className="min-w-0 truncate font-medium text-zinc-900">
                    {coverage.exam.name}
                    {coverage.version ? ` · ${coverage.version.label}` : ''}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-zinc-500">
                    <Badge variant="secondary" className="font-normal">
                      {coverage.unitCount} unit{coverage.unitCount === 1 ? '' : 's'}
                    </Badge>
                    <Badge variant="secondary" className="font-normal">
                      {coverage.mappingCount} mapping{coverage.mappingCount === 1 ? '' : 's'}
                    </Badge>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </div>

                {coverage.nodes.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                    {coverage.version
                      ? 'No mapped knowledge units published for this syllabus yet — coverage appears as editors map verified units (§8).'
                      : 'This exam has no syllabus version in effect yet.'}
                  </p>
                ) : (
                  <div className="max-h-96 overflow-y-auto globiq-scroll rounded-lg border border-zinc-100 bg-zinc-50/50 p-2">
                    <ul>{coverage.nodes.map(renderPublicNode)}</ul>
                  </div>
                )}
                <p className="text-[11px] text-zinc-400">
                  Depth badges show each exam&apos;s required depth for the same canonical unit (§8) —
                  &quot;question likelihood&quot; is editorial metadata, not a guarantee. The §11 combined view
                  (P3-S4) will deduplicate these units across followed exams.
                </p>
              </>
            ) : publicSlug ? (
              <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                Coverage unavailable for this exam.
              </p>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                No active exams in this country yet.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
