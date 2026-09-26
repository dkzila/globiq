'use client'

/**
 * GlobIQ — Taxonomy Admin Console (P1-S4)
 *
 * Privileged surface for taxonomy CRUD (Master Plan §43 P1-S4, §38 scoped
 * roles, §36 migration-safe changes): the admin tree with all statuses, node
 * editor (rename, describe, reorder, activate/inactivate, move), label and
 * alias editors, soft-retire with confirmation, and a create form. COUNTRY_ADMIN
 * sees global nodes read-only and manages only own-country extensions — the
 * permission flags come from the server, the UI never decides access.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleOff,
  Globe2,
  Layers,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Tag,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/stores/auth'
import type { AdminTopicDetail, AdminTopicNode } from '@/modules/taxonomy/types'

// ---------- API helpers ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: unknown }
}

async function api<T>(
  path: string,
  token: string,
  init: RequestInit = {}
): Promise<Envelope<T>> {
  try {
    const response = await fetch(path, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${token}`,
        ...init.headers,
      },
      cache: 'no-store',
    })
    return (await response.json()) as Envelope<T>
  } catch {
    return { status: 'error', error: { code: 'NETWORK', message: 'Network error — please retry.' } }
  }
}

function fieldErrorMessage(details: unknown): string | null {
  if (details && typeof details === 'object' && 'fields' in details) {
    const fields = (details as { fields: Record<string, string[]> }).fields
    const first = Object.values(fields)[0]?.[0]
    if (first) return first
  }
  return null
}

// ---------- Helpers ----------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
}

const typeIcon = {
  DOMAIN: <Layers className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />,
  BRANCH: <Globe2 className="h-3.5 w-3.5 text-teal-600" aria-hidden="true" />,
  TOPIC: <Tag className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />,
}

const statusIcon = {
  ACTIVE: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />,
  INACTIVE: <CircleOff className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />,
  RETIRED: <Archive className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />,
}

interface FlatNode {
  id: string
  slug: string
  canonicalName: string
  label: string
  depth: number
  status: string
}

function flattenTree(nodes: AdminTopicNode[], depth = 0, prefix = ''): FlatNode[] {
  return nodes.flatMap((node) => {
    const label = `${prefix}${node.canonicalName}`
    return [
      { id: node.id, slug: node.slug, canonicalName: node.canonicalName, label, depth, status: node.status },
      ...flattenTree(node.children, depth + 1, `${prefix}  `),
    ]
  })
}

// ---------- Admin tree row ----------

function AdminTreeRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: AdminTopicNode
  depth: number
  expanded: Set<string>
  selectedId: string | null
  onToggle: (slug: string) => void
  onSelect: (id: string) => void
}) {
  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.slug)
  const isSelected = selectedId === node.id

  return (
    <li role="treeitem" aria-selected={isSelected} className="min-w-0">
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
            aria-label={isOpen ? `Collapse ${node.canonicalName}` : `Expand ${node.canonicalName}`}
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
          onClick={() => onSelect(node.id)}
          className="flex min-h-[36px] min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden="true">{statusIcon[node.status]}</span>
          <span aria-hidden="true">{typeIcon[node.type]}</span>
          <span className={`truncate text-sm ${node.status === 'RETIRED' ? 'text-zinc-400 line-through' : 'text-zinc-800'}`}>
            {node.canonicalName}
          </span>
          {node.scope === 'COUNTRY' && (
            <Badge className="bg-amber-100 text-[10px] font-medium text-amber-800 hover:bg-amber-100">
              <MapPin className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
              {node.countryIso}
            </Badge>
          )}
        </button>
      </div>
      {hasChildren && isOpen && (
        <ul role="group">
          {node.children.map((child) => (
            <AdminTreeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------- Label / alias editor rows ----------

interface LabelRow {
  language: string
  name: string
}

interface AliasRow {
  value: string
  language: string // '' = language-neutral
}

// ---------- Main component ----------

export function TaxonomyAdmin() {
  const token = useAuth((state) => state.token)
  const user = useAuth((state) => state.user)
  const isAdmin = user?.role === 'ADMIN'

  const [tree, setTree] = useState<AdminTopicNode[] | null>(null)
  const [treeError, setTreeError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AdminTopicDetail | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Editor state
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [orderIndex, setOrderIndex] = useState('0')
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE')
  const [parentSlug, setParentSlug] = useState('')
  const [labelRows, setLabelRows] = useState<LabelRow[]>([])
  const [aliasRows, setAliasRows] = useState<AliasRow[]>([])
  const [retireOpen, setRetireOpen] = useState(false)

  // Create form
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createSlug, setCreateSlug] = useState('')
  const [createSlugEdited, setCreateSlugEdited] = useState(false)
  const [createDescription, setCreateDescription] = useState('')
  const [createParent, setCreateParent] = useState('')
  const [createType, setCreateType] = useState<'BRANCH' | 'TOPIC'>('BRANCH')
  const [createScope, setCreateScope] = useState<'GLOBAL' | 'COUNTRY'>('COUNTRY')
  const [createCountry, setCreateCountry] = useState('IN')
  const [createOrder, setCreateOrder] = useState('0')

  // Languages for label/alias editors
  const [languages, setLanguages] = useState<Array<{ code: string; name: string }>>([])
  // Countries for the create form (ADMIN only)
  const [countries, setCountries] = useState<Array<{ isoCode: string; name: string }>>([])

  const flatNodes = useMemo(() => (tree ? flattenTree(tree) : []), [tree])

  // Initial tree load — async boundary inside the effect (cancelled on unmount).
  // `loadTree` stays for the Reload button and post-action refreshes.
  const loadTree = useCallback(async () => {
    if (!token) return
    const result = await api<{ tree: AdminTopicNode[] }>('/api/taxonomy/admin/tree', token)
    if (result.status === 'ok' && result.data) {
      setTree(result.data.tree)
      setTreeError(null)
    } else {
      setTree([])
      setTreeError(result.error?.message ?? 'Could not load the admin tree')
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    const authToken = token
    let cancelled = false
    async function run() {
      const result = await api<{ tree: AdminTopicNode[] }>('/api/taxonomy/admin/tree', authToken)
      if (cancelled) return
      if (result.status === 'ok' && result.data) {
        setTree(result.data.tree)
        setTreeError(null)
      } else {
        setTree([])
        setTreeError(result.error?.message ?? 'Could not load the admin tree')
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token])

  useEffect(() => {
    if (!token) return
    void api<{ languages: Array<{ code: string; name: string; status: string }> }>('/api/languages', token).then(
      (result) => {
        if (result.status === 'ok' && result.data) {
          setLanguages(result.data.languages.filter((l) => l.status === 'ACTIVE'))
        }
      }
    )
    void fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: Array<{ isoCode: string; name: string; status: string }> }>) => {
        if (payload.status === 'ok' && payload.data) {
          setCountries(payload.data.countries.filter((c) => c.status === 'ACTIVE').map((c) => ({ isoCode: c.isoCode, name: c.name })))
        }
      })
      .catch(() => undefined)
  }, [token])

  const loadDetail = useCallback(
    async (id: string) => {
      if (!token) return
      setSelectedId(id)
      setDetail(null)
      setActionError(null)
      setNotice(null)
      const result = await api<{ topic: AdminTopicDetail }>(`/api/taxonomy/admin/nodes/${id}`, token)
      if (result.status === 'ok' && result.data) {
        const topic = result.data.topic
        setDetail(topic)
        setName(topic.canonicalName)
        setDescription(topic.description ?? '')
        setOrderIndex(String(topic.orderIndex))
        setStatus(topic.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE')
        setParentSlug(topic.parentSlug ?? '')
        setLabelRows(topic.labels.map((label) => ({ language: label.language, name: label.name })))
        setAliasRows(topic.aliases.map((alias) => ({ value: alias.value, language: alias.language ?? '' })))
      } else {
        setActionError(result.error?.message ?? 'Could not load the node')
      }
    },
    [token]
  )

  const runAction = useCallback(
    async (path: string, init: RequestInit, successMessage: string) => {
      if (!token) return false
      setBusy(true)
      setActionError(null)
      setNotice(null)
      const result = await api<{ topic: AdminTopicDetail }>(path, token, init)
      setBusy(false)
      if (result.status === 'ok' && result.data) {
        setDetail(result.data.topic)
        setNotice(successMessage)
        await loadTree()
        return true
      }
      const fieldMessage = result.error ? fieldErrorMessage(result.error.details) : null
      setActionError(fieldMessage ?? result.error?.message ?? 'Operation failed')
      return false
    },
    [token, loadTree]
  )
  const saveBasics = () =>
    detail &&
    void runAction(
      `/api/taxonomy/admin/nodes/${detail.id}`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          canonicalName: name,
          description: description.trim().length === 0 ? null : description,
          orderIndex: Number(orderIndex) || 0,
          ...(detail.status !== 'RETIRED' ? { status } : {}),
        }),
      },
      'Node updated'
    )

  const moveNode = () =>
    detail &&
    void runAction(
      `/api/taxonomy/admin/nodes/${detail.id}`,
      { method: 'PATCH', body: JSON.stringify({ parent: parentSlug }) },
      'Node moved'
    )

  const saveLabels = () =>
    detail &&
    void runAction(
      `/api/taxonomy/admin/nodes/${detail.id}/labels`,
      {
        method: 'PUT',
        body: JSON.stringify({
          labels: labelRows
            .filter((row) => row.language && row.name.trim().length > 0)
            .map((row) => ({ language: row.language, name: row.name.trim() })),
        }),
      },
      'Labels saved'
    )

  const saveAliases = () =>
    detail &&
    void runAction(
      `/api/taxonomy/admin/nodes/${detail.id}/aliases`,
      {
        method: 'PUT',
        body: JSON.stringify({
          aliases: aliasRows
            .filter((row) => row.value.trim().length > 0)
            .map((row) => ({
              value: row.value.trim(),
              ...(row.language ? { language: row.language } : {}),
            })),
        }),
      },
      'Aliases saved'
    )

  const retireNode = () =>
    detail &&
    void runAction(`/api/taxonomy/admin/nodes/${detail.id}`, { method: 'DELETE' }, 'Node retired (soft-delete)')

  const createNode = async () => {
    if (!token) return
    const slug = createSlugEdited ? createSlug : slugify(createName)
    const payload: Record<string, unknown> = {
      canonicalName: createName,
      slug,
      type: createParent ? createType : 'DOMAIN',
      scope: createParent ? createScope : 'GLOBAL',
      orderIndex: Number(createOrder) || 0,
    }
    if (createParent) payload.parent = createParent
    if (createParent && createScope === 'COUNTRY') payload.country = createCountry
    if (createDescription.trim().length > 0) payload.description = createDescription.trim()

    const okResult = await runAction('/api/taxonomy/admin/nodes', { method: 'POST', body: JSON.stringify(payload) }, 'Node created')
    if (okResult) {
      setCreateOpen(false)
      setCreateName('')
      setCreateSlug('')
      setCreateSlugEdited(false)
      setCreateDescription('')
      setCreateOrder('0')
    }
  }

  const toggle = useCallback((slug: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }, [])

  const canEdit = detail?.permissions.canEdit === true
  const readOnly = detail !== null && !canEdit

  return (
    <div className="space-y-4">
      {/* ---------- Scope banner ---------- */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
        {isAdmin ? (
          <span>
            Platform admin — full taxonomy control, including global nodes and root domains.
          </span>
        ) : (
          <span>
            Country admin ({user?.homeCountry?.isoCode ?? 'no country'}) — manage own-country
            extensions; global nodes are read-only.
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        {/* ---------- Admin tree ---------- */}
        <Card className="min-w-0 border-zinc-200 shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base">Admin tree</CardTitle>
              <div className="flex gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5"
                  onClick={() => {
                    setTree(null)
                    void loadTree()
                  }}
                  aria-label="Reload admin tree"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reload
                </Button>
                <Button size="sm" className="h-8 gap-1.5" onClick={() => setCreateOpen((open) => !open)}>
                  {createOpen ? <Circle className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                  {createOpen ? 'Close' : 'New node'}
                </Button>
              </div>
            </div>
            <CardDescription>All statuses visible (§38) · {flatNodes.length} nodes</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Create form */}
            {createOpen && (
              <form
                className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void createNode()
                }}
              >
                <p className="text-sm font-semibold text-emerald-900">Create taxonomy node</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="create-parent">Parent</Label>
                    <Select value={createParent} onValueChange={(value) => setCreateParent(value === '__root__' ? '' : value)}>
                      <SelectTrigger id="create-parent" className="bg-white">
                        <SelectValue placeholder="— root domain —" />
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        <SelectItem value="__root__">— root domain —</SelectItem>
                        {flatNodes
                          .filter((node) => node.status !== 'RETIRED')
                          .map((node) => (
                            <SelectItem key={node.id} value={node.slug}>
                              {node.label.trim()}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="create-type">Type</Label>
                    <Select
                      value={createType}
                      onValueChange={(value) => setCreateType(value as 'BRANCH' | 'TOPIC')}
                      disabled={!createParent || !isAdmin}
                    >
                      <SelectTrigger id="create-type" className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="BRANCH" disabled={!isAdmin}>Branch</SelectItem>
                        <SelectItem value="TOPIC">Topic</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="create-scope">Scope</Label>
                    <Select
                      value={createScope}
                      onValueChange={(value) => setCreateScope(value as 'GLOBAL' | 'COUNTRY')}
                      disabled={!createParent || !isAdmin}
                    >
                      <SelectTrigger id="create-scope" className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GLOBAL" disabled={!isAdmin}>Global</SelectItem>
                        <SelectItem value="COUNTRY">Country extension</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {createParent && createScope === 'COUNTRY' && (
                    <div className="space-y-1">
                      <Label htmlFor="create-country">Country</Label>
                      <Select
                        value={createCountry}
                        onValueChange={setCreateCountry}
                        disabled={!isAdmin}
                      >
                        <SelectTrigger id="create-country" className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(isAdmin ? countries : countries.filter((c) => c.isoCode === user?.homeCountry?.isoCode)).map(
                            (country) => (
                              <SelectItem key={country.isoCode} value={country.isoCode}>
                                {country.name} ({country.isoCode})
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label htmlFor="create-order">Order</Label>
                    <Input
                      id="create-order"
                      type="number"
                      min={0}
                      max={9999}
                      value={createOrder}
                      onChange={(event) => setCreateOrder(event.target.value)}
                      className="bg-white"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="create-name">Canonical name</Label>
                  <Input
                    id="create-name"
                    value={createName}
                    onChange={(event) => {
                      setCreateName(event.target.value)
                      if (!createSlugEdited) setCreateSlug(slugify(event.target.value))
                    }}
                    placeholder="e.g. Environmental Laws"
                    required
                    minLength={2}
                    className="bg-white"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="create-slug">Slug (immutable after creation)</Label>
                  <Input
                    id="create-slug"
                    value={createSlug}
                    onChange={(event) => {
                      setCreateSlugEdited(true)
                      setCreateSlug(slugify(event.target.value))
                    }}
                    placeholder="environmental-laws"
                    required
                    className="bg-white font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="create-description">Description (optional)</Label>
                  <Textarea
                    id="create-description"
                    value={createDescription}
                    onChange={(event) => setCreateDescription(event.target.value)}
                    rows={2}
                    className="bg-white"
                  />
                </div>
                <Button type="submit" size="sm" disabled={busy || createName.trim().length < 2 || createSlug.length < 2}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
                  Create node
                </Button>
              </form>
            )}

            {tree === null && !treeError ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((row) => (
                  <Skeleton key={row} className="h-8 w-full" />
                ))}
              </div>
            ) : treeError ? (
              <p className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                {treeError}
              </p>
            ) : (
              <ul role="tree" aria-label="Admin taxonomy tree" className="max-h-[32rem] overflow-y-auto globiq-scroll">
                {tree?.map((node) => (
                  <AdminTreeRow
                    key={node.id}
                    node={node}
                    depth={0}
                    expanded={expanded}
                    selectedId={selectedId}
                    onToggle={toggle}
                    onSelect={(id) => void loadDetail(id)}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ---------- Editor ---------- */}
        <Card className="min-w-0 border-zinc-200 shadow-sm lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Node editor</CardTitle>
            <CardDescription>
              Slugs, type and scope are immutable (§36 migration-safe) · retirement is leaf-first
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!detail ? (
              <p className="rounded-md border border-dashed border-zinc-300 px-3 py-10 text-center text-sm text-zinc-500">
                Select a node from the admin tree to edit it.
              </p>
            ) : (
              <div className="space-y-5">
                {/* Header */}
                <div className="flex flex-wrap items-center gap-2">
                  <span aria-hidden="true">{typeIcon[detail.type]}</span>
                  <h3 className="text-base font-semibold text-zinc-900">{detail.canonicalName}</h3>
                  <Badge
                    variant="outline"
                    className={
                      detail.status === 'ACTIVE'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : detail.status === 'INACTIVE'
                          ? 'border-amber-200 bg-amber-50 text-amber-700'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                    }
                  >
                    {detail.status}
                  </Badge>
                  {detail.scope === 'COUNTRY' ? (
                    <Badge className="bg-amber-100 text-[10px] font-medium text-amber-800 hover:bg-amber-100">
                      <MapPin className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                      {detail.countryIso}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] font-normal text-zinc-500">
                      GLOBAL
                    </Badge>
                  )}
                  {readOnly && (
                    <Badge variant="outline" className="border-zinc-300 text-[10px] font-normal text-zinc-500">
                      read-only for your role
                    </Badge>
                  )}
                  <span className="ml-auto font-mono text-[11px] text-zinc-400">/{detail.slug}</span>
                </div>

                {detail.path.length > 1 && (
                  <p className="text-xs text-zinc-500">
                    {detail.path.map((entry) => entry.canonicalName).join(' › ')}
                  </p>
                )}

                {(actionError || notice) && (
                  <p
                    role="status"
                    className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
                      actionError
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    }`}
                  >
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {actionError ?? notice}
                  </p>
                )}

                {/* Basics */}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="edit-name">Canonical name</Label>
                    <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} disabled={!canEdit || detail.status === 'RETIRED'} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-order">Order index</Label>
                    <Input id="edit-order" type="number" min={0} max={9999} value={orderIndex} onChange={(event) => setOrderIndex(event.target.value)} disabled={!canEdit || detail.status === 'RETIRED'} />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label htmlFor="edit-description">Description</Label>
                    <Textarea id="edit-description" rows={2} value={description} onChange={(event) => setDescription(event.target.value)} disabled={!canEdit || detail.status === 'RETIRED'} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-status">Visibility status</Label>
                    <Select value={status} onValueChange={(value) => setStatus(value as 'ACTIVE' | 'INACTIVE')} disabled={!canEdit || detail.status === 'RETIRED'}>
                      <SelectTrigger id="edit-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ACTIVE">Active (visible)</SelectItem>
                        <SelectItem value="INACTIVE">Inactive (hidden, reversible)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-end">
                    <Button onClick={saveBasics} disabled={!canEdit || detail.status === 'RETIRED' || busy} className="gap-2">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
                      Save changes
                    </Button>
                  </div>
                </div>

                {/* Move */}
                <div className="rounded-lg border border-zinc-200 p-3">
                  <p className="text-sm font-medium text-zinc-800">Move node</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    Cycles and cross-country moves are rejected server-side (§36).
                  </p>
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <Label htmlFor="edit-parent">Parent (slug)</Label>
                      <Select value={parentSlug} onValueChange={setParentSlug} disabled={!detail.permissions.canMove || detail.type === 'DOMAIN' || detail.status === 'RETIRED'}>
                        <SelectTrigger id="edit-parent">
                          <SelectValue placeholder="— root domain —" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64">
                          {flatNodes
                            .filter((node) => node.id !== detail.id && node.status !== 'RETIRED')
                            .map((node) => (
                              <SelectItem key={node.id} value={node.slug}>
                                {node.label.trim()}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      variant="outline"
                      onClick={moveNode}
                      disabled={!detail.permissions.canMove || detail.type === 'DOMAIN' || detail.status === 'RETIRED' || busy}
                      className="gap-2"
                    >
                      Move
                    </Button>
                  </div>
                </div>

                {/* Labels */}
                <div className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-800">Language labels (§13)</p>
                      <p className="mt-0.5 text-xs text-zinc-500">One per language — replaces the whole set on save.</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setLabelRows((rows) => [...rows, { language: languages[0]?.code ?? 'en', name: '' }])}
                      disabled={!detail.permissions.canManageLabels || detail.status === 'RETIRED'}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add
                    </Button>
                  </div>
                  {labelRows.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-400">No labels — renders the canonical name.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {labelRows.map((row, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Select
                            value={row.language}
                            onValueChange={(value) =>
                              setLabelRows((rows) => rows.map((r, i) => (i === index ? { ...r, language: value } : r)))
                            }
                            disabled={!detail.permissions.canManageLabels || detail.status === 'RETIRED'}
                          >
                            <SelectTrigger className="w-28 shrink-0" aria-label="Label language">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {languages.map((language) => (
                                <SelectItem key={language.code} value={language.code}>
                                  {language.code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={row.name}
                            onChange={(event) =>
                              setLabelRows((rows) => rows.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))
                            }
                            placeholder="Localised name"
                            disabled={!detail.permissions.canManageLabels || detail.status === 'RETIRED'}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLabelRows((rows) => rows.filter((_, i) => i !== index))}
                            disabled={!detail.permissions.canManageLabels || detail.status === 'RETIRED'}
                            aria-label={`Remove label ${row.language}`}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 gap-1.5"
                    onClick={saveLabels}
                    disabled={!detail.permissions.canManageLabels || detail.status === 'RETIRED' || busy}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                    Save labels
                  </Button>
                </div>

                {/* Aliases */}
                <div className="rounded-lg border border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-zinc-800">Aliases (§13)</p>
                      <p className="mt-0.5 text-xs text-zinc-500">Alternate search terms; language optional.</p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setAliasRows((rows) => [...rows, { value: '', language: '' }])}
                      disabled={!detail.permissions.canManageAliases || detail.status === 'RETIRED'}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      Add
                    </Button>
                  </div>
                  {aliasRows.length === 0 ? (
                    <p className="mt-2 text-xs text-zinc-400">No aliases.</p>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {aliasRows.map((row, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <Input
                            value={row.value}
                            onChange={(event) =>
                              setAliasRows((rows) => rows.map((r, i) => (i === index ? { ...r, value: event.target.value } : r)))
                            }
                            placeholder="e.g. FR"
                            disabled={!detail.permissions.canManageAliases || detail.status === 'RETIRED'}
                          />
                          <Select
                            value={row.language || '__any__'}
                            onValueChange={(value) =>
                              setAliasRows((rows) =>
                                rows.map((r, i) => (i === index ? { ...r, language: value === '__any__' ? '' : value } : r))
                              )
                            }
                            disabled={!detail.permissions.canManageAliases || detail.status === 'RETIRED'}
                          >
                            <SelectTrigger className="w-28 shrink-0" aria-label="Alias language">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__any__">any</SelectItem>
                              {languages.map((language) => (
                                <SelectItem key={language.code} value={language.code}>
                                  {language.code}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAliasRows((rows) => rows.filter((_, i) => i !== index))}
                            disabled={!detail.permissions.canManageAliases || detail.status === 'RETIRED'}
                            aria-label={`Remove alias ${row.value}`}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 gap-1.5"
                    onClick={saveAliases}
                    disabled={!detail.permissions.canManageAliases || detail.status === 'RETIRED' || busy}
                  >
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Save className="h-3.5 w-3.5" aria-hidden="true" />}
                    Save aliases
                  </Button>
                </div>

                {/* Retire */}
                {detail.status !== 'RETIRED' && (
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50/60 p-3">
                    <div>
                      <p className="text-sm font-medium text-red-800">Retire this node</p>
                      <p className="mt-0.5 text-xs text-red-700">
                        Soft-delete (§36) — children must be retired first; recovery requires a platform admin.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      className="gap-2"
                      onClick={() => setRetireOpen(true)}
                      disabled={!detail.permissions.canRetire || busy}
                    >
                      <Archive className="h-4 w-4" aria-hidden="true" />
                      Retire node
                    </Button>
                  </div>
                )}
                {detail.status === 'RETIRED' && (
                  <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                    This node is retired (archived). Retired nodes are read-only; restoring requires a
                    platform admin via direct database operation per §36.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Retire confirmation */}
      <AlertDialog open={retireOpen} onOpenChange={setRetireOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire “{detail?.canonicalName}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The node will be soft-deleted: hidden from every public surface, kept in the database
              for historical integrity (§36). Nodes with children cannot be retired.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                setRetireOpen(false)
                retireNode()
              }}
            >
              Retire node
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
