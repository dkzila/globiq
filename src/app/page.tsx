'use client'

/**
 * GlobIQ — Foundation Status Page (P1-S1 → P4-S1)
 *
 * Temporary homepage: proves the foundation end-to-end (database, API-first
 * pattern, module registry, token-based identity, the canonical content
 * stack, the §22 reading experience, the country-scoped exam layer with its
 * §36 versioned structures, version-pinned syllabus trees, the §8
 * exam-mapping requirement layer, the §11 multi-exam combination engine,
 * the exam-facing pages with their coverage displays, and now the §17
 * search abstraction with its indexing pipeline) until the real India
 * discovery homepage lands in P4-S2 (Master Plan §34).
 * This page consumes the same /api endpoints a future mobile client would
 * use (§4, §39).
 */

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  CheckCircle2,
  Circle,
  CircleDot,
  Database,
  GitBranch,
  Globe,
  Layers,
  RefreshCw,
  Server,
  XCircle,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { PLATFORM } from '@/config/platform'
import { PHASES } from '@/config/roadmap'
import { MODULES } from '@/modules'
import { AccountSection } from '@/components/auth/account-section'
import { HeaderAuth } from '@/components/auth/header-auth'
import { AuditSection } from '@/components/audit/audit-section'
import { ContentSection } from '@/components/content/content-section'
import { ExamsSection } from '@/components/exams/exams-section'
import { SyllabusSection } from '@/components/exams/syllabus-section'
import { MappingSection } from '@/components/exams/mapping-section'
import { CombinedSection } from '@/components/exams/combined-section'
import { ExamPageSection } from '@/components/exams/exam-page-section'
import { KnowledgeSection } from '@/components/knowledge/knowledge-section'
import { LocaleSection } from '@/components/locale/locale-section'
import { SourceSection } from '@/components/sources/source-section'
import { EditorialSection } from '@/components/editorial/editorial-section'
import { ReaderSection } from '@/components/reader/reader-section'
import { SearchSection } from '@/components/search/search-section'
import { TaxonomySection } from '@/components/taxonomy/taxonomy-section'

// ---------- Types (mirrors /api/health contract) ----------

interface SeedCountry {
  isoCode: string
  name: string
  slug: string
  status: 'ACTIVE' | 'COMING_SOON' | 'INACTIVE'
  isDefault: boolean
  timezone: string | null
  defaultLanguage: string | null
  languages: string[]
}

interface SeedLanguage {
  code: string
  name: string
  nativeName: string | null
  status: string
}

interface HealthData {
  service: { name: string; version: string; spec: string }
  database: { connected: boolean; provider: string; host: string; region: string }
  seed: { countries: SeedCountry[]; languages: SeedLanguage[] }
  latencyMs: number
}

// ---------- Helpers ----------

const statusStyles: Record<string, string> = {
  done: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  current: 'bg-emerald-600 text-white border-emerald-600',
  upcoming: 'bg-white text-zinc-600 border-zinc-200',
  future: 'bg-zinc-50 text-zinc-400 border-dashed border-zinc-200',
}

const moduleStatusIcon = {
  planned: <Circle className="h-3.5 w-3.5 text-zinc-300" aria-hidden="true" />,
  in_progress: <CircleDot className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />,
  delivered: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />,
}

// ---------- Page ----------

