'use client'

/**
 * GlobIQ — Unit View (P4-S2)
 *
 * The in-app §22 knowledge page: the existing P2-S5/P3-S5 reader component
 * (KnowledgePageView) wrapped in the app chrome — a back-to-topic bar and
 * the §16 canonical path. Reached from homepage/landing/search cards via
 * the hash router (#/gk/{topic}/{unit}/) and from the reader's own related
 * concepts; `onOpenUnit` resolves the target unit's topic first (the §16
 * path needs the topic segment) through the public unit detail API.
 */
import { ArrowLeft } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { KnowledgePageView } from '@/components/reader/knowledge-page-view'
import type { Envelope } from './types'

export interface UnitViewProps {
  topicSlug: string
  unitSlug: string
  country: string
  language: string
  onOpenTopic: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onSwitchLanguage: (code: string) => void
}

interface UnitDetail {
  slug: string
  topic: { slug: string }
}

export function UnitView({
  topicSlug,
  unitSlug,
  country,
  language,
  onOpenTopic,
  onOpenUnit,
  onSwitchLanguage,
}: UnitViewProps) {
  // The topic of a related unit opened from inside the reader is resolved
  // through the public unit API — the §16 path needs the topic segment.
  const handleOpenUnit = async (slug: string) => {
    if (slug === unitSlug) return
    try {
      const response = await fetch(
        `/api/knowledge/units/${encodeURIComponent(slug)}?country=${country}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<UnitDetail>
      if (payload.status === 'ok' && payload.data?.topic?.slug) {
        onOpenUnit(payload.data.topic.slug, slug)
        return
      }
    } catch {
      // fall through to opening under the current topic
    }
    onOpenUnit(topicSlug, slug)
  }

  return (
    <div className="space-y-4">
      {/* Back to the topic hub (§16: the unit lives under …/gk/{topic}/) */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-1.5 px-2 text-zinc-500 hover:text-zinc-900"
          onClick={() => onOpenTopic(topicSlug)}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to the topic hub
        </Button>
        <p className="font-mono text-[11px] text-zinc-400" aria-label="Canonical path">
          #/gk/{topicSlug}/{unitSlug}/
        </p>
      </div>

      <KnowledgePageView
        unitRef={unitSlug}
        country={country}
        language={language}
        onOpenUnit={(slug) => void handleOpenUnit(slug)}
        onSwitchLanguage={onSwitchLanguage}
      />
    </div>
  )
}
