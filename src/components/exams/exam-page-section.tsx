'use client'

/**
 * GlobIQ — Exam Page Section (P3-S5)
 *
 * The exam-facing page (Master Plan §43 P3-S5 "exam-facing pages and coverage
 * display"; §16's `/{country-or-root}/{language?}/exams/{exam-slug}/` pattern
 * as a foundation-page section — real routes land in P4): what ONE exam needs
 * today. The exam header comes from the public exam detail (§36 version
 * history, §16 canonical exam path); the coverage display comes from
 * GET /api/exams/{ref}/coverage — the current version's §8 requirement rows
 * grouped by SyllabusNode (only mapping-bearing branches), every field of the
 * vocabulary visible: required depth, priority, relevance, question
 * likelihood, expected scope, effective period, plus the §16 knowledge-page
 * path of each mapped unit and §35 topic labels per language.
 *
 * §36 historical read: the version selector switches to any STARTED window
 * (future/staged versions are never public). §22 "Exam overview: syllabus
 * coverage" — this is the syllabus-coverage half; the learner's ranked queue
 * is the §11 engine (the Combined-exam engine section above, single-exam
 * mode).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpenCheck,
  CalendarRange,
  ClipboardList,
  GraduationCap,
  History,
  Info,
  Link2,
  Loader2,
  Radio,
  RefreshCw,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'

import { Badge } from '@/components/ui/badge'
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

interface VersionRef {
  id: string
  label: string
  effectiveFrom: string
  effectiveTo: string | null
  isCurrent: boolean
  isUpcoming: boolean
}

interface ExamDetail {
  slug: string
  name: string
  code: string
  organiser: string
  level: string
  description: string | null
  countryIso: string
  currentVersion: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  versionCount: number
  canonicalPath: string
  versions: VersionRef[]
}

type Depth = 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
type Priority = 'CORE' | 'SUPPORTING' | 'LOW'
type Relevance = 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'
type Likelihood = 'HIGH' | 'MEDIUM' | 'LOW'

interface CoverageMapping {
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

interface CoverageNode {
  name: string
  depth: number
  priority: number
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  mappings: CoverageMapping[]
  children: CoverageNode[]
}

interface ExamCoverage {
  exam: { id: string; slug: string; name: string; code: string; level: string }
  version: {
    id: string
    label: string
    effectiveFrom: string
    effectiveTo: string | null
    isCurrent: boolean
  } | null
  editability: 'staged' | 'live' | 'frozen' | 'locked'
  unitCount: number
  mappingCount: number
  nodes: CoverageNode[]
  language: { code: string; name: string; nativeName: string | null }
}

// ---------- Presentation helpers (same vocabulary as the sibling sections) ----------

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

const RELEVANCE_LABEL: Record<Relevance, string> = {
  DIRECT: 'Direct',
  PARTIAL: 'Partial',
  CONTEXTUAL: 'Contextual',
}

const fmtDay = (iso: string | null): string => (iso ? iso.slice(0, 10) : '')

/** §36 window as a reader-friendly range ("Jun 1, 2025 → open"). */
function fmtWindow(from: string, to: string | null): string {
  const start = new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const end = to
    ? new Date(to).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'open'
  return `${start} → ${end}`
}

/** Mapping-bearing branches (ancestors included by the API — count leaves + anchors). */
function countBranches(nodes: CoverageNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.mappings.length > 0) total += 1
    total += countBranches(node.children)
  }
  return total
}

// ---------- Recursive coverage tree (§8 requirement rows per node) ----------

