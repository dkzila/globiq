'use client'

/**
 * GlobIQ — Knowledge Page View (P2-S5)
 *
 * The §22 reading experience assembled from the canonical model: quick fact →
 * deeper explanation (format-aware, §23) → sources (§24) → related concepts →
 * exam coverage (P3 placeholder) — with the §35 translation surface and the
 * §16 canonical path. This is the READER surface (§38): what a student sees,
 * not an admin table. Consumes GET /api/knowledge/page/{ref} — the same
 * client-agnostic payload a future mobile app will use (§39).
 */
import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Clock,
  Columns3,
  FileText,
  GraduationCap,
  History,
  Landmark,
  Lightbulb,
  Link2,
  ListChecks,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  Sparkles,
  Tag,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'

// ---------- Types (mirror /api/knowledge/page/{ref}) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string }
}

interface ParsedRepresentation {
  timeline?: { date: string; event: string }[]
  comparison?: { axis: string; left: string; right: string }[]
  profile?: { key: string; value: string }[]
}

interface PageRepresentation {
  id: string
  format: string
  title: string
  body: string
  parsed: ParsedRepresentation | null
  revision: { number: number; publishedAt: string; changeSummary: string | null }
  aiAssisted: boolean
  sourceCount: number
}

interface PageSource {
  id: string
  title: string
  publisher: string
  url: string
  type: string
  verification: 'VERIFIED' | 'UNVERIFIED' | 'UNRELIABLE'
  publishedAt: string | null
  claim: string | null
  citedBy: { itemId: string; title: string; format: string }[]
}

interface RelatedUnit {
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  availableLanguages: string[]
  canonicalPath: string
}

export interface KnowledgePageData {
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
  }
  topic: {
    slug: string
    label: string
    path: { slug: string; label: string }[]
  }
  quickFact: { source: 'FACT_CARD' | 'CANONICAL_SUMMARY'; title: string | null; body: string }
  representations: PageRepresentation[]
  sources: PageSource[]
  related: RelatedUnit[]
  examCoverage: { available: false; note: string }
  language: { code: string; name: string; nativeName: string | null }
  translations: { code: string; name: string; nativeName: string | null; canonicalPath: string }[]
  canonicalPath: string
  scheduledCount: number
}

// ---------- Helpers ----------

