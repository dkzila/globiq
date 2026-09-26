/**
 * GlobIQ — Knowledge: canonical reading-page service (P2-S5)
 * Master Plan §22 (the knowledge page assembles: quick fact + deeper
 * explanation + related concepts + sources + exam coverage), §7 (the page is
 * an ASSEMBLY of one canonical record's representations — nothing is
 * duplicated or re-entered), §16 (canonical URL from country + language +
 * object identity via the country-locale URL builder — never user input),
 * §23 (format-aware parsing — each format exposes its own shape), §24
 * (provenance surfaces with the reading experience), §35 (only the country's
 * configured languages; only ACTUAL published translations exposed), §37
 * (client-agnostic JSON, deterministic ordering, explicit errors), §38
 * (public surface — everyone, no auth), §43 (P2-S5 scope).
 *
 * The service composes the existing public read paths (unit visibility from
 * P2-S1, live-revision content from P2-S2, provenance from P2-S3, scheduled
 * materialization from P2-S4) — it never bypasses their visibility chains.
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import {
  buildCanonicalUrl,
  findActiveCountryByIso,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import { getPublicTopic, getTopicIdentity, TaxonomyError } from '@/modules/taxonomy'

import { materializeDueScheduledContent } from './content-service'
import type { ContentFormatPublic } from './content-types'
import { KnowledgeError } from './service'
import { getPublicSourcesForItem } from './source-service'
import type {
  ComparisonRow,
  ExamCoverageLayer,
  KnowledgePage,
  PageRepresentation,
  PageSource,
  ProfileField,
  RelatedUnit,
  TimelineEntry,
} from './render-types'
import { PAGE_FORMAT_ORDER } from './render-types'

// ---------- Constants ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** §22 related-concepts layer — sibling VERIFIED units under the same topic. */
const RELATED_LIMIT = 6

/** §22 layer 5 — the exam-coverage placeholder until ExamMapping (P3). */
const EXAM_COVERAGE_PLACEHOLDER: ExamCoverageLayer = {
  available: false,
  note: 'Exam coverage arrives with exam mappings (Phase 3): every published mapping of this unit — exam, syllabus topic and required depth — will render here.',
}

const PAGE_ITEM_INCLUDE = {
  language: true,
  publishedRevision: true,
  _count: { select: { sourceLinks: true } },
} satisfies Prisma.ContentItemInclude

type PageItemRow = Prisma.ContentItemGetPayload<{ include: typeof PAGE_ITEM_INCLUDE }>

// ---------- §23 format-aware parsing ----------
//
// Lenient by design: validation (P2-S2) bounds each format's body; these
// parsers surface the documented per-format shapes when present and return
// null otherwise — the raw `body` always ships alongside, so no client ever
// loses information.

/** TIMELINE — the §23 convention "date — event", one per line. */
function parseTimeline(body: string): TimelineEntry[] | null {
  const entries: TimelineEntry[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^(.+?)\s+[—–]\s+(.+)$/.exec(trimmed)
    if (match) entries.push({ date: match[1]!.trim(), event: match[2]!.trim() })
  }
  return entries.length >= 2 ? entries : null
}

/** COMPARISON — "axis | left | right" rows. */
function parseComparison(body: string): ComparisonRow[] | null {
  const rows: ComparisonRow[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split('|').map((part) => part.trim())
    if (parts.length === 3 && parts.every((part) => part.length > 0)) {
      rows.push({ axis: parts[0]!, left: parts[1]!, right: parts[2]! })
    }
  }
  return rows.length >= 2 ? rows : null
}

/** PROFILE — "key: value" fields (short keys, one per line). */
function parseProfile(body: string): ProfileField[] | null {
  const fields: ProfileField[] = []
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const separator = trimmed.indexOf(':')
    if (separator > 0 && separator <= 40) {
      const key = trimmed.slice(0, separator).trim()
      const value = trimmed.slice(separator + 1).trim()
      if (key && value) fields.push({ key, value })
    }
  }
  return fields.length >= 2 ? fields : null
}