export default function FoundationStatusPage() {
  const [health, setHealth] = useState<HealthData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/health', { cache: 'no-store' })
      const payload = (await response.json()) as
        | { status: 'ok'; data: HealthData }
        | { status: 'error'; error: { message: string } }

      if (payload.status === 'ok') {
        setHealth(payload.data)
      } else {
        setError(payload.error.message)
      }
      setLastChecked(new Date().toLocaleTimeString())
    } catch {
      setError('Could not reach /api/health')
      setLastChecked(new Date().toLocaleTimeString())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchHealth()
  }, [fetchHealth])

  const dbConnected = health?.database.connected === true && error === null

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600" aria-hidden="true">
              <Globe className="h-5 w-5 text-white" />
            </div>
            <div className="leading-tight">
              <p className="text-lg font-semibold tracking-tight">GlobIQ</p>
              <p className="hidden text-xs text-zinc-500 sm:block">{PLATFORM.tagline}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Badge
              variant="outline"
              className="hidden shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 sm:inline-flex"
            >
              Phase 4 · Session 1 — Search &amp; Indexing
            </Badge>
            <HeaderAuth />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-12">
        {/* ---------- Hero ---------- */}
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-4"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-zinc-900 text-white hover:bg-zinc-900">Master Plan v2.0</Badge>
            <Badge variant="outline" className="border-zinc-200 bg-white text-zinc-600">
              API-first · Mobile-ready
            </Badge>
          </div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            One knowledge system for{' '}
            <span className="bg-gradient-to-r from-emerald-600 to-teal-500 bg-clip-text text-transparent">
              every learner
            </span>
          </h1>
          <p className="max-w-2xl text-base text-zinc-600 sm:text-lg">
            {PLATFORM.description} This page verifies the running foundation: identity (P1-S2),
            country/language configuration (P1-S3), canonical taxonomy (P1-S4), audit + permissions
            (P1-S5), the KnowledgeUnit canonical record (P2-S1), ContentItems with immutable
            published revisions (P2-S2), the §24 source &amp; provenance model (P2-S3), the §19
            editorial workspace with writer/editor roles and scheduled publishing (P2-S4), the
            §22 reading experience (P2-S5), the exam layer — country-scoped exam definitions
            with §36 versioned structures (P3-S1) — version-pinned syllabus trees (P3-S2), the
            §8 exam-mapping requirement layer (P3-S3), the §11 multi-exam combination engine
            (P3-S4), the exam-facing pages (P3-S5) — and now the §17 search product (P4-S1):
            a vendor-neutral engine over a projected document index, with exact/prefix/alias
            matching, typo tolerance, language-aware full text, country scope, exam-aware
            explanations and canonical-object deduplication, kept fresh by an indexing pipeline
            that re-projects documents on every publish.
          </p>

          {/* Live status pill */}
          <div
            role="status"
            aria-live="polite"
            className="flex flex-wrap items-center gap-3 pt-1"
          >
            {loading && !health ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-1.5 text-sm text-zinc-500">
                <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-400" aria-hidden="true" />
                Checking platform status…
              </span>
            ) : dbConnected ? (
              <span className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-1.5 text-sm font-medium text-emerald-700">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />
                All systems operational · {health?.database.provider} {health?.latencyMs}ms
              </span>
            ) : (
              <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-4 py-1.5 text-sm font-medium text-red-700">
                <XCircle className="h-4 w-4" aria-hidden="true" />
                {error ?? 'Database unavailable'}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchHealth()}
              disabled={loading}
              className="h-9 gap-2"
              aria-label="Refresh platform status"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
              Refresh
            </Button>
            {lastChecked && <span className="text-xs text-zinc-400">Checked at {lastChecked}</span>}
          </div>
        </motion.section>

        {/* ---------- Status cards ---------- */}
        <section aria-labelledby="status-heading" className="mt-10 space-y-4">
          <h2 id="status-heading" className="text-xl font-semibold tracking-tight">
            Foundation status
          </h2>
          <div className="grid gap-4 md:grid-cols-3">
            {/* Database card */}
            <Card className="border-zinc-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Database className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Database
                </CardTitle>
                <CardDescription>PostgreSQL via Supabase (ap-south-1)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {loading && !health ? (
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : dbConnected ? (
                  <>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Connection</span>
                      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        Connected
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Countries</span>
                      <span className="font-semibold">{health?.seed.countries.length ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Languages</span>
                      <span className="font-semibold">{health?.seed.languages.length ?? 0}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-zinc-500">Query latency</span>
                      <span className="font-semibold">{health?.latencyMs ?? '—'} ms</span>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-red-600">{error ?? 'Database unreachable'}</p>
                )}
              </CardContent>
            </Card>

            {/* API card */}
            <Card className="border-zinc-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Server className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Internal API
                </CardTitle>
                <CardDescription>API-first — same contract for web &amp; future apps</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <code className="block rounded-md bg-zinc-900 px-3 py-2 text-xs text-emerald-400">
                  GET /api/health → 200
                </code>
                <code className="block rounded-md bg-zinc-100 px-3 py-2 text-xs text-zinc-600">
                  {'{ status: "ok", data: { … }, meta: { … } }'}
                </code>
                <p className="text-xs text-zinc-500">
                  Envelope per Master Plan §37 — versioned, client-agnostic, explicit errors.
                </p>
              </CardContent>
            </Card>

            {/* Stack card */}
            <Card className="border-zinc-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                  Stack
                </CardTitle>
                <CardDescription>Modular monolith (§28) — one deployable app</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {['Next.js 16', 'React 19', 'TypeScript 5', 'Tailwind CSS 4', 'shadcn/ui', 'Prisma 6', 'PostgreSQL', 'Bun'].map(
                    (item) => (
                      <Badge key={item} variant="secondary" className="font-normal">
                        {item}
                      </Badge>
                    )
                  )}
                </div>
                <p className="mt-3 text-xs text-zinc-500">
                  {MODULES.length} logical modules · {PHASES.length} phases · 5 sessions per phase
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ---------- Account (P1-S2: token-based identity) ---------- */}
        <AccountSection />

        {/* ---------- Country & language configuration (P1-S3) ---------- */}
        <LocaleSection />

        {/* ---------- Taxonomy (P1-S4) ---------- */}
        <TaxonomySection />

        {/* ---------- Knowledge units (P2-S1) ---------- */}
        <KnowledgeSection />

        {/* ---------- Content items & revisions (P2-S2) ---------- */}
        <ContentSection />

        {/* ---------- Sources & provenance (P2-S3) ---------- */}
        <SourceSection />

        {/* ---------- Editorial workspace (P2-S4) ---------- */}
        <EditorialSection />

        {/* ---------- Reader — canonical knowledge page (P2-S5) ---------- */}
        <ReaderSection />

        {/* ---------- Exams & versions (P3-S1) ---------- */}
        <ExamsSection />

        {/* ---------- Syllabus trees (P3-S2) ---------- */}
        <SyllabusSection />

        {/* ---------- Exam mappings — §8 requirement layer (P3-S3) ---------- */}
        <MappingSection />

        {/* ---------- Combined-exam engine — §11 union queue (P3-S4) ---------- */}
        <CombinedSection />

        {/* ---------- Exam page — §22 exam overview + coverage (P3-S5) ---------- */}
        <ExamPageSection />

        {/* ---------- Search — §17 product surface + indexing pipeline (P4-S1) ---------- */}
        <SearchSection />

        {/* ---------- Audit trail (P1-S5, ADMIN only) ---------- */}
        <AuditSection />

        {/* ---------- Module map ---------- */}
        <section aria-labelledby="modules-heading" className="mt-10 space-y-4">
          <div className="flex items-center gap-2">
            <BookOpenCheck className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2 id="modules-heading" className="text-xl font-semibold tracking-tight">
              Modular monolith — {MODULES.length} modules
            </h2>
          </div>
          <p className="text-sm text-zinc-600">
            Explicit boundaries from day one (§28). Each module is implemented in its scheduled
            session — never early, never duplicated.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((module) => (
              <div
                key={module.key}
                className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-emerald-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug">{module.name}</p>
                  <span aria-label={`Status: ${module.status.replace('_', ' ')}`}>
                    {moduleStatusIcon[module.status]}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-zinc-500">{module.description}</p>
                <div className="mt-3 flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] font-normal text-zinc-500">
                    {module.session}
                  </Badge>
                  {module.status === 'in_progress' && (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                      In progress
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ---------- Roadmap ---------- */}
        <section aria-labelledby="roadmap-heading" className="mt-10 space-y-4">
          <div className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-emerald-600" aria-hidden="true" />
            <h2 id="roadmap-heading" className="text-xl font-semibold tracking-tight">
              Phase roadmap
            </h2>
          </div>
          <p className="text-sm text-zinc-600">
            One chat = one session (§41). Currently executing{' '}
            <strong className="text-zinc-900">P4-S1 of 55 sessions</strong> in the vertical slice.
          </p>
          <ol className="flex flex-wrap gap-2">
            {PHASES.map((phase) => (
              <li key={phase.id} className="flex items-center">
                <span
                  title={`${phase.id} — ${phase.title}: ${phase.scope}`}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${statusStyles[phase.status]}`}
                >
                  {phase.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
                  {phase.status === 'current' && <Activity className="h-3.5 w-3.5" aria-hidden="true" />}
                  <span className="font-mono">{phase.id}</span>
                  <span className="hidden sm:inline">{phase.title}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>
      </main>

      {/* ---------- Footer (sticky bottom) ---------- */}
      <footer className="mt-auto border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:px-6">
          <div className="text-sm text-zinc-500">
            <span className="font-semibold text-zinc-900">GlobIQ</span> · © 2025 dkzila · Built per{' '}
            <span className="font-medium text-zinc-700">GlobIQ_Master_Plan.md v2.0</span>
          </div>
          <a
            href="https://github.com/dkzila/globiq"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
          >
            GitHub Repository
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </footer>
    </div>
  )
}