const FORMAT_META: Record<string, { label: string; icon: typeof FileText; tone: string }> = {
  EXPLAINER: { label: 'Explainer', icon: FileText, tone: 'border-zinc-200 bg-white text-zinc-700' },
  PROFILE: { label: 'Profile', icon: Landmark, tone: 'border-amber-200 bg-amber-50 text-amber-800' },
  COMPARISON: { label: 'Comparison', icon: Columns3, tone: 'border-violet-200 bg-violet-50 text-violet-800' },
  TIMELINE: { label: 'Timeline', icon: History, tone: 'border-sky-200 bg-sky-50 text-sky-800' },
  REVISION_NOTE: { label: 'Revision note', icon: ListChecks, tone: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  CURRENT_EVENT_UPDATE: { label: 'Update', icon: CalendarClock, tone: 'border-orange-200 bg-orange-50 text-orange-800' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

function verificationBadge(verification: PageSource['verification']) {
  if (verification === 'VERIFIED') {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" /> Verified evidence
      </Badge>
    )
  }
  if (verification === 'UNRELIABLE') {
    return (
      <Badge variant="outline" className="gap-1 border-red-200 bg-red-50 text-red-700">
        <ShieldAlert className="h-3 w-3" aria-hidden="true" /> Flagged unreliable
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="gap-1 border-amber-200 bg-amber-50 text-amber-700">
      <ShieldQuestion className="h-3 w-3" aria-hidden="true" /> Unverified
    </Badge>
  )
}

/** Prose renderer — paragraphs split on blank lines (EXPLAINER + fallback). */
function ProseBody({ body }: { body: string }) {
  const paragraphs = body.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean)
  return (
    <div className="space-y-3 text-[15px] leading-relaxed text-zinc-700">
      {(paragraphs.length ? paragraphs : [body]).map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}

// ---------- §23 format-aware renderers ----------

function TimelineView({ entries }: { entries: { date: string; event: string }[] }) {
  return (
    <ol className="relative space-y-4 border-l-2 border-sky-200 pl-5" aria-label="Timeline">
      {entries.map((entry, index) => (
        <li key={index} className="relative">
          <span
            className="absolute -left-[27px] top-1 h-3 w-3 rounded-full border-2 border-white bg-sky-500 shadow"
            aria-hidden="true"
          />
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{entry.date}</p>
          <p className="mt-0.5 text-[15px] leading-relaxed text-zinc-700">{entry.event}</p>
        </li>
      ))}
    </ol>
  )
}

function ComparisonView({ rows }: { rows: { axis: string; left: string; right: string }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-violet-200">
      <table className="w-full min-w-[480px] border-collapse text-sm">
        <caption className="sr-only">Side-by-side comparison by axis</caption>
        <thead>
          <tr className="bg-violet-50 text-left text-violet-900">
            <th scope="col" className="px-3 py-2 font-semibold">Axis</th>
            <th scope="col" className="px-3 py-2 font-semibold">Left</th>
            <th scope="col" className="px-3 py-2 font-semibold">Right</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-zinc-50/60'}>
              <th scope="row" className="px-3 py-2 text-left font-medium text-zinc-800">{row.axis}</th>
              <td className="px-3 py-2 text-zinc-700">{row.left}</td>
              <td className="px-3 py-2 text-zinc-700">{row.right}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProfileView({ fields }: { fields: { key: string; value: string }[] }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2" aria-label="Profile fields">
      {fields.map((field, index) => (
        <div key={index} className="rounded-lg border border-amber-100 bg-amber-50/50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-amber-800">{field.key}</dt>
          <dd className="mt-1 text-sm leading-relaxed text-zinc-700">{field.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function RevisionNoteView({ body }: { body: string }) {
  const points = body.split('\n').map((line) => line.trim()).filter(Boolean)
  return (
    <ul className="space-y-2">
      {points.map((point, index) => (
        <li key={index} className="flex gap-2 text-[15px] leading-relaxed text-zinc-700">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
          {point}
        </li>
      ))}
    </ul>
  )
}

function RepresentationCard({ item }: { item: PageRepresentation }) {
  const meta = FORMAT_META[item.format] ?? {
    label: item.format,
    icon: FileText,
    tone: 'border-zinc-200 bg-white text-zinc-700',
  }
  const Icon = meta.icon

  return (
    <Card className="border-zinc-200 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className={`gap-1 ${meta.tone}`}>
                <Icon className="h-3 w-3" aria-hidden="true" />
                {meta.label}
              </Badge>
              {item.aiAssisted && (
                <Badge variant="outline" className="gap-1 border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700">
                  <Bot className="h-3 w-3" aria-hidden="true" />
                  AI-assisted · editorially reviewed
                </Badge>
              )}
            </div>
            <CardTitle className="mt-2 text-lg leading-snug">{item.title}</CardTitle>
          </div>
          <span className="shrink-0 text-xs text-zinc-400">
            Rev {item.revision.number} · {formatDate(item.revision.publishedAt)}
          </span>
        </div>
        {item.revision.changeSummary && (
          <p className="text-xs italic text-zinc-500">“{item.revision.changeSummary}”</p>
        )}
      </CardHeader>
      <CardContent>
        {item.format === 'TIMELINE' && item.parsed?.timeline ? (
          <TimelineView entries={item.parsed.timeline} />
        ) : item.format === 'COMPARISON' && item.parsed?.comparison ? (
          <ComparisonView rows={item.parsed.comparison} />
        ) : item.format === 'PROFILE' && item.parsed?.profile ? (
          <ProfileView fields={item.parsed.profile} />
        ) : item.format === 'REVISION_NOTE' ? (
          <RevisionNoteView body={item.body} />
        ) : item.format === 'CURRENT_EVENT_UPDATE' ? (
          <div className="rounded-lg border border-orange-100 bg-orange-50/40 p-4">
            <ProseBody body={item.body} />
          </div>
        ) : (
          <ProseBody body={item.body} />
        )}
        {item.sourceCount > 0 && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-zinc-500">
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            {item.sourceCount} linked {item.sourceCount === 1 ? 'source' : 'sources'} — see the sources layer below
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------- The assembled reading page ----------

interface KnowledgePageViewProps {
  unitRef: string
  country: string
  language: string
  onOpenUnit: (slug: string) => void
  onSwitchLanguage: (code: string) => void
}

export function KnowledgePageView({
  unitRef,
  country,
  language,
  onOpenUnit,
  onSwitchLanguage,
}: KnowledgePageViewProps) {
  const [page, setPage] = useState<KnowledgePageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ country, language })
        const response = await fetch(`/api/knowledge/page/${unitRef}?${params}`, { cache: 'no-store' })
        const payload = (await response.json()) as Envelope<{ page: KnowledgePageData }>
        if (cancelled) return
        if (payload.status === 'ok' && payload.data) {
          setPage(payload.data.page)
        } else {
          setError(payload.error?.message ?? 'Could not load this page')
        }
      } catch {
        if (!cancelled) setError('Could not load this page')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [country, language, unitRef, reloadKey])

  if (loading && !page) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading knowledge page">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (error || !page) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">
        <p className="flex items-center gap-2 font-medium">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          {error ?? 'Page unavailable'}
        </p>
        <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => setReloadKey((n) => n + 1)}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
        </Button>
      </div>
    )
  }

  const otherTranslations = page.translations.filter((entry) => entry.code !== page.language.code)

  return (
    <article className="space-y-5" aria-label={`Knowledge page: ${page.unit.canonicalName}`}>
      {/* ---------- Breadcrumb + header (§22) ---------- */}
      <nav aria-label="Topic path" className="flex flex-wrap items-center gap-1 text-xs text-zinc-500">
        {page.topic.path.map((entry, index) => (
          <span key={entry.slug} className="flex items-center gap-1">
            {index > 0 && <span aria-hidden="true" className="text-zinc-300">›</span>}
            {entry.label}
          </span>
        ))}
      </nav>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1 font-normal">
            <Tag className="h-3 w-3" aria-hidden="true" />
            {page.unit.type}
          </Badge>
          <Badge variant="outline" className="font-normal text-zinc-600">
            {page.unit.difficulty}
          </Badge>
          {page.unit.scope === 'GLOBAL' ? (
            <Badge variant="outline" className="font-normal text-teal-700">Global knowledge</Badge>
          ) : (
            <Badge variant="outline" className="font-normal text-zinc-600">{page.unit.countryIso ?? '—'} specific</Badge>
          )}
          <span className="text-xs text-zinc-400">
            reading in {page.language.nativeName ?? page.language.name}
          </span>
        </div>
        <h3 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl">
          {page.unit.canonicalName}
        </h3>
        {page.quickFact.source === 'FACT_CARD' && page.quickFact.title && page.quickFact.title !== page.unit.canonicalName && (
          <p className="text-sm text-zinc-500">{page.quickFact.title}</p>
        )}
      </header>

      {/* ---------- §22 layer 1: quick fact ---------- */}
      <Card className="border-emerald-200 bg-emerald-50/60 shadow-sm">
        <CardContent className="flex gap-3 p-4 sm:p-5">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600/10 text-emerald-700">
            <Lightbulb className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">
              Quick fact {page.quickFact.source === 'CANONICAL_SUMMARY' && '· from the canonical record'}
            </p>
            <p className="mt-1 text-[15px] leading-relaxed text-zinc-800">{page.quickFact.body}</p>
          </div>
        </CardContent>
      </Card>

      {/* ---------- §35 translation surface ---------- */}
      {otherTranslations.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
          <span>Also published in</span>
          {otherTranslations.map((entry) => (
            <button
              key={entry.code}
              type="button"
              onClick={() => onSwitchLanguage(entry.code)}
              className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-zinc-200 bg-white px-3 font-medium text-zinc-700 transition-colors hover:border-emerald-300 hover:text-emerald-700"
              aria-label={`Read this page in ${entry.nativeName ?? entry.name}`}
            >
              <Sparkles className="h-3 w-3" aria-hidden="true" />
              {entry.nativeName ?? entry.name}
            </button>
          ))}
        </div>
      )}

      {/* ---------- §19 scheduled note ---------- */}
      {page.scheduledCount > 0 && (
        <p className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
          <Clock className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          {page.scheduledCount} reviewed {page.scheduledCount === 1 ? 'representation is' : 'representations are'} scheduled
          to go live automatically (§19) — refresh after the scheduled time.
        </p>
      )}

      {/* ---------- §22 layer 2: deeper explanation (§23 format-aware) ---------- */}
      {page.representations.length > 0 ? (
        <div className="space-y-4">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            <FileText className="h-4 w-4 text-emerald-600" aria-hidden="true" />
            Learn — deeper explanation
          </h4>
          {page.representations.map((item) => (
            <RepresentationCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600" role="status">
          <p className="font-medium text-zinc-800">Not yet published in {page.language.nativeName ?? page.language.name}</p>
          <p className="mt-1">
            The canonical record above is always available. A published {page.language.name} representation of this
            knowledge will appear here once the editorial workflow (§19) releases it.
          </p>
        </div>
      )}

      {/* ---------- §22 layer 3: sources (§24) ---------- */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Sources — provenance
        </h4>
        {page.sources.length > 0 ? (
          <ul className="space-y-2">
            {page.sources.map((source) => (
              <li key={source.id} className="rounded-lg border border-zinc-200 bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 text-sm font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-2 hover:text-emerald-700"
                  >
                    {source.title}
                  </a>
                  {verificationBadge(source.verification)}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  {source.publisher} · {source.type} · published {formatDate(source.publishedAt)}
                </p>
                {source.claim && (
                  <p className="mt-1 text-xs italic text-zinc-600">Supports: “{source.claim}”</p>
                )}
                <p className="mt-1.5 flex flex-wrap gap-1">
                  {source.citedBy.map((cite) => (
                    <span
                      key={cite.itemId}
                      className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500"
                    >
                      {cite.format}
                    </span>
                  ))}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-500">
            No evidence links on the displayed representations (§24 — provenance attaches per representation).
          </p>
        )}
      </div>

      {/* ---------- §22 layer 4: related concepts ---------- */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <Sparkles className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Related concepts — same topic
        </h4>
        {page.related.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {page.related.map((unit) => (
              <button
                key={unit.slug}
                type="button"
                onClick={() => onOpenUnit(unit.slug)}
                className="group min-h-[44px] rounded-lg border border-zinc-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-emerald-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold leading-snug text-zinc-800 group-hover:text-emerald-700">
                    {unit.canonicalName}
                  </p>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-300 group-hover:text-emerald-600" aria-hidden="true" />
                </div>
                {unit.canonicalSummary && (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{unit.canonicalSummary}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="secondary" className="font-normal text-[10px]">{unit.type}</Badge>
                  <Badge variant="outline" className="font-normal text-[10px] text-zinc-500">{unit.difficulty}</Badge>
                  {unit.availableLanguages.length > 0 ? (
                    <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                      read in {unit.availableLanguages.join(' · ')}
                    </span>
                  ) : (
                    <span className="text-[10px] text-zinc-400">canonical record only</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-white p-3 text-xs text-zinc-500">
            No sibling units under this topic yet.
          </p>
        )}
      </div>

      {/* ---------- §22 layer 5: exam coverage (P3 placeholder) ---------- */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          <GraduationCap className="h-4 w-4 text-emerald-600" aria-hidden="true" />
          Exam coverage
        </h4>
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-zinc-700">
            <ScrollText className="h-4 w-4 text-zinc-400" aria-hidden="true" />
            Arrives with exam mappings (Phase 3)
          </p>
          <p className="mt-1 text-xs leading-relaxed text-zinc-500">{page.examCoverage.note}</p>
        </div>
      </div>

      <Separator />

      {/* ---------- §16 canonical path ---------- */}
      <p className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-zinc-400">
        <Link2 className="h-3 w-3" aria-hidden="true" />
        <span className="uppercase tracking-wide">Canonical (§16):</span>
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-zinc-600">{page.canonicalPath}</span>
        <span className="font-sans text-zinc-400">— one stable URL per representation; real routes land in P4.</span>
      </p>
    </article>
  )
}
