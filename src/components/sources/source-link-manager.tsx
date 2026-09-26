'use client'

/**
 * GlobIQ — Source Link Manager (P2-S3)
 *
 * Attach/detach evidence on a content item (§24 claim/content-level
 * attribution). Item scope follows content:manage on the owning unit's
 * country (§14/§20 — enforced server-side); UNRELIABLE evidence cannot be
 * attached to new content. Links are live provenance metadata — readers see
 * them on the published item immediately.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Link2,
  Link2Off,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react'

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
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'

import type { Envelope, SourceRef } from './source-section'
import { sourceTypeStyle, verificationStyle } from './source-section'

interface AdminUnit {
  id: string
  slug: string
  canonicalName: string
  status: string
  scope: 'GLOBAL' | 'COUNTRY'
  countryIso: string | null
  topic: { slug: string; canonicalName: string }
}

interface AdminItem {
  id: string
  status: string
  format: string
  language: { code: string; name: string }
  title: string
  unit: { slug: string; canonicalName: string; scope: string; countryIso: string | null }
  sourceCount: number
  canEdit: boolean
}

interface ItemLink {
  id: string
  claim: string | null
  linkedAt: string
  source: {
    id: string
    title: string
    publisher: string
    url: string
    type: string
    verification: string
    publishedAt: string | null
    retrievedAt: string
    verifiedAt: string | null
  }
}

interface LinksResult {
  itemId: string
  unit: { slug: string; canonicalName: string }
  format: string
  language: { code: string; name: string }
  links: ItemLink[]
}

const statusStyle: Record<string, string> = {
  DRAFT: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  IN_REVIEW: 'border-amber-200 bg-amber-50 text-amber-700',
  PUBLISHED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  RETIRED: 'border-zinc-300 bg-zinc-100 text-zinc-500',
}

export function SourceLinkManager() {
  const token = useAuth((state) => state.token)
  const { toast } = useToast()

  // Unit search (admin units API — all statuses; provenance can be staged on drafts).
  const [unitQuery, setUnitQuery] = useState('')
  const [units, setUnits] = useState<AdminUnit[] | null>(null)
  const [unitsLoading, setUnitsLoading] = useState(false)
  const [unitSlug, setUnitSlug] = useState<string | null>(null)

  // Items of the selected unit.
  const [items, setItems] = useState<AdminItem[] | null>(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [itemId, setItemId] = useState<string | null>(null)

  // Links of the selected item (query-keyed — React 19 pattern).
  const [linksTick, setLinksTick] = useState(0)
  const [linksState, setLinksState] = useState<{ key: string; data: LinksResult } | null>(null)
  const [linksLoading, setLinksLoading] = useState(false)

  // Source options for the attach form (registry, first page is plenty for dev).
  const [sourceOptions, setSourceOptions] = useState<SourceRef[] | null>(null)

  // Attach form.
  const [attachOpen, setAttachOpen] = useState(false)
  const [attachSourceId, setAttachSourceId] = useState('')
  const [attachClaim, setAttachClaim] = useState('')
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)

  // Inline claim editor.
  const [claimDraft, setClaimDraft] = useState<{ linkId: string; value: string } | null>(null)
  const [claimBusy, setClaimBusy] = useState(false)
  const [unlinkBusy, setUnlinkBusy] = useState<string | null>(null)

  const searchUnits = useCallback(async () => {
    if (!token) return
    setUnitsLoading(true)
    const params = new URLSearchParams({ pageSize: '30' })
    if (unitQuery.trim()) params.set('q', unitQuery.trim())
    try {
      const response = await fetch(`/api/knowledge/admin/units?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ units: AdminUnit[] }>
      setUnits(payload.status === 'ok' && payload.data ? payload.data.units : [])
    } catch {
      setUnits([])
    } finally {
      setUnitsLoading(false)
    }
  }, [token, unitQuery])

  useEffect(() => {
    void searchUnits()
  }, [searchUnits])

  // Items load when a unit is picked.
  useEffect(() => {
    if (!token || !unitSlug) {
      setItems(null)
      return
    }
    let cancelled = false
    setItemsLoading(true)
    setItemId(null)
    async function run() {
      const response = await fetch(
        `/api/content/admin/items?unit=${encodeURIComponent(unitSlug!)}&pageSize=50`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<{ items: AdminItem[] }>
      if (!cancelled) {
        setItems(payload.status === 'ok' && payload.data ? payload.data.items : [])
        setItemsLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, unitSlug])

  // Links load for the selected item (and after each mutation via linksTick).
  useEffect(() => {
    if (!token || !itemId) {
      setLinksState(null)
      return
    }
    let cancelled = false
    setLinksLoading(true)
    async function run() {
      const response = await fetch(`/api/content/admin/items/${itemId}/sources`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<LinksResult>
      if (!cancelled) {
        if (payload.status === 'ok' && payload.data) {
          setLinksState({ key: `${itemId}:${linksTick}`, data: payload.data })
        } else {
          setLinksState(null)
          toast({
            title: 'Could not load citations',
            description: payload.error?.message ?? 'The operation failed',
            variant: 'destructive',
          })
        }
        setLinksLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, itemId, linksTick, toast])

  const links =
    linksState && itemId && linksState.key === `${itemId}:${linksTick}` ? linksState.data : null

  // Registry options for the attach picker.
  useEffect(() => {
    if (!token) return
    let cancelled = false
    async function run() {
      const response = await fetch('/api/content/admin/sources?pageSize=100', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      })
      const payload = (await response.json()) as Envelope<{ sources: SourceRef[] }>
      if (!cancelled) setSourceOptions(payload.status === 'ok' && payload.data ? payload.data.sources : [])
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [token, linksTick])

  const selectedUnit = useMemo(
    () => units?.find((unit) => unit.slug === unitSlug) ?? null,
    [units, unitSlug]
  )
  const selectedItem = useMemo(
    () => items?.find((item) => item.id === itemId) ?? null,
    [items, itemId]
  )

  const apiError = (payload: Envelope<unknown>): string =>
    payload.error?.message ?? 'The operation failed'

  const attachSource = useCallback(async () => {
    if (!token || !itemId || !attachSourceId) return
    setAttachBusy(true)
    setAttachError(null)
    try {
      const response = await fetch(`/api/content/admin/items/${itemId}/sources`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: attachSourceId,
          ...(attachClaim.trim() ? { claim: attachClaim.trim() } : {}),
        }),
      })
      const payload = (await response.json()) as Envelope<{ link: ItemLink }>
      if (payload.status === 'ok') {
        setAttachClaim('')
        setAttachOpen(false)
        setLinksTick((tick) => tick + 1)
        toast({
          title: 'Evidence attached',
          description: attachClaim.trim()
            ? 'Claim-level attribution (§24) — visible on the published item.'
            : 'Content-level attribution (§24) — visible on the published item.',
        })
      } else {
        setAttachError(apiError(payload))
      }
    } catch {
      setAttachError('Network error — please retry.')
    } finally {
      setAttachBusy(false)
    }
  }, [token, itemId, attachSourceId, attachClaim, toast])

  const saveClaim = useCallback(async () => {
    if (!token || !itemId || !claimDraft) return
    setClaimBusy(true)
    try {
      const response = await fetch(
        `/api/content/admin/items/${itemId}/sources/${claimDraft.linkId}`,
        {
          method: 'PATCH',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(claimDraft.value.trim() ? { claim: claimDraft.value.trim() } : { claim: null }),
        }
      )
      const payload = (await response.json()) as Envelope<{ link: ItemLink }>
      if (payload.status === 'ok') {
        setClaimDraft(null)
        setLinksTick((tick) => tick + 1)
        toast({ title: 'Attribution updated' })
      } else {
        toast({ title: 'Could not update', description: apiError(payload), variant: 'destructive' })
      }
    } catch {
      toast({ title: 'Network error', variant: 'destructive' })
    } finally {
      setClaimBusy(false)
    }
  }, [token, itemId, claimDraft, toast])

  const unlink = useCallback(
    async (linkId: string) => {
      if (!token || !itemId) return
      setUnlinkBusy(linkId)
      try {
        const response = await fetch(`/api/content/admin/items/${itemId}/sources/${linkId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })
        const payload = (await response.json()) as Envelope<unknown>
        if (payload.status === 'ok') {
          setLinksTick((tick) => tick + 1)
          toast({
            title: 'Evidence detached',
            description: 'The link is gone; the Source record itself is preserved (§36).',
          })
        } else {
          toast({ title: 'Could not detach', description: apiError(payload), variant: 'destructive' })
        }
      } catch {
        toast({ title: 'Network error', variant: 'destructive' })
      } finally {
        setUnlinkBusy(null)
      }
    },
    [token, itemId, toast]
  )

  return (
    <div className="space-y-4">
      {/* Step 1 — unit search */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-zinc-700">1 · Pick a knowledge unit</p>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void searchUnits()
          }}
        >
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400"
              aria-hidden="true"
            />
            <Input
              value={unitQuery}
              onChange={(event) => setUnitQuery(event.target.value)}
              placeholder="Search units (all statuses)…"
              className="h-8 w-full bg-white pl-8 text-xs"
              aria-label="Search knowledge units"
            />
          </div>
          <Button type="submit" variant="outline" size="sm" className="h-8" disabled={unitsLoading}>
            {unitsLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Search
          </Button>
        </form>
        {units && units.length > 0 && (
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {units.slice(0, 9).map((unit) => (
              <button
                key={unit.id}
                type="button"
                onClick={() => setUnitSlug(unit.slug)}
                className={`min-w-0 rounded-lg border p-2.5 text-left text-xs shadow-sm transition-colors ${
                  unitSlug === unit.slug
                    ? 'border-emerald-400 bg-emerald-50/50'
                    : 'border-zinc-200 bg-white hover:border-emerald-300'
                }`}
              >
                <p className="truncate font-semibold">{unit.canonicalName}</p>
                <p className="mt-0.5 truncate text-[10px] text-zinc-400">
                  {unit.scope === 'GLOBAL' ? 'global' : unit.countryIso} · {unit.status.toLowerCase()}
                  {unit.topic?.slug ? ` · ${unit.topic.slug}` : ''}
                </p>
              </button>
            ))}
          </div>
        )}
        {units && units.length === 0 && !unitsLoading && (
          <p className="text-xs text-zinc-500">No units match the search.</p>
        )}
      </div>

      {/* Step 2 — items of the unit */}
      {selectedUnit && (
        <div className="space-y-2 border-t border-zinc-100 pt-3">
          <p className="text-xs font-semibold text-zinc-700">
            2 · Pick a representation of “{selectedUnit.canonicalName}”
          </p>
          {itemsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : items && items.length > 0 ? (
            <div className="grid max-h-64 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setItemId(item.id === itemId ? null : item.id)}
                  aria-expanded={item.id === itemId}
                  className={`min-w-0 rounded-lg border p-2.5 text-left text-xs shadow-sm transition-colors ${
                    itemId === item.id
                      ? 'border-emerald-400 bg-emerald-50/50'
                      : 'border-zinc-200 bg-white hover:border-emerald-300'
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    <Badge variant="outline" className={`text-[9px] font-normal ${statusStyle[item.status] ?? ''}`}>
                      {item.status}
                    </Badge>
                    <span className="font-mono text-[10px] text-zinc-400">{item.language.code}</span>
                    {item.sourceCount > 0 && (
                      <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[9px] font-normal text-emerald-700">
                        <Link2 className="mr-0.5 h-2.5 w-2.5" aria-hidden="true" />
                        {item.sourceCount}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 truncate font-semibold">{item.title}</p>
                  <p className="truncate text-[10px] text-zinc-400">{item.format.replace(/_/g, ' ').toLowerCase()}</p>
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">No representations of this unit.</p>
          )}
        </div>
      )}

      {/* Step 3 — links of the item */}
      {selectedItem && (
        <div className="space-y-3 border-t border-zinc-100 pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="min-w-0 text-xs font-semibold text-zinc-700">
              3 · Evidence of “{selectedItem.title}”
              <span className="ml-1 font-normal text-zinc-400">
                ({selectedItem.language.code}/{selectedItem.format.replace(/_/g, ' ').toLowerCase()})
              </span>
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setLinksTick((tick) => tick + 1)}
                disabled={linksLoading}
              >
                <RefreshCw className={`h-3 w-3 ${linksLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Refresh
              </Button>
              {selectedItem.canEdit && (
                <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => setAttachOpen((open) => !open)}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Attach evidence
                </Button>
              )}
            </div>
          </div>

          {/* Attach form */}
          {attachOpen && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 space-y-1.5">
                  <UILabel htmlFor="attach-source" className="text-xs text-zinc-500">Source (evidence registry)</UILabel>
                  <Select value={attachSourceId || undefined} onValueChange={setAttachSourceId}>
                    <SelectTrigger id="attach-source" className="h-9 w-full bg-white" aria-label="Pick a source">
                      <SelectValue placeholder={sourceOptions?.length ? 'Pick evidence…' : 'Loading…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(sourceOptions ?? []).map((source) => (
                        <SelectItem key={source.id} value={source.id} disabled={source.verification === 'UNRELIABLE'}>
                          {source.publisher} — {source.title}
                          {source.verification === 'UNVERIFIED' ? ' (unverified)' : ''}
                          {source.verification === 'UNRELIABLE' ? ' (unreliable — refused)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <UILabel htmlFor="attach-claim" className="text-xs text-zinc-500">
                    Claim (optional — §24 claim-level attribution)
                  </UILabel>
                  <Input
                    id="attach-claim"
                    className="bg-white"
                    value={attachClaim}
                    onChange={(event) => setAttachClaim(event.target.value)}
                    placeholder="e.g. The “fourth country” soft-landing claim"
                  />
                </div>
              </div>
              {attachError && <p className="mt-2 text-xs text-red-600">{attachError}</p>}
              <div className="mt-3 flex items-center gap-2">
                <Button size="sm" className="gap-2" onClick={() => void attachSource()} disabled={attachBusy || !attachSourceId}>
                  {attachBusy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}
                  Attach
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAttachOpen(false)} disabled={attachBusy}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Links list */}
          {linksLoading && !links ? (
            <Skeleton className="h-20 w-full" />
          ) : links && links.links.length > 0 ? (
            <ul className="space-y-2" role="list">
              {links.links.map((link) => (
                <li key={link.id} className="rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className={`text-[10px] font-normal ${verificationStyle[link.source.verification] ?? ''}`}>
                      {link.source.verification}
                    </Badge>
                    <Badge variant="outline" className={`text-[10px] font-normal ${sourceTypeStyle[link.source.type] ?? ''}`}>
                      {link.source.type.replace(/_/g, ' ')}
                    </Badge>
                    <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
                      {link.claim ? 'claim-level' : 'content-level'}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-sm font-semibold leading-snug">{link.source.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">
                    {link.source.publisher} · attached {new Date(link.linkedAt).toLocaleDateString()}
                  </p>
                  <a
                    href={link.source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block break-all text-xs font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    {link.source.url}
                  </a>

                  {/* Claim editor + detach */}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {claimDraft?.linkId === link.id ? (
                      <>
                        <Input
                          value={claimDraft.value}
                          onChange={(event) => setClaimDraft({ linkId: link.id, value: event.target.value })}
                          placeholder="What this source supports (empty = content-level)"
                          className="h-8 min-w-0 flex-1 bg-white text-xs"
                          aria-label="Edit claim"
                        />
                        <Button size="sm" className="h-7 text-xs" onClick={() => void saveClaim()} disabled={claimBusy}>
                          {claimBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : 'Save'}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setClaimDraft(null)} disabled={claimBusy}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        {link.claim && (
                          <p className="min-w-0 flex-1 truncate text-xs italic text-zinc-500">claim: {link.claim}</p>
                        )}
                        {selectedItem.canEdit && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="ml-auto h-7 text-xs"
                              onClick={() => setClaimDraft({ linkId: link.id, value: link.claim ?? '' })}
                            >
                              <ChevronRight className="mr-1 h-3 w-3" aria-hidden="true" />
                              {link.claim ? 'Edit claim' : 'Add claim'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 border-red-200 text-xs text-red-600 hover:bg-red-50"
                              onClick={() => void unlink(link.id)}
                              disabled={unlinkBusy !== null}
                            >
                              {unlinkBusy === link.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                              ) : (
                                <Link2Off className="h-3.5 w-3.5" aria-hidden="true" />
                              )}
                              Detach
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-start gap-2 rounded-md border border-dashed border-zinc-300 px-3 py-4 text-xs text-zinc-500">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
              No evidence attached yet — attach a source from the registry to give readers §24 provenance.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
