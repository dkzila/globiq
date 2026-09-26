'use client'

/**
 * GlobIQ — Combined-Exam Engine section (P3-S4)
 *
 * Master Plan §11 (the multi-exam combination engine — the mechanism that
 * solves "RRB Group D + MP Police Constable at the same time"), §46.3 (a
 * computed union, never a stored duplicate — this UI renders a live
 * computation, nothing persists), §8 (the depth ladder; the union takes the
 * MAXIMUM required depth per unit), §13 (exams reach knowledge exclusively
 * through SyllabusNode → ExamMapping), §14 (country scope enforced
 * server-side), §16 (knowledge-page paths shipped as data), §35 (topic
 * labels per language), §37 (client-agnostic API contract) and Appendix A
 * ("the user receives the deeper version once, with a coverage badge showing
 * both exams" — the UI must say "Covers: Exam A + Exam B" and tag single-
 * exam units "… only", never presenting the same knowledge twice).
 *
 * Until P5-S1 wires follows, the exam set is picked here explicitly —
 * single-exam mode is the same call with one exam (§11, no additional data
 * modeling).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  BadgeCheck,
  Combine,
  Info,
  Layers3,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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

// ---------- API envelope + DTO mirrors (§37 client-agnostic contract) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface CountryRef {
  isoCode: string
  name: string
  status: string
  isDefault: boolean
  defaultLanguage: { code: string; name: string }
  languages: Array<{ code: string; name: string; nativeName: string | null }>
}

interface PublicExamRef {
  id: string
  slug: string
  name: string
  code: string
  currentVersion: { id: string; label: string } | null
}

type Depth = 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
type Priority = 'CORE' | 'SUPPORTING' | 'LOW'
type Likelihood = 'HIGH' | 'MEDIUM' | 'LOW'

interface CoveringDto {
  exam: { slug: string; name: string; code: string }
  node: {
    name: string
    depth: number
    topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  }
  requiredDepth: Depth
  priority: Priority
  relevance: string
  questionLikelihood: Likelihood
  expectedScope: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
}

interface QueueUnitDto {
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
  questionLikelihood: Likelihood
  exams: Array<{ slug: string; name: string; code: string }>
  examCount: number
  isShared: boolean
  coverings: CoveringDto[]
  latestEffectiveFrom: string | null
}

interface ResolutionDto {
  exam: { id: string; slug: string; name: string; code: string; level: string }
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  note: string | null
  unitCount: number
  mappingCount: number
}

interface CombinedDto {
  exams: ResolutionDto[]
  units: QueueUnitDto[]
  stats: {
    examCount: number
    unitCount: number
    mappingCount: number
    sharedUnitCount: number
    duplicatesAvoided: number
  }
  language: { code: string; name: string; nativeName: string | null }
  computedAt: string
}

// ---------- Presentation helpers (mirrors the mapping section vocabulary) ----------

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

const PRIORITY_LABEL: Record<Priority, string> = {
  CORE: 'Core',
  SUPPORTING: 'Supporting',
  LOW: 'Low priority',
}

const LIKELIHOOD_LABEL: Record<Likelihood, string> = {
  HIGH: 'Often asked',
  MEDIUM: 'Sometimes asked',
  LOW: 'Rarely asked',
}

const fmtDay = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')

/** §11 step 9 — the exact badge wording the UI must say. */
function coversLabel(unit: QueueUnitDto): string {
  const codes = unit.exams.map((exam) => exam.code)
  return unit.isShared ? `Covers: ${codes.join(' + ')}` : `${codes[0] ?? '—'} only`
}

function coversTitle(unit: QueueUnitDto): string {
  return unit.exams.map((exam) => exam.name).join(' + ')
}

// ---------- Component ----------