function parseRepresentation(format: ContentFormatPublic, body: string) {
  if (format === 'TIMELINE') {
    const timeline = parseTimeline(body)
    return timeline ? { timeline } : null
  }
  if (format === 'COMPARISON') {
    const comparison = parseComparison(body)
    return comparison ? { comparison } : null
  }
  if (format === 'PROFILE') {
    const profile = parseProfile(body)
    return profile ? { profile } : null
  }
  return null
}

// ---------- Internal helpers ----------

function toPageRepresentation(item: PageItemRow): PageRepresentation | null {
  // Defense in depth (P2-S2 contract): public content is the live revision.
  if (!item.publishedRevision) return null
  return {
    id: item.id,
    format: item.format as ContentFormatPublic,
    title: item.publishedRevision.title,
    body: item.publishedRevision.body,
    parsed: parseRepresentation(item.format as ContentFormatPublic, item.publishedRevision.body),
    revision: {
      number: item.publishedRevision.revisionNumber,
      publishedAt: item.publishedRevision.publishedAt.toISOString(),
      changeSummary: item.publishedRevision.changeSummary,
    },
    aiAssisted: item.publishedRevision.aiAssisted,
    sourceCount: item._count.sourceLinks,
  }
}

/** §16 knowledge-page path: …/gk/{topic}/{unit}/ under the locale prefix. */
function knowledgePath(
  country: { slug: string; isDefault: boolean },
  languageCode: string,
  defaultLanguageCode: string,
  topicSlug: string,
  unitSlug: string
): string {
  return buildCanonicalUrl(country, { code: languageCode }, defaultLanguageCode, [
    'gk',
    topicSlug,
    unitSlug,
  ])
}

// ---------- Public reads ----------

/**
 * Assembles the §22 knowledge page for one canonical unit in a country +
 * language context: the canonical record, the quick fact, the format-aware
 * deeper representations, the §24 sources layer, related concepts, and the
 * exam-coverage placeholder (P3). Country scope and the topic visibility
 * chain are enforced here exactly as on the P2-S1 read paths (§14/§15).
 */
