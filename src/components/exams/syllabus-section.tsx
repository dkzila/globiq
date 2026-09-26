'use client'

/**
 * GlobIQ — SyllabusNode trees section (P3-S2)
 *
 * Master Plan §6 (SyllabusNode row), §11 (the tree the combination engine
 * expands via ExamMapping in P3-S3), §13 (topic links are the ONLY exam →
 * taxonomy bridge — exam wording never enters the taxonomy), §16 (syllabus
 * topic paths shipped as data), §36 (version-pinned trees: staged → frozen
 * once the version enters history; changes create a NEW ExamVersion), §38
 * (editorial console + public app surface). This UI renders server truth —
 * every mutation is re-checked server-side (§20).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BookMarked,
  ChevronRight,
  FilePlus2,
  Languages,
  Link2,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Snowflake,
  Trash2,
  TreePine,
  X,
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
}

interface AdminExamDetail {
  exam?: {
    versions?: VersionRef[]
  }
}

interface AdminSyllabusNodeDto {
  id: string
  parentId: string | null
  name: string
  topicId: string | null
  topic: { slug: string; canonicalName: string } | null
  depth: number
  priority: number
  notes: string | null
  childCount: number
  children: AdminSyllabusNodeDto[]
}

interface AdminVersionTreeDto {
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
  editability: 'staged' | 'frozen' | 'locked'
  editabilityReason: string
  nodeCount: number
  tree: AdminSyllabusNodeDto[]
}

interface PublicSyllabusNodeDto {
  name: string
  depth: number
  notes: string | null
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  canonicalPath: string | null
  children: PublicSyllabusNodeDto[]
}

interface PublicExamSyllabusDto {
  exam: { slug: string; name: string; code: string }
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null; isCurrent: boolean } | null
  nodeCount: number
  nodes: PublicSyllabusNodeDto[]
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

interface TopicOption {
  id: string
  slug: string
  label: string
  depth: number
}

// ---------- Presentation helpers ----------

const EDITABILITY_STYLE: Record<string, string> = {
  staged: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  frozen: 'bg-amber-50 text-amber-800 border-amber-200',
  locked: 'bg-rose-50 text-rose-800 border-rose-200',
}

const fmtDay = (iso: string): string => iso.slice(0, 10)

/** Flattens the admin tree for parent selects (with depth for indentation). */
function flattenNodes(
  nodes: AdminSyllabusNodeDto[],
  depth = 0,
  out: Array<{ node: AdminSyllabusNodeDto; depth: number }> = []
): Array<{ node: AdminSyllabusNodeDto; depth: number }> {
  for (const node of nodes) {
    out.push({ node, depth })
    flattenNodes(node.children, depth + 1, out)
  }
  return out
}

function flattenTopics(
  nodes: Array<{
    id: string
    slug: string
    label: string
    children: unknown[]
  }>,
  depth = 0,
  out: TopicOption[] = []
): TopicOption[] {
  for (const node of nodes) {
    out.push({ id: node.id, slug: node.slug, label: node.label, depth })
    flattenTopics(node.children as typeof nodes, depth + 1, out)
  }
  return out
}

// ---------- Component ----------

