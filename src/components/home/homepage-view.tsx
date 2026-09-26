'use client'

/**
 * GlobIQ — Country Homepage View (P4-S2, Master Plan §34)
 *
 * The country's GK/current-affairs index and discovery hub, rendered from
 * GET /api/home: GK categories (§13 domains), major topics, the exam
 * directory (§36 CURRENT versions), popular knowledge (§22 quick-fact
 * resolution with honest §35 fallback), the current-affairs quiet state
 * (P6), the §17 search entry, the §35 language switcher and the
 * personalised entry point (anonymous-first per §34; personalisation
 * itself arrives in P5 — rendered honestly, never faked).
 */
import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BookOpen,
  Clock3,
  FlaskConical,
  Globe2,
  GraduationCap,
  Landmark,
  Languages,
  Loader2,
  Newspaper,
  RefreshCw,
  Rocket,
  Signpost,
  Trophy,
  Users,
} from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

import { SearchBox } from './search-box'
import type { CountryHomepage, Envelope, HomeUnitCard } from './types'

// ---------- Constants ----------

const CATEGORY_ICONS = [Landmark, Globe2, FlaskConical, Newspaper, Trophy, Users] as const

const DIFFICULTY_STYLES: Record<string, string> = {
  BASIC: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  INTERMEDIATE: 'border-amber-200 bg-amber-50 text-amber-700',
  ADVANCED: 'border-rose-200 bg-rose-50 text-rose-700',
}

// ---------- Props ----------

export interface HomepageViewProps {
  countryIso: string
  language: string
  onOpenTopic: (slug: string) => void
  onOpenUnit: (topicSlug: string, unitSlug: string) => void
  onSwitchLanguage: (code: string) => void
  onSignIn: () => void
}

// ---------- Component ----------

