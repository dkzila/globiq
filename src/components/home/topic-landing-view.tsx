'use client'

/**
 * GlobIQ — Topic Landing View (P4-S2, Master Plan §33/§16)
 *
 * The indexable topic hub at …/gk/{topic-slug}/, rendered from
 * GET /api/topics/{slug}: breadcrumb, header, §33 cluster children, the
 * topic's own units (paginated), the exams that need units from this
 * subtree (§8/§36 — computed, never stored) and §33 sibling internal links.
 * Every §16 path ships as data; in-app navigation goes through the hash
 * router with the same segment grammar.
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  FolderTree,
  GraduationCap,
  Hash,
  Layers,
  Link2,
  RefreshCw,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import type { Envelope, HomeUnitCard, TopicLanding } from './types'

// ---------- Props ----------

export interface TopicLandingViewProps {
  slug: string
  countryIso: string
  language: string
  page: number
  onPageChange: (page: number) => void
  onOpenTopic: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onGoHome: () => void
}

// ---------- Component ----------

export function TopicLandingView({
  slug,
  countryIso,
  language,
  page,
  onPageChange,
  onOpenTopic,
  onOpenUnit,
  onGoHome,
}: TopicLandingViewProps) {
  const [landing, setLanding] = useState<TopicLanding | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const fetchLanding = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotFound(false)
    try {
      const response = await fetch(
        `/api/topics/${encodeURIComponent(slug)}?country=${countryIso}&language=${language}&page=${page}&pageSize=10`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<TopicLanding>
      if (payload.status === 'ok' && payload.data) {
        setLanding(payload.data)
      } else if (response.status === 404) {
        setNotFound(true)
      } else {
        setError(payload.error?.message ?? 'Could not load this topic')
      }
    } catch {
      setError('Could not reach the topic service')
    } finally {
      setLoading(false)
    }
  }, [slug, countryIso, language, page])

  useEffect(() => {
    void fetchLanding()
  }, [fetchLanding, reloadKey])

  // ---------- Loading / error states ----------

  if (loading && !landing) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading topic">
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-10 w-96" />
        <div className="grid gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-40 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (notFound) {
    return (
      <Card className="border-zinc-200 bg-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-amber-500" aria-hidden="true" />
            Topic not available here
          </CardTitle>
          <CardDescription>
            “{slug}” does not exist, or is not available in the selected country. Country scope is
            enforced server-side — browse the homepage categories for what this market offers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="sm" className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" onClick={onGoHome}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Back to the homepage
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (error && !landing) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Topic unavailable</CardTitle>
          <CardDescription className="text-red-700">{error}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 border-red-200 bg-white text-red-700 hover:bg-red-50"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!landing) return null

  const { pagination } = landing.units
  const isDomain = landing.topic.type === 'DOMAIN'

  return (
    <div className="space-y-8">
      {/* ---------- Breadcrumb (§16 — every crumb is a real path) ---------- */}
      <nav aria-label="Breadcrumb" className="overflow-x-auto">
        <ol className="flex flex-wrap items-center gap-1.5 text-sm">
          {landing.breadcrumb.map((crumb, index) => {
            const isLast = index === landing.breadcrumb.length - 1
            return (
              <li key={crumb.slug ?? 'home'} className="flex items-center gap-1.5">
                {index > 0 && <span className="text-zinc-300" aria-hidden="true">/</span>}
                {isLast ? (
                  <span aria-current="page" className="font-medium text-zinc-900">
                    {crumb.name}
                  </span>
                ) : crumb.slug === null ? (
                  <button
                    type="button"
                    onClick={onGoHome}
                    className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
                  >
                    {crumb.name}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onOpenTopic(crumb.slug!)}
                    className="min-h-[32px] text-zinc-500 transition-colors hover:text-emerald-700"
                  >
                    {crumb.name}
                  </button>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      {/* ---------- Header ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        aria-labelledby="topic-heading"
        className="space-y-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            {isDomain ? 'GK category' : landing.topic.type.toLowerCase()}
          </Badge>
          {landing.topic.scope === 'COUNTRY' && (
            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
              {landing.topic.countryIso ?? ''}-scoped
            </Badge>
          )}
          <Badge variant="outline" className="border-zinc-200 bg-white font-mono text-xs font-normal text-zinc-400">
            {landing.canonicalPath}
          </Badge>
        </div>
        <h1 id="topic-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {landing.topic.label}
        </h1>
        {landing.topic.description && (
          <p className="max-w-2xl text-base text-zinc-600">{landing.topic.description}</p>
        )}
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{landing.stats.unitCount}</strong>
            <span className="text-zinc-500">units in scope</span>
          </span>
          {landing.stats.topicCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
              <FolderTree className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <strong className="font-semibold">{landing.stats.topicCount}</strong>
              <span className="text-zinc-500">subtopics</span>
            </span>
          )}
          {landing.exams.available && landing.stats.examCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
              <GraduationCap className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
              <strong className="font-semibold">{landing.stats.examCount}</strong>
              <span className="text-zinc-500">exams need this</span>
            </span>
          )}
        </div>
      </motion.section>

      {/* ---------- §33 cluster children ---------- */}
      {landing.children.length > 0 && (
        <section aria-labelledby="children-heading" className="space-y-4">
          <h2 id="children-heading" className="text-xl font-semibold tracking-tight">
            Inside this topic
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {landing.children.map((child) => (
              <button
                key={child.slug}
                type="button"
                onClick={() => onOpenTopic(child.slug)}
                className="group flex min-h-[44px] flex-col items-start gap-1.5 rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900 group-hover:text-emerald-700">
                    {child.name}
                  </p>
                  <ArrowRight className="h-4 w-4 shrink-0 text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600" aria-hidden="true" />
                </div>
                <p className="text-xs text-zinc-500">
                  {child.unitCount} {child.unitCount === 1 ? 'unit' : 'units'}
                  {child.topicCount > 0 ? ` · ${child.topicCount} subtopics` : ''}
                </p>
                <p className="mt-auto pt-1 font-mono text-[10px] text-zinc-300 group-hover:text-emerald-500">
                  {child.canonicalPath}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- Units directly on this topic ---------- */}
      <section aria-labelledby="units-heading" className="space-y-4">
        <h2 id="units-heading" className="text-xl font-semibold tracking-tight">
          Knowledge units
        </h2>
        {pagination.total === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="flex items-start gap-3 p-5">
              <Layers className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
              <p className="text-sm text-zinc-600">
                {landing.children.length > 0
                  ? 'Units live in the subtopics above — open one to read its knowledge.'
                  : 'No knowledge units are published for this topic yet.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {landing.units.items.map((unit) => (
                <UnitCard
                  key={unit.slug}
                  unit={unit}
                  readerLanguage={language}
                  onOpenUnit={onOpenUnit}
                />
              ))}
            </div>
            {pagination.totalPages > 1 && (
              <nav aria-label="Units pagination" className="flex items-center justify-between gap-3">
                <p className="text-xs text-zinc-500">
                  Page {pagination.page} of {pagination.totalPages} · {pagination.total} units
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1 border-zinc-200 bg-white"
                    disabled={pagination.page <= 1}
                    onClick={() => onPageChange(pagination.page - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 gap-1 border-zinc-200 bg-white"
                    disabled={pagination.page >= pagination.totalPages}
                    onClick={() => onPageChange(pagination.page + 1)}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            )}
          </>
        )}
      </section>

      {/* ---------- §8 exams needing this topic (computed) ---------- */}
      <section aria-labelledby="topic-exams-heading" className="space-y-4">
        <h2 id="topic-exams-heading" className="text-xl font-semibold tracking-tight">
          Exams that need this topic
        </h2>
        {!landing.exams.available ? (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-amber-800">
                Exam mappings publish when this market launches — until then the knowledge above is
                available to everyone.
              </p>
            </CardContent>
          </Card>
        ) : landing.exams.items.length === 0 ? (
          <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
            <CardContent className="p-5">
              <p className="text-sm text-zinc-600">
                No current syllabus maps units from this topic yet.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {landing.exams.items.map((exam) => (
              <Card key={exam.slug} className="border-zinc-200 bg-white shadow-sm">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm leading-snug">{exam.name}</CardTitle>
                    <Badge
                      variant="outline"
                      className="shrink-0 border-zinc-200 bg-zinc-50 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                    >
                      {exam.level.toLowerCase()}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    {exam.organiser} · {exam.code}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  <p className="text-xs text-zinc-500">
                    <strong className="font-semibold text-zinc-700">{exam.mappedUnitCount}</strong>{' '}
                    {exam.mappedUnitCount === 1 ? 'unit' : 'units'} from this topic in the current
                    syllabus
                  </p>
                  <p className="font-mono text-[10px] text-zinc-300">{exam.canonicalPath}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------- §33 internal links — siblings ---------- */}
      {landing.relatedTopics.length > 0 && (
        <section aria-labelledby="related-heading" className="space-y-4">
          <h2 id="related-heading" className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Link2 className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            Related topics
          </h2>
          <div className="flex flex-wrap gap-2">
            {landing.relatedTopics.map((topic) => (
              <button
                key={topic.slug}
                type="button"
                onClick={() => onOpenTopic(topic.slug)}
                className="group inline-flex min-h-[40px] items-center gap-2 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-sm shadow-sm transition-all hover:border-emerald-300 hover:shadow"
              >
                <Hash className="h-3.5 w-3.5 text-zinc-300 group-hover:text-emerald-500" aria-hidden="true" />
                <span className="font-medium text-zinc-800 group-hover:text-emerald-700">
                  {topic.name}
                </span>
                <span className="text-xs text-zinc-400">{topic.unitCount}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------- Unit card (same shape as the homepage card) ----------

function UnitCard({
  unit,
  readerLanguage,
  onOpenUnit,
}: {
  unit: HomeUnitCard
  readerLanguage: string
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
}) {
  const canonicalFallback =
    unit.summary.source === 'CANONICAL_SUMMARY' && unit.summary.language !== readerLanguage

  return (
    <Card className="group flex cursor-pointer flex-col border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
      <button
        type="button"
        onClick={() => onOpenUnit(unit.topic.slug, unit.slug)}
        className="flex h-full flex-col text-left"
        aria-label={`Open ${unit.canonicalName}`}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm leading-snug group-hover:text-emerald-700">
            {unit.canonicalName}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <Badge variant="outline" className="border-zinc-200 bg-zinc-50 text-[10px] font-normal text-zinc-500">
              {unit.type.replace(/_/g, ' ').toLowerCase()}
            </Badge>
            {unit.examCount > 0 && (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-normal text-emerald-700">
                <GraduationCap className="mr-1 h-3 w-3" aria-hidden="true" />
                {unit.examCount} {unit.examCount === 1 ? 'exam' : 'exams'}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col gap-2">
          <p className="line-clamp-3 text-sm leading-relaxed text-zinc-600">{unit.summary.text}</p>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              <BookOpen className="h-3 w-3" aria-hidden="true" />
              {unit.topic.name}
            </span>
            {canonicalFallback && (
              <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-400">
                English summary
              </Badge>
            )}
          </div>
          <p className="font-mono text-[10px] text-zinc-300 group-hover:text-emerald-500">
            {unit.canonicalPath}
          </p>
        </CardContent>
      </button>
    </Card>
  )
}