export function SyllabusSection() {
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
  const [tree, setTree] = useState<AdminVersionTreeDto | null>(null)
  const [treeLoading, setTreeLoading] = useState(false)
  const [topics, setTopics] = useState<TopicOption[]>([])

  // Add-node form
  const [addOpen, setAddOpen] = useState(false)
  const [addParentId, setAddParentId] = useState<string>('root')
  const [addName, setAddName] = useState('')
  const [addTopicId, setAddTopicId] = useState<string>('none')
  const [addNotes, setAddNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // Inline edit form
  const [editId, setEditId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editTopicId, setEditTopicId] = useState<string>('none')
  const [editPriority, setEditPriority] = useState('0')
  const [editNotes, setEditNotes] = useState('')

  // Import panel
  const [outline, setOutline] = useState('')
  const [importing, setImporting] = useState(false)

  // ---------- Public state ----------
  const [countries, setCountries] = useState<CountryRef[]>([])
  const [publicCountry, setPublicCountry] = useState('IN')
  const [publicLanguage, setPublicLanguage] = useState('en')
  const [publicExams, setPublicExams] = useState<PublicExamRef[]>([])
  const [publicSlug, setPublicSlug] = useState('')
  const [syllabus, setSyllabus] = useState<PublicExamSyllabusDto | null>(null)
  const [publicLoading, setPublicLoading] = useState(false)

  const staged = tree?.editability === 'staged'
  const flatNodes = useMemo(() => (tree ? flattenNodes(tree.tree) : []), [tree])
  const selectedExam = exams.find((exam) => exam.id === examId)

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
        setExamId((current) => (current && payload.data!.exams.some((e) => e.id === current) ? current : payload.data!.exams[0]?.id ?? ''))
      }
    } catch {
      toast({ title: 'Network error while loading exams', variant: 'destructive' })
    }
  }, [token, canManage, authHeaders, toast])

  useEffect(() => {
    void loadExams()
  }, [loadExams])

  // Exam detail → versions (default to the CURRENT version, else the latest).
  useEffect(() => {
    if (!token || !examId) {
      setVersions([])
      setVersionId('')
      return
    }
    let cancelled = false
    fetch(`/api/exams/admin/exams/${examId}`, { headers: authHeaders(), cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<AdminExamDetail>) => {
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

  // Topic options for the §13 link select (public taxonomy of the exam's country).
  useEffect(() => {
    if (!selectedExam) {
      setTopics([])
      return
    }
    let cancelled = false
    fetch(`/api/taxonomy/tree?country=${selectedExam.countryIso}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ tree: Array<{ id: string; slug: string; label: string; children: unknown[] }> }>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) setTopics(flattenTopics(payload.data.tree))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selectedExam])

  const loadTree = useCallback(async () => {
    if (!token || !examId || !versionId) {
      setTree(null)
      return
    }
    setTreeLoading(true)
    try {
      const response = await fetch(
        `/api/exams/admin/exams/${examId}/versions/${versionId}/syllabus`,
        { headers: authHeaders(), cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ tree: AdminVersionTreeDto }>
      if (payload.status === 'ok' && payload.data) setTree(payload.data.tree)
      else {
        setTree(null)
        toast({ title: 'Could not load the syllabus tree', description: payload.error?.message, variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setTreeLoading(false)
    }
  }, [token, examId, versionId, authHeaders, toast])

  useEffect(() => {
    setEditId(null)
    setAddOpen(false)
    void loadTree()
  }, [loadTree])

  // ---------- Console mutations ----------

  const mutate = useCallback(
    async (url: string, init: RequestInit, successMessage: string) => {
      setSaving(true)
      try {
        const response = await fetch(url, { headers: authHeaders(true), cache: 'no-store', ...init })
        const payload = (await response.json()) as Envelope<{ tree: AdminVersionTreeDto }>
        if (payload.status === 'ok' && payload.data) {
          setTree(payload.data.tree)
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

  const submitAddNode = async () => {
    if (!examId || !versionId || !addName.trim()) return
    const ok = await mutate(
      `/api/exams/admin/exams/${examId}/versions/${versionId}/nodes`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: addName.trim(),
          parentId: addParentId === 'root' ? null : addParentId,
          topicId: addTopicId === 'none' ? null : addTopicId,
          notes: addNotes.trim() || null,
        }),
      },
      'Node added to the staged tree'
    )
    if (ok) {
      setAddName('')
      setAddNotes('')
      setAddTopicId('none')
      setAddParentId('root')
      setAddOpen(false)
    }
  }

  const startEdit = (node: AdminSyllabusNodeDto) => {
    setEditId(node.id)
    setEditName(node.name)
    setEditTopicId(node.topicId ?? 'none')
    setEditPriority(String(node.priority))
    setEditNotes(node.notes ?? '')
  }

  const submitEdit = async (node: AdminSyllabusNodeDto) => {
    if (!examId || !versionId) return
    const ok = await mutate(
      `/api/exams/admin/exams/${examId}/versions/${versionId}/nodes/${node.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          name: editName.trim(),
          topicId: editTopicId === 'none' ? null : editTopicId,
          priority: Number(editPriority) || 0,
          notes: editNotes.trim() || null,
        }),
      },
      'Node updated'
    )
    if (ok) setEditId(null)
  }

  const removeNode = async (node: AdminSyllabusNodeDto) => {
    if (!examId || !versionId) return
    if (node.childCount > 0) {
      toast({
        title: 'Node has children',
        description: `Remove or move the ${node.childCount} child node${node.childCount === 1 ? '' : 's'} first (§6 tree integrity).`,
        variant: 'destructive',
      })
      return
    }
    await mutate(
      `/api/exams/admin/exams/${examId}/versions/${versionId}/nodes/${node.id}`,
      { method: 'DELETE' },
      'Node removed'
    )
  }

  const submitImport = async () => {
    if (!examId || !versionId) return
    setImporting(true)
    const ok = await mutate(
      `/api/exams/admin/exams/${examId}/versions/${versionId}/import`,
      { method: 'POST', body: JSON.stringify({ outline }) },
      'Staged tree replaced from the outline'
    )
    if (ok) setOutline('')
    setImporting(false)
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

  // Country change → reset language to the country default + reload exams.
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
      setSyllabus(null)
      return
    }
    let cancelled = false
    setPublicLoading(true)
    const params = new URLSearchParams({ country: publicCountry, language: publicLanguage })
    fetch(`/api/exams/${publicSlug}/syllabus?${params.toString()}`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ syllabus: PublicExamSyllabusDto }>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) setSyllabus(payload.data.syllabus)
        else setSyllabus(null)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setPublicLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [publicSlug, publicCountry, publicLanguage, selectedCountry])

  // ---------- Render helpers ----------

  const renderAdminNode = (node: AdminSyllabusNodeDto): React.ReactNode => {
    const editing = editId === node.id
    return (
      <li key={node.id} className="list-none">
        {editing ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2 my-1">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <Input
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                aria-label="Node name"
                maxLength={200}
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void submitEdit(node)} disabled={saving || !editName.trim()}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />} Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                  <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                </Button>
              </div>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <UILabel className="text-xs text-zinc-500">Canonical topic (§13)</UILabel>
                <Select value={editTopicId} onValueChange={setEditTopicId}>
                  <SelectTrigger className="w-full min-w-0 text-xs [&>span]:min-w-0 [&>span]:truncate" aria-label="Canonical topic link">
                    <SelectValue placeholder="No topic link" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                    <SelectItem value="none">No topic link</SelectItem>
                    {topics.map((topic) => (
                      <SelectItem key={topic.id} value={topic.id} className="max-w-full">
                        <span className="min-w-0 truncate">{'· '.repeat(topic.depth)}{topic.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <UILabel className="text-xs text-zinc-500">Priority (§6 sibling order)</UILabel>
                <Input
                  type="number"
                  min={0}
                  max={9999}
                  value={editPriority}
                  onChange={(event) => setEditPriority(event.target.value)}
                  aria-label="Sibling priority"
                />
              </div>
              <div className="space-y-1">
                <UILabel className="text-xs text-zinc-500">Notes</UILabel>
                <Input
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  aria-label="Editorial notes"
                  maxLength={2000}
                />
              </div>
            </div>
          </div>
        ) : (
          <div
            className="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5 hover:bg-zinc-50"
            style={{ marginLeft: `${node.depth * 18}px` }}
          >
            {node.childCount > 0 ? (
              <TreePine className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-zinc-300" aria-hidden="true" />
            )}
            <span className="text-sm font-medium text-zinc-800">{node.name}</span>
            {node.topic ? (
              <Badge variant="outline" className="text-[10px] gap-1 border-emerald-200 bg-emerald-50 text-emerald-800">
                <Link2 className="h-2.5 w-2.5" aria-hidden="true" /> {node.topic.canonicalName}
              </Badge>
            ) : null}
            <span className="text-[10px] text-zinc-400">#{node.priority}</span>
            {staged ? (
              <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => startEdit(node)}>
                  <Pencil className="h-3 w-3" aria-hidden="true" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setAddParentId(node.id)
                    setAddOpen(true)
                  }}
                >
                  <Plus className="h-3 w-3" aria-hidden="true" /> Child
                </Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-rose-600 hover:text-rose-700" onClick={() => void removeNode(node)}>
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                </Button>
              </span>
            ) : null}
          </div>
        )}
        {node.children.length > 0 ? (
          <ul>{node.children.map((child) => renderAdminNode(child))}</ul>
        ) : null}
      </li>
    )
  }

  const renderPublicNode = (node: PublicSyllabusNodeDto): React.ReactNode => (
    <li key={`${node.depth}-${node.name}`} className="list-none">
      <div
        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md px-2 py-1.5"
        style={{ marginLeft: `${node.depth * 18}px` }}
      >
        {node.children.length > 0 ? (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden="true" />
        ) : (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-300" aria-hidden="true" />
        )}
        <span className="text-sm text-zinc-800">{node.name}</span>
        {node.topic ? (
          <Badge variant="outline" className="text-[10px] gap-1 border-emerald-200 bg-emerald-50 text-emerald-800">
            <Link2 className="h-2.5 w-2.5" aria-hidden="true" /> {node.topic.label}
          </Badge>
        ) : null}
        {node.canonicalPath ? (
          <code className="text-[10px] text-zinc-400">{node.canonicalPath}</code>
        ) : null}
      </div>
      {node.children.length > 0 ? <ul>{node.children.map((child) => renderPublicNode(child))}</ul> : null}
    </li>
  )

  // ---------- Render ----------

  return (
    <Card id="syllabus" className="scroll-mt-20">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <TreePine className="h-5 w-5 text-emerald-700" aria-hidden="true" />
            Syllabus trees
          </CardTitle>
          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
            P3-S2 · §6 / §13 / §36
          </Badge>
        </div>
        <CardDescription>
          Version-pinned exam syllabi (SyllabusNode). A tree is staging until its version takes effect — then it is
          frozen §36 history, and changes create a new ExamVersion. Topic links are the only bridge between an exam
          and the canonical taxonomy (§13) — the anchor the P3-S3 exam mappings and the §11 combination engine build
          on.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={canManage ? 'console' : 'public'}>
          <TabsList className="mb-4">
            {canManage ? <TabsTrigger value="console">Editorial console</TabsTrigger> : null}
            <TabsTrigger value="public">Public syllabus</TabsTrigger>
          </TabsList>

          {canManage ? (
            <TabsContent value="console" className="space-y-4">
              {/* Exam + version pickers */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <UILabel className="text-xs font-medium text-zinc-500">Exam</UILabel>
                  <Select value={examId} onValueChange={setExamId}>
                    <SelectTrigger aria-label="Exam" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                      <SelectValue placeholder={exams.length === 0 ? 'No exams visible' : 'Pick an exam'} />
                    </SelectTrigger>
                    <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                      {exams.map((exam) => (
                        <SelectItem key={exam.id} value={exam.id} className="max-w-full">
                          <span className="min-w-0 truncate">{exam.name} · {exam.countryIso} ({exam.status})</span>
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
                            {version.label} · {fmtDay(version.effectiveFrom)} → {version.effectiveTo ? fmtDay(version.effectiveTo) : 'open'} · {version.nodeCount} nodes
                            {version.isCurrent ? ' · CURRENT' : version.isUpcoming ? ' · UPCOMING' : ''}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {versions.length === 0 && selectedExam ? (
                <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                  This exam has no versions yet — create one in the Exams console above before building a syllabus
                  tree.
                </p>
              ) : null}

              {/* Editability banner + tree */}
              {treeLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-8 w-4/5" />
                  <Skeleton className="h-8 w-3/5" />
                </div>
              ) : tree ? (
                <>
                  <div className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm ${EDITABILITY_STYLE[tree.editability]}`}>
                    <span className="flex items-center gap-2 font-medium">
                      {tree.editability === 'frozen' ? <Snowflake className="h-4 w-4" aria-hidden="true" /> : null}
                      {tree.editability === 'staged' ? 'Staged — editable' : tree.editability === 'frozen' ? 'In effect — frozen' : 'Retired — read-only'}
                    </span>
                    <span className="text-xs opacity-80">
                      {tree.exam.name} · {tree.version.label} · {tree.nodeCount} node{tree.nodeCount === 1 ? '' : 's'} · {tree.editabilityReason}
                    </span>
                  </div>

                  <div className="max-h-96 overflow-y-auto globiq-scroll rounded-lg border border-zinc-200 bg-white p-2" role="tree" aria-label="Syllabus tree">
                    {tree.tree.length === 0 ? (
                      <p className="p-4 text-sm text-zinc-500">
                        Empty tree — add the first node or import an outline{staged ? ' below' : ''}.
                      </p>
                    ) : (
                      <ul>{tree.tree.map((node) => renderAdminNode(node))}</ul>
                    )}
                  </div>

                  {staged ? (
                    <>
                      <Separator />
                      {/* Add-node form */}
                      {addOpen ? (
                        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <UILabel className="text-xs text-zinc-500">Parent</UILabel>
                              <Select value={addParentId} onValueChange={setAddParentId}>
                                <SelectTrigger aria-label="Parent node">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                  <SelectItem value="root">— root —</SelectItem>
                                  {flatNodes.map(({ node, depth }) => (
                                    <SelectItem key={node.id} value={node.id} className="max-w-full">
                                      <span className="min-w-0 truncate">{'· '.repeat(depth)}{node.name}</span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <UILabel className="text-xs text-zinc-500">Node name (notification wording, §13)</UILabel>
                              <Input
                                value={addName}
                                onChange={(event) => setAddName(event.target.value)}
                                placeholder="e.g. Indian Polity and Governance"
                                maxLength={200}
                              />
                            </div>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <UILabel className="text-xs text-zinc-500">Canonical topic link (§13)</UILabel>
                              <Select value={addTopicId} onValueChange={setAddTopicId}>
                                <SelectTrigger aria-label="Canonical topic link" className="w-full min-w-0 [&>span]:min-w-0 [&>span]:truncate">
                                  <SelectValue placeholder="No topic link" />
                                </SelectTrigger>
                                <SelectContent className="max-h-72 max-w-[calc(100vw-3rem)]">
                                  <SelectItem value="none">No topic link</SelectItem>
                                  {topics.map((topic) => (
                                    <SelectItem key={topic.id} value={topic.id} className="max-w-full">
                                      <span className="min-w-0 truncate">{'· '.repeat(topic.depth)}{topic.label}</span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <UILabel className="text-xs text-zinc-500">Notes</UILabel>
                              <Input value={addNotes} onChange={(event) => setAddNotes(event.target.value)} maxLength={2000} aria-label="Editorial notes" />
                            </div>
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="ghost" onClick={() => setAddOpen(false)}>
                              <X className="h-3.5 w-3.5" aria-hidden="true" /> Cancel
                            </Button>
                            <Button size="sm" onClick={() => void submitAddNode()} disabled={saving || !addName.trim()}>
                              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />} Add node
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => { setAddParentId('root'); setAddOpen(true) }}>
                          <FilePlus2 className="h-3.5 w-3.5" aria-hidden="true" /> Add node
                        </Button>
                      )}

                      <Separator />
                      {/* Outline import */}
                      <div className="space-y-2 rounded-lg border border-zinc-200 p-3">
                        <div className="flex items-center justify-between">
                          <UILabel className="text-sm font-medium">Import outline (replaces the staged tree)</UILabel>
                          <Badge variant="outline" className="text-[10px] text-zinc-500">staging only · §36</Badge>
                        </div>
                        <Textarea
                          value={outline}
                          onChange={(event) => setOutline(event.target.value)}
                          rows={7}
                          placeholder={'Prelims — Paper I (General Studies)\n  Current events of national importance\n  Indian Polity and Governance\nPrelims — Paper II (CSAT)\n  Comprehension\n\n# two spaces (or one tab) per level · blank lines + # comments ignored\n# an empty import clears the staged tree'}
                          aria-label="Syllabus outline"
                        />
                        <div className="flex justify-end">
                          <Button size="sm" onClick={() => void submitImport()} disabled={importing || saving}>
                            {importing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />} Replace tree from outline
                          </Button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </>
              ) : selectedExam && versions.length > 0 ? (
                <p className="text-sm text-zinc-500">Select a version to view its tree.</p>
              ) : null}
            </TabsContent>
          ) : null}

          <TabsContent value="public" className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <UILabel className="text-xs font-medium text-zinc-500">Country</UILabel>
                <Select value={publicCountry} onValueChange={setPublicCountry}>
                  <SelectTrigger aria-label="Country">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {countries.map((country) => (
                      <SelectItem key={country.isoCode} value={country.isoCode}>
                        {country.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <UILabel className="text-xs font-medium text-zinc-500">
                  <Languages className="mr-1 inline h-3 w-3" aria-hidden="true" /> Language (§35)
                </UILabel>
                <Select value={publicLanguage} onValueChange={setPublicLanguage}>
                  <SelectTrigger aria-label="Language">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedCountry?.languages ?? []).map((language) => (
                      <SelectItem key={language.code} value={language.code}>
                        {language.nativeName ?? language.name} ({language.code})
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
                      <SelectItem key={exam.id} value={exam.slug} className="max-w-full">
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
                <Skeleton className="h-8 w-5/6" />
                <Skeleton className="h-8 w-2/3" />
              </div>
            ) : syllabus ? (
              <>
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <BookMarked className="h-4 w-4 text-emerald-700" aria-hidden="true" />
                  <span className="font-medium">{syllabus.exam.name}</span>
                  {syllabus.version ? (
                    <>
                      <Badge variant="outline" className="shrink-0 border-emerald-200 bg-emerald-50 text-emerald-800">
                        {syllabus.version.isCurrent ? 'CURRENT' : 'historical'}
                      </Badge>
                      <span className="text-xs text-zinc-600">
                        {syllabus.version.label} · {fmtDay(syllabus.version.effectiveFrom)} → {syllabus.version.effectiveTo ? fmtDay(syllabus.version.effectiveTo) : 'open'}
                      </span>
                    </>
                  ) : (
                    <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-500">no syllabus version in effect</Badge>
                  )}
                  <span className="ml-auto text-xs text-zinc-500">
                    {syllabus.nodeCount} node{syllabus.nodeCount === 1 ? '' : 's'} · {syllabus.language.name}
                  </span>
                </div>
                <div className="max-h-96 overflow-y-auto globiq-scroll rounded-lg border border-zinc-200 bg-white p-2" role="tree" aria-label="Public syllabus tree">
                  {syllabus.nodes.length === 0 ? (
                    <p className="p-4 text-sm text-zinc-500">No syllabus published for this exam yet.</p>
                  ) : (
                    <ul>{syllabus.nodes.map((node) => renderPublicNode(node))}</ul>
                  )}
                </div>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-500">
                Pick an exam to read its current syllabus tree.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
}