export function HomepageView({
  countryIso,
  language,
  onOpenTopic,
  onOpenUnit,
  onSwitchLanguage,
  onSignIn,
}: HomepageViewProps) {
  const [homepage, setHomepage] = useState<CountryHomepage | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  const auth = useAuth()

  const fetchHomepage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/home?country=${countryIso}&language=${language}`,
        { cache: 'no-store' }
      )
      const payload = (await response.json()) as Envelope<CountryHomepage>
      if (payload.status === 'ok' && payload.data) {
        setHomepage(payload.data)
      } else {
        setError(payload.error?.message ?? 'Could not load the homepage')
      }
    } catch {
      setError('Could not reach the homepage service')
    } finally {
      setLoading(false)
    }
  }, [countryIso, language])

  useEffect(() => {
    void fetchHomepage()
  }, [fetchHomepage, reloadKey])

  // ---------- Loading / error states ----------

  if (loading && !homepage) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="Loading homepage">
        <div className="space-y-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="h-10 w-full max-w-xl" />
          <Skeleton className="h-11 w-full max-w-2xl" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-44 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    )
  }

  if (error && !homepage) {
    return (
      <Card className="border-red-200 bg-red-50/60">
        <CardHeader>
          <CardTitle className="text-base text-red-800">Homepage unavailable</CardTitle>
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

  if (!homepage) return null

  const comingSoon = homepage.country.status === 'COMING_SOON'
  const readerLanguage = homepage.language.code

  return (
    <div
      dir={homepage.language.direction === 'RTL' ? 'rtl' : 'ltr'}
      className="space-y-10"
    >
      {/* ---------- Hero (§34 — the country's discovery hub) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        aria-labelledby="home-heading"
        className="space-y-4"
      >
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Master Plan v2.0</Badge>
          {comingSoon ? (
            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
              <Rocket className="mr-1 h-3 w-3" aria-hidden="true" />
              Coming soon
            </Badge>
          ) : (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
              Live market
            </Badge>
          )}
          <Badge variant="outline" className="border-zinc-200 bg-white font-mono text-xs font-normal text-zinc-500">
            {homepage.canonicalUrl}
          </Badge>
        </div>

        <h1 id="home-heading" className="text-3xl font-bold tracking-tight sm:text-4xl">
          {homepage.country.name}&rsquo;s{' '}
          <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
            GK &amp; exam knowledge
          </span>{' '}
          hub
        </h1>
        <p className="max-w-2xl text-base text-zinc-600 sm:text-lg">
          {comingSoon
            ? `GlobIQ ${homepage.country.name} launches soon. Until then, explore the global knowledge base — every topic below is available to browse today.`
            : `One canonical knowledge system for ${homepage.country.name}: evergreen GK, exam-mapped syllabi and current affairs — search it, browse it, or walk any exam's syllabus.`}
        </p>

        {/* Hub stats */}
        <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <Signpost className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{homepage.stats.topics}</strong>
            <span className="text-zinc-500">topics</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <BookOpen className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{homepage.stats.units}</strong>
            <span className="text-zinc-500">knowledge units</span>
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-1.5">
            <GraduationCap className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            <strong className="font-semibold">{homepage.stats.exams}</strong>
            <span className="text-zinc-500">{comingSoon ? 'exams at launch' : 'exams'}</span>
          </span>
        </div>

        {/* §17 search entry */}
        <SearchBox
          country={countryIso}
          language={language}
          onOpenTopic={onOpenTopic}
          onOpenUnit={onOpenUnit}
        />

        {/* §35 language switcher — only this country's languages */}
        {homepage.languages.length > 1 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-zinc-400">
              <Languages className="h-3.5 w-3.5" aria-hidden="true" />
              Read in
            </span>
            {homepage.languages.map((entry) => (
              <button
                key={entry.code}
                type="button"
                onClick={() => onSwitchLanguage(entry.code)}
                aria-current={entry.code === readerLanguage ? 'true' : undefined}
                className={`min-h-[36px] rounded-full border px-3 py-1 text-sm transition-colors ${
                  entry.code === readerLanguage
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300 hover:text-emerald-700'
                }`}
              >
                {entry.nativeName ?? entry.name}
              </button>
            ))}
          </div>
        )}
      </motion.section>

      {/* ---------- Personalised entry (§34 — anonymous-first) ---------- */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.05 }}
        aria-labelledby="personal-heading"
      >
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-teal-50/50">
          <CardContent className="flex flex-col items-start justify-between gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
            <div className="space-y-1">
              <h2 id="personal-heading" className="text-base font-semibold tracking-tight">
                {auth.status === 'authenticated'
                  ? `Welcome back${auth.user?.name ? `, ${auth.user.name.split(' ')[0]}` : ''}`
                  : 'Make it yours'}
              </h2>
              <p className="max-w-xl text-sm text-zinc-600">
                {auth.status === 'authenticated'
                  ? 'Your combined-exam queue, followed topics and due revisions arrive with the personalisation system — for now, your account keeps your sessions and editorial access.'
                  : 'Create a free account to follow topics, save knowledge and build your exam queue — personalisation arrives with the follow/save system.'}
              </p>
            </div>
            {auth.status === 'authenticated' ? (
              <Badge variant="outline" className="shrink-0 border-emerald-300 bg-white text-emerald-700">
                Signed in as {auth.user?.email}
              </Badge>
            ) : (
              <Button
                className="shrink-0 gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
                onClick={onSignIn}
              >
                Sign in / Register
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </CardContent>
        </Card>
      </motion.section>

      {/* ---------- §34 GK categories ---------- */}
      {homepage.categories.length > 0 && (
        <section aria-labelledby="categories-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="categories-heading" className="text-xl font-semibold tracking-tight">
              GK categories
            </h2>
            <p className="text-xs text-zinc-400">The global framework, scoped to {homepage.country.name}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {homepage.categories.map((category, index) => {
              const Icon = CATEGORY_ICONS[index % CATEGORY_ICONS.length]
              return (
                <Card
                  key={category.slug}
                  className="group cursor-pointer border-zinc-200 shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                >
                  <button
                    type="button"
                    onClick={() => onOpenTopic(category.slug)}
                    className="h-full w-full text-left"
                    aria-label={`Open ${category.name}`}
                  >
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                        </span>
                        <ArrowRight className="h-4 w-4 text-zinc-300 transition-all group-hover:translate-x-0.5 group-hover:text-emerald-600" aria-hidden="true" />
                      </div>
                      <CardTitle className="mt-2 text-base">{category.name}</CardTitle>
                      <CardDescription className="line-clamp-2 text-xs">
                        {category.description ?? 'Evergreen knowledge hub.'}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center gap-3 text-xs text-zinc-500">
                        <span>
                          <strong className="font-semibold text-zinc-700">{category.topicCount}</strong>{' '}
                          topics
                        </span>
                        <span>
                          <strong className="font-semibold text-zinc-700">{category.unitCount}</strong>{' '}
                          units
                        </span>
                      </div>
                      {category.children.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {category.children.slice(0, 3).map((child) => (
                            <span
                              key={child.slug}
                              className="inline-flex max-w-full items-center rounded-full border border-zinc-100 bg-zinc-50 px-2 py-0.5 text-[11px] text-zinc-600"
                            >
                              <span className="truncate">{child.name}</span>
                              <span className="ml-1 text-zinc-400">{child.unitCount}</span>
                            </span>
                          ))}
                        </div>
                      )}
                      <p className="font-mono text-[10px] text-zinc-300 group-hover:text-emerald-500">
                        {category.canonicalPath}
                      </p>
                    </CardContent>
                  </button>
                </Card>
              )
            })}
          </div>
        </section>
      )}

      {/* ---------- §34 major topics ---------- */}
      {homepage.majorTopics.length > 0 && (
        <section aria-labelledby="major-heading" className="space-y-4">
          <h2 id="major-heading" className="text-xl font-semibold tracking-tight">
            Major topics
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {homepage.majorTopics.map((topic) => (
              <button
                key={topic.slug}
                type="button"
                onClick={() => onOpenTopic(topic.slug)}
                className="group flex min-h-[44px] flex-col items-start gap-1.5 rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-zinc-900 group-hover:text-emerald-700">
                    {topic.name}
                  </p>
                  <Badge variant="secondary" className="shrink-0 font-normal">
                    {topic.unitCount} {topic.unitCount === 1 ? 'unit' : 'units'}
                  </Badge>
                </div>
                <p className="text-xs text-zinc-500">
                  {topic.path.map((entry) => entry.name).join(' › ')}
                </p>
                <p className="mt-auto pt-1 font-mono text-[10px] text-zinc-300 group-hover:text-emerald-500">
                  {topic.canonicalPath}
                </p>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- §34 exams ---------- */}
      <section aria-labelledby="exams-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="exams-heading" className="text-xl font-semibold tracking-tight">
            Exams
          </h2>
          {!comingSoon && homepage.exams.items.length > 0 && (
            <p className="text-xs text-zinc-400">Current syllabi, mapped to canonical knowledge</p>
          )}
        </div>

        {!homepage.exams.available ? (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardContent className="flex items-start gap-3 p-5">
              <Rocket className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-amber-900">
                  {homepage.country.name} exams arrive at launch
                </p>
                <p className="text-sm text-amber-800">
                  Exam definitions, versioned syllabi and mappings are country-scoped — they publish
                  when this market goes live. The global knowledge below is available today.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : homepage.exams.items.length === 0 ? (
          <Card className="border-zinc-200 bg-white">
            <CardContent className="flex items-start gap-3 p-5">
              <GraduationCap className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
              <p className="text-sm text-zinc-600">
                No exams are published for {homepage.country.name} yet — the exam directory fills
                as syllabi are mapped.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {homepage.exams.items.map((exam) => (
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
                <CardContent className="space-y-2">
                  {exam.currentVersion ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Badge variant="secondary" className="font-normal">
                        <Clock3 className="mr-1 h-3 w-3" aria-hidden="true" />
                        {exam.currentVersion.label}
                      </Badge>
                      <span className="text-zinc-500">
                        {exam.mappingCount} mapped{' '}
                        {exam.mappingCount === 1 ? 'requirement' : 'requirements'}
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-400">No syllabus version in effect yet.</p>
                  )}
                  <p className="font-mono text-[10px] text-zinc-300">{exam.canonicalPath}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* ---------- §34 popular knowledge ---------- */}
      {homepage.popularUnits.length > 0 && (
        <section aria-labelledby="popular-heading" className="space-y-4">
          <h2 id="popular-heading" className="text-xl font-semibold tracking-tight">
            Popular knowledge
          </h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {homepage.popularUnits.map((unit) => (
              <UnitCard
                key={unit.slug}
                unit={unit}
                readerLanguage={readerLanguage}
                onOpenUnit={onOpenUnit}
              />
            ))}
          </div>
        </section>
      )}

      {/* ---------- §34 current affairs (honest quiet state until P6) ---------- */}
      <section aria-labelledby="current-affairs-heading" className="space-y-4">
        <h2 id="current-affairs-heading" className="text-xl font-semibold tracking-tight">
          Current affairs
        </h2>
        <Card className="border-dashed border-zinc-300 bg-zinc-50/60">
          <CardContent className="flex flex-col items-start justify-between gap-3 p-5 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <Newspaper className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" aria-hidden="true" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-zinc-800">The event feed is on its way</p>
                <p className="max-w-xl text-sm text-zinc-500">{homepage.currentAffairs.note}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-2 border-zinc-300 bg-white hover:border-emerald-300 hover:text-emerald-700"
              onClick={() => onOpenTopic('current-affairs')}
            >
              Browse the category
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

// ---------- Unit card ----------

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
            <Badge
              variant="outline"
              className={`text-[10px] font-normal ${DIFFICULTY_STYLES[unit.difficulty] ?? 'border-zinc-200 bg-zinc-50 text-zinc-500'}`}
            >
              {unit.difficulty.toLowerCase()}
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