export function CombinedSection() {
  const { toast } = useToast()

  const [countries, setCountries] = useState<CountryRef[]>([])
  const [countryIso, setCountryIso] = useState('IN')
  const [language, setLanguage] = useState('en')

  const [exams, setExams] = useState<PublicExamRef[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [combined, setCombined] = useState<CombinedDto | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)

  const fetchSeq = useRef(0)

  const selectedCountry = countries.find((country) => country.isoCode === countryIso)

  // ---------- Country directory (once) ----------
  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: CountryRef[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          const active = payload.data.countries.filter((country) => country.status === 'ACTIVE')
          setCountries(active)
          if (!active.some((country) => country.isoCode === countryIso)) {
            setCountryIso(active[0]?.isoCode ?? 'IN')
          }
        }
      })
      .catch(() => undefined)
  }, [])

  // ---------- Country change → exam directory + reset ----------
  useEffect(() => {
    if (!selectedCountry) return
    setLanguage(selectedCountry.defaultLanguage.code)
    let cancelled = false
    fetch(`/api/exams?country=${countryIso}&pageSize=50`, { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ exams: PublicExamRef[] }>) => {
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setExams(payload.data.exams)
        } else {
          setExams([])
        }
      })
      .catch(() => {
        if (!cancelled) setExams([])
      })
    return () => {
      cancelled = true
    }
  }, [countryIso, selectedCountry])

  // Reset the queue whenever the country changes (a queue never spans countries, §14).
  useEffect(() => {
    setSelected([])
    setCombined(null)
    setLoadedOnce(false)
  }, [countryIso])

  const toggleExam = useCallback((slug: string) => {
    setSelected((current) =>
      current.includes(slug) ? current.filter((entry) => entry !== slug) : [...current, slug]
    )
  }, [])

  // ---------- §11 engine call (debounced on selection/language change) ----------
  const loadCombined = useCallback(
    async (slugs: string[]) => {
      if (slugs.length === 0) {
        setCombined(null)
        return
      }
      const seq = ++fetchSeq.current
      setLoading(true)
      try {
        const params = new URLSearchParams({
          country: countryIso,
          language,
          exams: slugs.join(','),
        })
        const response = await fetch(`/api/exams/combined?${params.toString()}`, {
          cache: 'no-store',
        })
        const payload = (await response.json()) as Envelope<{ combined: CombinedDto }>
        if (seq !== fetchSeq.current) return // a newer request superseded this one
        if (payload.status === 'ok' && payload.data) {
          setCombined(payload.data.combined)
        } else {
          setCombined(null)
          toast({
            title: 'Could not compute the combined view',
            description: payload.error?.message,
            variant: 'destructive',
          })
        }
      } catch {
        if (seq === fetchSeq.current) {
          setCombined(null)
          toast({ title: 'Network error', variant: 'destructive' })
        }
      } finally {
        if (seq === fetchSeq.current) {
          setLoading(false)
          setLoadedOnce(true)
        }
      }
    },
    [countryIso, language, toast]
  )

  useEffect(() => {
    const handle = setTimeout(() => void loadCombined(selected), 300)
    return () => clearTimeout(handle)
  }, [selected, loadCombined])

  const mode = combined
    ? combined.stats.examCount > 1
      ? `Combined mode · ${combined.stats.examCount} exams`
      : 'Single-exam mode'
    : null

  const selectedExams = useMemo(
    () => exams.filter((exam) => selected.includes(exam.slug)),
    [exams, selected]
  )

  return (
    <Card className="mt-10 border-zinc-200 shadow-sm" id="combined-engine">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <Combine className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Combined-exam engine — §11
        </CardTitle>
        <CardDescription>
          One knowledge system across every exam a learner prepares for: the union queue is{' '}
          <strong>computed live</strong> — deduplicated by canonical identity, each unit once at
          the deepest required depth, badged with every covering exam (Appendix A). Nothing is
          stored (§46.3). Follows arrive in P5 — for now the exam set is picked here.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ---------- Controls: country → language → exams ---------- */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <UILabel htmlFor="combined-country">Country</UILabel>
            <Select value={countryIso} onValueChange={setCountryIso}>
              <SelectTrigger id="combined-country" className="w-full">
                <SelectValue placeholder="Country" />
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
          <div className="space-y-2">
            <UILabel htmlFor="combined-language">Language</UILabel>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="combined-language" className="w-full">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                {(selectedCountry?.languages ?? []).map((entry) => (
                  <SelectItem key={entry.code} value={entry.code}>
                    {entry.nativeName ?? entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <UILabel>Exams to combine ({selected.length} selected)</UILabel>
          {exams.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No active exams in this country yet — nothing to combine.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Exams to combine">
              {exams.map((exam) => {
                const active = selected.includes(exam.slug)
                return (
                  <button
                    key={exam.slug}
                    type="button"
                    onClick={() => toggleExam(exam.slug)}
                    aria-pressed={active}
                    title={
                      exam.currentVersion
                        ? `Current version: ${exam.currentVersion.label}`
                        : 'No syllabus version in effect yet'
                    }
                    className={`min-h-[44px] rounded-full border px-4 py-2 text-left text-sm font-medium transition-colors ${
                      active
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-zinc-200 bg-white text-zinc-700 hover:border-emerald-300'
                    }`}
                  >
                    <span className="block leading-tight">{exam.code}</span>
                    <span
                      className={`block text-[10px] font-normal leading-tight ${
                        active ? 'text-emerald-50' : 'text-zinc-400'
                      }`}
                    >
                      {exam.currentVersion ? exam.currentVersion.label : 'no syllabus yet'}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* ---------- Queue ---------- */}
        {loading && !combined ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : !combined ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
            <Layers3 className="mx-auto h-6 w-6 text-zinc-400" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-zinc-700">
              {selected.length === 0
                ? 'Pick one exam for its queue, or several to combine them.'
                : 'Could not load the combined view.'}
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              Single-exam and combined-exam modes are the same engine call (§11) — try UPSC-CSE +
              SSC-CGL + MP-POLICE-CONSTABLE for the Appendix A depth story.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Mode + stats bar */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">{mode}</Badge>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                {combined.stats.unitCount} unique units
              </Badge>
              {combined.stats.examCount > 1 && (
                <>
                  <Badge variant="outline" className="border-teal-200 bg-teal-50 text-teal-700">
                    {combined.stats.sharedUnitCount} shared
                  </Badge>
                  <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                    {combined.stats.duplicatesAvoided} duplicates avoided
                  </Badge>
                </>
              )}
              <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-400">
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                computed {new Date(combined.computedAt).toLocaleTimeString()} · never stored (§46.3)
              </span>
            </div>

            {/* Per-exam resolution line */}
            <div className="flex flex-wrap gap-2">
              {combined.exams.map((resolution) => (
                <span
                  key={resolution.exam.slug}
                  className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs text-zinc-600"
                >
                  <span className="font-semibold text-zinc-800">{resolution.exam.code}</span>
                  {resolution.version ? (
                    <> · {resolution.version.label} · {resolution.unitCount} units</>
                  ) : (
                    <> · {resolution.note}</>
                  )}
                </span>
              ))}
            </div>

            <Separator />

            {/* The queue — every canonical unit ONCE (§11 steps 4–6, 8–9) */}
            <ol className="space-y-3" aria-label="Combined learning queue">
              {combined.units.length === 0 && (
                <li className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center text-sm text-zinc-500">
                  No verified, in-effect knowledge mapped to these exams yet — the queue fills as
                  editors map units (§12).
                </li>
              )}
              {combined.units.map((unit, index) => (
                <li
                  key={unit.unit.slug}
                  className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-zinc-400" aria-hidden="true">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                        <span className="font-semibold text-zinc-900">{unit.unit.canonicalName}</span>
                      </p>
                      {/* §11 step 9 — the badge the UI MUST say */}
                      <p
                        className={`mt-1.5 inline-flex flex-wrap items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${
                          unit.isShared
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-zinc-200 bg-zinc-50 text-zinc-500'
                        }`}
                        title={coversTitle(unit)}
                      >
                        {unit.isShared ? (
                          <Combine className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : null}
                        {coversLabel(unit)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge variant="outline" className={`font-semibold ${DEPTH_STYLE[unit.requiredDepth]}`}>
                        Deepest requirement: {DEPTH_LABEL[unit.requiredDepth]}
                      </Badge>
                      <span className="flex flex-wrap items-center justify-end gap-1">
                        <Badge variant="outline" className="border-zinc-200 bg-white text-xs font-normal text-zinc-600">
                          {PRIORITY_LABEL[unit.priority]}
                        </Badge>
                        <Badge variant="outline" className="border-zinc-200 bg-white text-xs font-normal text-zinc-600">
                          {LIKELIHOOD_LABEL[unit.questionLikelihood]}
                        </Badge>
                      </span>
                    </div>
                  </div>

                  {unit.unit.canonicalSummary && (
                    <p className="mt-2 text-sm leading-relaxed text-zinc-600">
                      {unit.unit.canonicalSummary}
                    </p>
                  )}

                  {/* Per-exam requirement rows — the depth ladder stays visible */}
                  <ul className="mt-3 space-y-1.5" aria-label="Per-exam requirements">
                    {unit.coverings.map((covering, coveringIndex) => (
                      <li
                        key={`${covering.exam.slug}-${coveringIndex}`}
                        className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md bg-zinc-50 px-3 py-2 text-xs text-zinc-600"
                      >
                        <span className="font-semibold text-zinc-800">{covering.exam.code}</span>
                        <span className="text-zinc-300" aria-hidden="true">·</span>
                        <span>{covering.node.name}</span>
                        {covering.node.topic && covering.node.topic.label !== covering.node.topic.canonicalName && (
                          <Badge variant="outline" className="border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700">
                            {covering.node.topic.label}
                          </Badge>
                        )}
                        <span className="mt-1 flex w-full min-w-0 flex-wrap items-center gap-1.5 sm:mt-0 sm:ml-auto sm:w-auto">
                          <Badge variant="outline" className={`text-[10px] ${DEPTH_STYLE[covering.requiredDepth]}`}>
                            {DEPTH_LABEL[covering.requiredDepth]}
                          </Badge>
                          {covering.expectedScope && (
                            <span className="min-w-0 max-w-full flex-1 truncate text-zinc-400" title={covering.expectedScope}>
                              {covering.expectedScope}
                            </span>
                          )}
                          {covering.effectiveFrom && (
                            <span className="whitespace-nowrap font-mono text-[10px] text-zinc-400">
                              from {fmtDay(covering.effectiveFrom)}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 sm:break-normal">
                      {unit.canonicalPath}
                    </code>
                    <span className="text-[11px] text-zinc-400">
                      {unit.unit.type} · {unit.unit.difficulty.toLowerCase()}
                    </span>
                  </div>
                </li>
              ))}
            </ol>

            {/* §11 step 7 ranking note */}
            <p className="flex items-start gap-2 rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                Ranked by priority, question likelihood and freshness (§11 step 7). Personal mastery
                and revision due-dates fold into this order when Phases 5–7 land; the union,
                deduplication and depth-max rules never change.{' '}
                {selectedExams.length > 1
                  ? 'The same knowledge never appears twice in one queue (§11 step 9).'
                  : 'Add a second exam to see the union and the "Covers: …" badges.'}
              </span>
            </p>

            <div className="flex items-center justify-between">
              <p className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                {combined.stats.mappingCount} requirement rows across {combined.stats.examCount}{' '}
                exam{combined.stats.examCount === 1 ? '' : 's'} → {combined.stats.unitCount} unique
                unit{combined.stats.unitCount === 1 ? '' : 's'}
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-1.5 text-emerald-700"
                onClick={() => void loadCombined(selected)}
                disabled={loading || selected.length === 0}
                aria-label="Recompute the combined view"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                Recompute
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}

        {loadedOnce && combined === null && selected.length > 0 && !loading && (
          <p className="text-xs text-zinc-400">
            The engine returned no view — try reselecting exams or switching language.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