function MappingRow({ mapping }: { mapping: CoverageMapping }) {
  return (
    <li className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-zinc-900">
          {mapping.unit.canonicalName}
        </p>
        <Badge variant="outline" className={`shrink-0 font-semibold ${DEPTH_STYLE[mapping.requiredDepth]}`}>
          {DEPTH_LABEL[mapping.requiredDepth]}
        </Badge>
      </div>
      {mapping.expectedScope && (
        <p className="mt-1.5 text-xs leading-relaxed text-zinc-600">{mapping.expectedScope}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
          {PRIORITY_LABEL[mapping.priority]}
        </Badge>
        <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
          {RELEVANCE_LABEL[mapping.relevance]}
        </Badge>
        <Badge variant="outline" className="border-zinc-200 bg-white text-[10px] font-normal text-zinc-600">
          {LIKELIHOOD_LABEL[mapping.questionLikelihood]}
        </Badge>
        {(mapping.effectiveFrom || mapping.effectiveTo) && (
          <span className="whitespace-nowrap font-mono text-[10px] text-zinc-400">
            {mapping.effectiveFrom ? `from ${fmtDay(mapping.effectiveFrom)}` : ''}
            {mapping.effectiveFrom && mapping.effectiveTo ? ' ' : ''}
            {mapping.effectiveTo ? `until ${fmtDay(mapping.effectiveTo)}` : ''}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <code
          className="break-all rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-600 sm:break-normal"
          title="§16 canonical knowledge-page path"
        >
          {mapping.canonicalPath}
        </code>
        <span className="text-[11px] text-zinc-400">
          {mapping.unit.type} · {mapping.unit.difficulty.toLowerCase()}
        </span>
      </div>
    </li>
  )
}

function CoverageBranch({ node }: { node: CoverageNode }) {
  return (
    <li className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <p className="text-sm font-semibold leading-snug text-zinc-800">{node.name}</p>
        {node.topic && node.topic.label !== node.topic.canonicalName && (
          <Badge
            variant="outline"
            className="border-teal-200 bg-teal-50 text-[10px] font-normal text-teal-700"
            title={`§35 topic label (resolved in ${node.topic.labelLanguage}) — ${node.topic.canonicalName}`}
          >
            {node.topic.label}
          </Badge>
        )}
        <span className="text-[11px] text-zinc-400">
          {node.mappings.length} unit{node.mappings.length === 1 ? '' : 's'}
        </span>
      </div>
      {node.mappings.length > 0 && (
        <ul className="mt-2 space-y-2" aria-label={`Units required under ${node.name}`}>
          {node.mappings.map((mapping) => (
            <MappingRow key={mapping.unit.slug} mapping={mapping} />
          ))}
        </ul>
      )}
      {node.children.length > 0 && (
        <ul
          className="mt-3 space-y-3 border-l border-zinc-200 pl-3 sm:pl-4"
          aria-label={`Sub-topics under ${node.name}`}
        >
          {node.children.map((child, index) => (
            <CoverageBranch key={`${child.name}-${index}`} node={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

// ---------- Section ----------

export function ExamPageSection() {
  const { toast } = useToast()

  const [countries, setCountries] = useState<CountryRef[]>([])
  const [countryIso, setCountryIso] = useState('IN')
  const [language, setLanguage] = useState('en')

  const [exams, setExams] = useState<PublicExamRef[]>([])
  const [examSlug, setExamSlug] = useState<string | null>(null)

  const [detail, setDetail] = useState<ExamDetail | null>(null)
  const [coverage, setCoverage] = useState<ExamCoverage | null>(null)
  const [versionId, setVersionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const coverageSeq = useRef(0)
  const selectedCountry = countries.find((country) => country.isoCode === countryIso)
  const selectedExam = exams.find((exam) => exam.slug === examSlug) ?? null

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

  // ---------- Country change → exam directory + reset (§14: one country at a time) ----------
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

  // Reset the page whenever the country changes.
  useEffect(() => {
    setExamSlug(null)
    setDetail(null)
    setCoverage(null)
    setVersionId(null)
  }, [countryIso])

  // ---------- Exam + coverage load (detail drives the §36 version selector) ----------
  const loadExamPage = useCallback(
    async (slug: string, country: string, lang: string, version: string | null) => {
      const seq = ++coverageSeq.current
      setLoading(true)
      try {
        const detailParams = new URLSearchParams({ country, language: lang })
        const detailResponse = await fetch(`/api/exams/${slug}?${detailParams.toString()}`, {
          cache: 'no-store',
        })
        const detailPayload = (await detailResponse.json()) as Envelope<{ exam: ExamDetail }>
        if (seq !== coverageSeq.current) return

        if (detailPayload.status !== 'ok' || !detailPayload.data) {
          setDetail(null)
          setCoverage(null)
          toast({
            title: 'Could not open the exam page',
            description: detailPayload.error?.message,
            variant: 'destructive',
          })
          return
        }

        const examDetail = detailPayload.data.exam
        setDetail(examDetail)

        // §36: the selector offers STARTED windows only — future versions are
        // never public. Default = the currently effective version.
        const targetVersion = version ?? examDetail.currentVersion?.id ?? null
        setVersionId(targetVersion)

        const coverageParams = new URLSearchParams({ country, language: lang })
        if (targetVersion) coverageParams.set('version', targetVersion)
        const coverageResponse = await fetch(
          `/api/exams/${slug}/coverage?${coverageParams.toString()}`,
          { cache: 'no-store' }
        )
        const coveragePayload = (await coverageResponse.json()) as Envelope<{ coverage: ExamCoverage }>
        if (seq !== coverageSeq.current) return
        if (coveragePayload.status === 'ok' && coveragePayload.data) {
          setCoverage(coveragePayload.data.coverage)
        } else {
          setCoverage(null)
          toast({
            title: 'Could not load the coverage display',
            description: coveragePayload.error?.message,
            variant: 'destructive',
          })
        }
      } catch {
        if (seq === coverageSeq.current) {
          setCoverage(null)
          toast({ title: 'Network error', variant: 'destructive' })
        }
      } finally {
        if (seq === coverageSeq.current) setLoading(false)
      }
    },
    [toast]
  )

  // Open the page whenever the exam or language changes.
  useEffect(() => {
    if (!examSlug || !selectedCountry) return
    void loadExamPage(examSlug, countryIso, language, null)
  }, [examSlug, countryIso, language, selectedCountry, loadExamPage])

  // §36 historical switch — refetch coverage only.
  const switchVersion = useCallback(
    (nextVersionId: string) => {
      if (!examSlug || nextVersionId === versionId) return
      setVersionId(nextVersionId)
      const seq = ++coverageSeq.current
      setLoading(true)
      const params = new URLSearchParams({ country: countryIso, language, version: nextVersionId })
      fetch(`/api/exams/${examSlug}/coverage?${params.toString()}`, { cache: 'no-store' })
        .then((response) => response.json())
        .then((payload: Envelope<{ coverage: ExamCoverage }>) => {
          if (seq !== coverageSeq.current) return
          if (payload.status === 'ok' && payload.data) {
            setCoverage(payload.data.coverage)
          } else {
            setCoverage(null)
            toast({
              title: 'Could not load the historical coverage',
              description: payload.error?.message,
              variant: 'destructive',
            })
          }
        })
        .catch(() => {
          if (seq === coverageSeq.current) {
            setCoverage(null)
            toast({ title: 'Network error', variant: 'destructive' })
          }
        })
        .finally(() => {
          if (seq === coverageSeq.current) setLoading(false)
        })
    },
    [examSlug, versionId, countryIso, language, toast]
  )

  /** §36: started windows only (current first — the API sorts newest-first). */
  const startedVersions = useMemo(
    () => (detail ? detail.versions.filter((version) => !version.isUpcoming) : []),
    [detail]
  )
  const isHistorical = useMemo(() => {
    if (!coverage?.version) return false
    return !coverage.version.isCurrent
  }, [coverage])
  const branchCount = useMemo(
    () => (coverage ? countBranches(coverage.nodes) : 0),
    [coverage]
  )

  return (
    <Card className="mt-10 border-zinc-200 shadow-sm" id="exam-page">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xl">
          <GraduationCap className="h-5 w-5 text-emerald-600" aria-hidden="true" />
          Exam page — §22 exam overview
        </CardTitle>
        <CardDescription>
          What this exam needs today: the current version&apos;s syllabus coverage, grouped by node,
          with every §8 requirement visible — depth, priority, relevance, question likelihood,
          expected scope and effective period — plus each mapped unit&apos;s §16 knowledge-page path
          and §35 topic labels. Switch windows to read a started version&apos;s coverage
          historically (§36). This is the page a learner opens before following an exam (follows
          arrive in P5).
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* ---------- Controls: country → language → exam ---------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <UILabel htmlFor="exam-page-country">Country</UILabel>
            <Select value={countryIso} onValueChange={setCountryIso}>
              <SelectTrigger id="exam-page-country" className="w-full">
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
            <UILabel htmlFor="exam-page-language">Language</UILabel>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger id="exam-page-language" className="w-full">
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
          <div className="space-y-2">
            <UILabel htmlFor="exam-page-exam">Exam</UILabel>
            <Select
              value={examSlug ?? ''}
              onValueChange={(value) => {
                setVersionId(null)
                setExamSlug(value)
              }}
            >
              <SelectTrigger id="exam-page-exam" className="w-full">
                <SelectValue placeholder={exams.length === 0 ? 'No active exams' : 'Pick an exam'} />
              </SelectTrigger>
              <SelectContent>
                {exams.map((exam) => (
                  <SelectItem key={exam.slug} value={exam.slug}>
                    <span className="font-semibold">{exam.code}</span>
                    <span className="text-zinc-400">
                      {' '}
                      · {exam.currentVersion ? exam.currentVersion.label : 'no syllabus yet'}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* ---------- Exam page ---------- */}
        {!examSlug ? (
          <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
            <ClipboardList className="mx-auto h-6 w-6 text-zinc-400" aria-hidden="true" />
            <p className="mt-2 text-sm font-medium text-zinc-700">
              Pick an exam to open its page — try UPSC-CSE for the full coverage story.
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              The page shows the exam&apos;s current syllabus version and the canonical units its
              syllabus nodes require (§13 — the only exam→knowledge path).
            </p>
          </div>
        ) : loading && !detail ? (
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !detail ? (
          <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
            Could not open this exam page.{' '}
            <button
              type="button"
              className="font-medium text-emerald-700 hover:underline"
              onClick={() => examSlug && void loadExamPage(examSlug, countryIso, language, null)}
            >
              Try again
            </button>
          </p>
        ) : (
          <div className="space-y-4">
            {/* ---------- Exam header ---------- */}
            <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h3 className="text-lg font-semibold leading-tight tracking-tight text-zinc-900">
                    {detail.name}
                  </h3>
                  <p className="mt-0.5 text-sm text-zinc-500">{detail.organiser}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">{detail.code}</Badge>
                  <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-600">
                    {detail.level.toLowerCase()}
                  </Badge>
                  <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-600">
                    {detail.countryIso}
                  </Badge>
                </div>
              </div>

              {detail.description && (
                <p className="mt-2 text-sm leading-relaxed text-zinc-600">{detail.description}</p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                {detail.currentVersion ? (
                  <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-zinc-600">
                    <CalendarRange className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                    <span className="font-semibold text-zinc-800">{detail.currentVersion.label}</span>
                    <span className="font-mono text-zinc-400">
                      {fmtWindow(detail.currentVersion.effectiveFrom, detail.currentVersion.effectiveTo)}
                    </span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                    <CalendarRange className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
                    No syllabus version in effect yet
                  </span>
                )}
                {coverage?.version?.isCurrent && (
                  <Badge
                    variant="outline"
                    className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700"
                    title="§12 step 5 — current-affairs knowledge attaches to live syllabi the moment it is mapped"
                  >
                    <Radio className="mr-1 h-3 w-3" aria-hidden="true" />
                    Live — mappings keep flowing (§12)
                  </Badge>
                )}
              </div>

              <p className="mt-3 flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
                <Link2 className="h-3 w-3" aria-hidden="true" />
                <span className="uppercase tracking-wide">Canonical (§16):</span>
                <span className="break-all rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">
                  {detail.canonicalPath}
                </span>
              </p>
            </div>

            {/* ---------- §36 version selector (started windows only) ---------- */}
            {startedVersions.length > 1 && (
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-zinc-400" aria-hidden="true" />
                  <UILabel htmlFor="exam-page-version" className="text-sm text-zinc-600">
                    Version window
                  </UILabel>
                </div>
                <Select
                  value={versionId ?? undefined}
                  onValueChange={(value) => switchVersion(value)}
                >
                  <SelectTrigger id="exam-page-version" className="w-full min-w-0 sm:w-80">
                    <SelectValue placeholder="Version" />
                  </SelectTrigger>
                  <SelectContent>
                    {startedVersions.map((version) => (
                      <SelectItem key={version.id} value={version.id}>
                        {version.label}
                        {version.isCurrent ? ' (current)' : ' (historical)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* ---------- Stats bar ---------- */}
            {coverage && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  className={
                    isHistorical
                      ? 'bg-amber-600 text-white hover:bg-amber-600'
                      : 'bg-zinc-900 text-white hover:bg-zinc-900'
                  }
                >
                  {isHistorical ? 'Historical read (§36)' : 'Current coverage'}
                </Badge>
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">
                  {coverage.unitCount} unique unit{coverage.unitCount === 1 ? '' : 's'}
                </Badge>
                <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-600">
                  {coverage.mappingCount} requirement row{coverage.mappingCount === 1 ? '' : 's'}
                </Badge>
                <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-600">
                  {branchCount} mapping-bearing branch{branchCount === 1 ? '' : 'es'}
                </Badge>
                <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-zinc-400">
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <BookOpenCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  {coverage.language.name}
                  {coverage.language.nativeName ? ` · ${coverage.language.nativeName}` : ''}
                </span>
                <button
                  type="button"
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md px-2 text-xs font-medium text-emerald-700 hover:underline"
                  onClick={() =>
                    examSlug && void loadExamPage(examSlug, countryIso, language, versionId)
                  }
                  disabled={loading}
                  aria-label="Reload this exam page"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                  Reload
                </button>
              </div>
            )}

            <Separator />

            {/* ---------- Coverage display (§8 rows grouped by node) ---------- */}
            {loading && !coverage ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-3/4" />
              </div>
            ) : !coverage ? (
              <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                Could not load the coverage display for this window.
              </p>
            ) : !coverage.version ? (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
                <CalendarRange className="mx-auto h-6 w-6 text-zinc-400" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-zinc-700">
                  No syllabus version in effect yet
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  The exam page fills the moment a version&apos;s window starts (§36) — mappings are
                  always version-pinned.
                </p>
              </div>
            ) : coverage.nodes.length === 0 ? (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50 p-6 text-center">
                <ClipboardList className="mx-auto h-6 w-6 text-zinc-400" aria-hidden="true" />
                <p className="mt-2 text-sm font-medium text-zinc-700">
                  No verified units mapped on this version&apos;s branches yet
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  The coverage display fills as editors map canonical units to this version&apos;s
                  syllabus nodes (§12).
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {isHistorical && (
                  <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
                    <History className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      Historical window (§36): requirements exactly as this superseded version
                      defined them — read-only history, never mixed into today&apos;s coverage or
                      the §11 queue.
                    </span>
                  </p>
                )}
                <ul
                  className="globiq-scroll max-h-[36rem] space-y-4 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 pr-3 sm:p-4"
                  aria-label="Syllabus coverage tree"
                >
                  {coverage.nodes.map((node, index) => (
                    <CoverageBranch key={`${node.name}-${index}`} node={node} />
                  ))}
                </ul>
                <p className="flex items-start gap-2 rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Every row is one canonical unit anchored to this syllabus node (§13) — the same
                    unit may appear under several exams at different depths without ever being
                    duplicated (§8). This exam&apos;s ranked study queue is the §11 engine in
                    single-exam mode: open the Combined-exam engine section above and select just
                    this exam. Real exam routes land with SEO in P4 (§16).
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
