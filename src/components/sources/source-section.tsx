'use client'

/**
 * GlobIQ — Source Section (P2-S3)
 *
 * Section shell for the §24 Source & Trust Model on the foundation page:
 * the evidence Registry (source:manage — records, verification workflow) and
 * the per-item Link manager (content:manage — claim/content-level citations).
 * Provenance itself is public: readers see sources on published content in
 * the Content section above (§24 — provenance rides the content object).
 */
import { useState } from 'react'
import { BookMarked, Link2, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuth } from '@/stores/auth'
import { SourceLinkManager } from './source-link-manager'
import { SourceRegistry } from './source-registry'

export interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: { [field: string]: string[] } }
}

export interface SourceRef {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: 'UNVERIFIED' | 'VERIFIED' | 'UNRELIABLE'
  publishedAt: string | null
  retrievedAt: string
  verifiedAt: string | null
  notes?: string | null
  createdAt?: string
  updatedAt?: string
  usageCount?: number
  allowedTransitions?: string[]
}

export const verificationStyle: Record<string, string> = {
  UNVERIFIED: 'border-zinc-200 bg-zinc-50 text-zinc-600',
  VERIFIED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  UNRELIABLE: 'border-red-200 bg-red-50 text-red-700',
}

export const sourceTypeStyle: Record<string, string> = {
  OFFICIAL: 'border-teal-200 bg-teal-50 text-teal-700',
  NEWS_MEDIA: 'border-orange-200 bg-orange-50 text-orange-700',
  INSTITUTIONAL: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  ACADEMIC: 'border-violet-200 bg-violet-50 text-violet-700',
  DATA: 'border-lime-200 bg-lime-50 text-lime-700',
  OTHER: 'border-zinc-200 bg-zinc-100 text-zinc-600',
}

export function SourceSection() {
  const canManageSources = useAuth((state) => state.permissions.includes('source:manage'))
  const canManageContent = useAuth((state) => state.permissions.includes('content:manage'))
  const privileged = canManageSources || canManageContent
  const [tab, setTab] = useState<'registry' | 'links'>('registry')

  return (
    <section aria-labelledby="sources-heading" className="mt-10 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookMarked className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          <h2 id="sources-heading" className="text-xl font-semibold tracking-tight">
            Sources &amp; provenance — the trust model
          </h2>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
          §24 · evidence · verification · attribution
        </Badge>
      </div>
      <p className="max-w-3xl text-sm text-zinc-600">
        Every factual content object carries provenance (§24): <span className="font-medium text-zinc-800">publisher,
        URL, publication + retrieved dates, source category</span> and an{' '}
        <span className="font-medium text-zinc-800">editor verification state</span>. Citations are
        claim-level or content-level, evidence is deduplicated by URL, and nothing is ever
        hard-deleted — revoked trust is <span className="font-medium text-zinc-800">marked</span>,
        preserved as history (§36).
      </p>

      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Editorial evidence</CardTitle>
          <CardDescription>
            AI-assisted drafts carry their provenance flag onto every published revision (§26); the
            review workflow stays human-controlled.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!privileged ? (
            <div className="space-y-2">
              <p className="rounded-md border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500">
                Source management requires an editorial role (ADMIN / COUNTRY_ADMIN). Provenance
                itself is public — open any published item in the Content section above to see its
                sources and verification states.
              </p>
            </div>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1" role="tablist" aria-label="Source views">
                {canManageSources && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'registry'}
                    onClick={() => setTab('registry')}
                    className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                      tab === 'registry' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                    }`}
                  >
                    <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                    Registry
                  </button>
                )}
                {canManageContent && (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab === 'links'}
                    onClick={() => setTab('links')}
                    className={`flex min-h-[36px] flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors sm:flex-none sm:px-5 ${
                      tab === 'links' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
                    }`}
                  >
                    <Link2 className="h-4 w-4" aria-hidden="true" />
                    Link manager
                  </button>
                )}
              </div>

              {!canManageSources && tab === 'registry' ? (
                <Skeleton className="h-40 w-full" />
              ) : !canManageContent && tab === 'links' ? (
                <Skeleton className="h-40 w-full" />
              ) : tab === 'registry' ? (
                <SourceRegistry />
              ) : (
                <SourceLinkManager />
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