export async function getKnowledgePage(
  ref: string,
  input: { country?: string; language?: string }
): Promise<KnowledgePage> {
  // ---------- Canonical record ----------
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(ref) ? { id: ref } : { slug: ref.toLowerCase() },
  })
  if (!unit) throw new KnowledgeError('KU_NOT_FOUND', 'Knowledge unit not found')

  // ---------- Locale (§35: only languages the country configures) ----------
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new KnowledgeError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }
  const country = await getPublicCountry(resolution.country.isoCode)
  const countryRow = await findActiveCountryByIso(resolution.country.isoCode)
  if (!country || !countryRow) {
    throw new KnowledgeError('COUNTRY_NOT_FOUND', 'Country not available')
  }

  // ---------- Visibility chain (§14/§15 — never looser than P2-S1) ----------
  if (unit.status !== 'VERIFIED') {
    throw new KnowledgeError('KU_NOT_FOUND', 'Knowledge unit not found')
  }
  if (unit.scope === 'COUNTRY' && unit.countryId !== countryRow.id) {
    throw new KnowledgeError('KU_NOT_VISIBLE', 'This knowledge unit is not available in the selected country')
  }
  let topicDetail
  try {
    topicDetail = await getPublicTopic(unit.topicId, {
      country: input.country,
      language: input.language,
    })
  } catch (error) {
    if (error instanceof TaxonomyError) {
      throw new KnowledgeError('KU_NOT_VISIBLE', 'This knowledge unit is not available in the selected country')
    }
    throw error
  }

  // ---------- §19: due scheduled releases go live before assembling ----------
  await materializeDueScheduledContent({ unitId: unit.id })

  // ---------- Representations in the resolved language ----------
  const languageRow = await db.language.findFirst({
    where: { code: resolution.language.code, status: 'ACTIVE' },
  })
  if (!languageRow) {
    throw new KnowledgeError('COUNTRY_NOT_FOUND', 'Language not available')
  }

  const liveItems = (
    await db.contentItem.findMany({
      where: {
        knowledgeUnitId: unit.id,
        status: 'PUBLISHED',
        publishedRevisionId: { not: null },
        languageId: languageRow.id,
      },
      include: PAGE_ITEM_INCLUDE,
    })
  )
    .map(toPageRepresentation)
    .filter((item): item is PageRepresentation => item != null)

  const factCard = liveItems.find((item) => item.format === 'FACT_CARD') ?? null
  const representations = liveItems
    .filter((item) => item.format !== 'FACT_CARD')
    .sort(
      (a, b) =>
        PAGE_FORMAT_ORDER.indexOf(a.format) - PAGE_FORMAT_ORDER.indexOf(b.format) ||
        a.title.localeCompare(b.title) // deterministic (§37)
    )

  // ---------- §22 quick-fact layer ----------
  const quickFact = factCard
    ? { source: 'FACT_CARD' as const, title: factCard.title, body: factCard.body }
    : {
        source: 'CANONICAL_SUMMARY' as const,
        title: null,
        body: unit.canonicalSummary ?? unit.canonicalBody,
      }

  // ---------- §24 sources layer (aggregated over displayed representations) ----------
  const sourcesById = new Map<string, PageSource>()
  for (const item of factCard ? [factCard, ...representations] : representations) {
    const links = await getPublicSourcesForItem(item.id)
    for (const link of links) {
      const existing = sourcesById.get(link.id)
      if (existing) {
        existing.citedBy.push({ itemId: item.id, title: item.title, format: item.format })
      } else {
        sourcesById.set(link.id, {
          id: link.id,
          title: link.title,
          publisher: link.publisher,
          url: link.url,
          type: link.type,
          verification: link.verification,
          publishedAt: link.publishedAt,
          retrievedAt: link.retrievedAt,
          verifiedAt: link.verifiedAt,
          claim: link.claim,
          citedBy: [{ itemId: item.id, title: item.title, format: item.format }],
        })
      }
    }
  }
  const sources = [...sourcesById.values()].sort(
    (a, b) =>
      // VERIFIED evidence first (§24 trust ordering), then by title (§37).
      Number(b.verification === 'VERIFIED') - Number(a.verification === 'VERIFIED') ||
      a.title.localeCompare(b.title)
  )

  // ---------- §22 related-concepts layer ----------
  const relatedUnits = await db.knowledgeUnit.findMany({
    where: {
      topicId: unit.topicId,
      id: { not: unit.id },
      status: 'VERIFIED',
      OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: countryRow.id }],
    },
    orderBy: [{ orderIndex: 'asc' }, { canonicalName: 'asc' }],
    take: RELATED_LIMIT,
    select: { slug: true, canonicalName: true, canonicalSummary: true, type: true, difficulty: true },
  })

  // §35 "read it in…" — the country-configured languages that actually carry
  // a published representation (for the related cards and this page's
  // translation surface; planned/unpublished languages never appear).
  const countryLanguageIds = new Map<string, string>()
  for (const ref of country.languages) {
    const language = await db.language.findFirst({
      where: { code: ref.code, status: 'ACTIVE' },
      select: { id: true, code: true },
    })
    if (language) countryLanguageIds.set(language.code, language.id)
  }

  const relatedIds = relatedUnits.length
    ? await db.knowledgeUnit.findMany({
        where: { slug: { in: relatedUnits.map((row) => row.slug) } },
        select: { id: true, slug: true },
      })
    : []
  const idBySlug = new Map(relatedIds.map((row) => [row.slug, row.id]))
  const languagesByUnit = new Map<string, Set<string>>()
  const languageCodeById = new Map([...countryLanguageIds.entries()].map(([code, id]) => [id, code]))
  if (relatedUnits.length) {
    const grouped = await db.contentItem.groupBy({
      by: ['knowledgeUnitId', 'languageId'],
      where: {
        knowledgeUnitId: { in: relatedIds.map((row) => row.id) },
        status: 'PUBLISHED',
        publishedRevisionId: { not: null },
        languageId: { in: [...countryLanguageIds.values()] },
      },
      _count: { _all: true },
    })
    for (const row of grouped) {
      const code = languageCodeById.get(row.languageId)
      if (!code) continue
      const set = languagesByUnit.get(row.knowledgeUnitId) ?? new Set<string>()
      set.add(code)
      languagesByUnit.set(row.knowledgeUnitId, set)
    }
  }

  const related: RelatedUnit[] = relatedUnits.map((row) => ({
    slug: row.slug,
    canonicalName: row.canonicalName,
    canonicalSummary: row.canonicalSummary,
    type: row.type,
    difficulty: row.difficulty,
    availableLanguages: [...(languagesByUnit.get(idBySlug.get(row.slug) ?? '') ?? [])].sort(),
    canonicalPath: knowledgePath(
      country,
      resolution.language.code,
      country.defaultLanguage.code,
      topicDetail.node.slug,
      row.slug
    ),
  }))

  // ---------- §35 translation surface (this unit, this country) ----------
  const translationRows = await db.contentItem.findMany({
    where: {
      knowledgeUnitId: unit.id,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      languageId: { in: [...countryLanguageIds.values()] },
    },
    select: { languageId: true },
  })
  const unitLanguageCodes = new Set(
    translationRows.map((row) => languageCodeById.get(row.languageId)).filter((code): code is string => !!code)
  )
  const translations = country.languages
    .filter((ref) => unitLanguageCodes.has(ref.code))
    .map((ref) => ({
      code: ref.code,
      name: ref.name,
      nativeName: ref.nativeName,
      canonicalPath: knowledgePath(
        country,
        ref.code,
        country.defaultLanguage.code,
        topicDetail.node.slug,
        unit.slug
      ),
    }))
    .sort((a, b) => a.code.localeCompare(b.code))

  // ---------- §19 scheduled releases pending for this unit ----------
  const scheduledCount = await db.contentItem.count({
    where: {
      knowledgeUnitId: unit.id,
      status: 'SCHEDULED',
      scheduledForAt: { gt: new Date() },
    },
  })

  // ---------- §16 canonical path of THIS page ----------
  const canonicalPath = knowledgePath(
    country,
    resolution.language.code,
    country.defaultLanguage.code,
    topicDetail.node.slug,
    unit.slug
  )

  const topicIdentity = await getTopicIdentity(unit.topicId)

  return {
    unit: {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      canonicalSummary: unit.canonicalSummary,
      canonicalBody: unit.canonicalBody,
      type: unit.type,
      difficulty: unit.difficulty,
      scope: unit.scope as 'GLOBAL' | 'COUNTRY',
      countryIso: unit.scope === 'COUNTRY' ? topicIdentity?.countryIso ?? null : null,
      validity: {
        validFrom: unit.validFrom?.toISOString() ?? null,
        validUntil: unit.validUntil?.toISOString() ?? null,
      },
      createdAt: unit.createdAt.toISOString(),
      updatedAt: unit.updatedAt.toISOString(),
    },
    topic: {
      slug: topicDetail.node.slug,
      canonicalName: topicDetail.node.canonicalName,
      label: topicDetail.node.label,
      labelLanguage: topicDetail.node.labelLanguage,
      path: topicDetail.path.map((entry) => ({ slug: entry.slug, label: entry.label })),
    },
    quickFact,
    representations,
    sources,
    related,
    examCoverage: EXAM_COVERAGE_PLACEHOLDER,
    language: {
      code: resolution.language.code,
      name: resolution.language.name,
      nativeName: resolution.language.nativeName,
    },
    translations,
    canonicalPath,
    scheduledCount,
  }
}
