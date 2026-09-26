/**
 * GlobIQ — Search module: the public query service (P4-S1)
 * Master Plan §17 (Search Strategy — every clause implemented here):
 *   exact + prefix matching (§17.1)  → EXACT/PREFIX tiers on title & aliases
 *   typo tolerance (§17.2)           → pg_trigm similarity tiers
 *   language-aware tokenisation       → engine FTS configs (en:english/hi:hindi)
 *   synonyms & editorial aliases      → §13 TopicAlias baked into documents
 *   country-aware filtering (§17.5)   → §14/§15 server-side scope on every call
 *   exam-aware boosting (§17.6)       → current-syllabus boost + explanation
 *   freshness boosting (§17.7)        → freshnessAt recency bonus
 *   canonical dedup in results (§17.8)→ one row per (objectType, ref)
 *   explain why relevant (§17.9)      → matchReasons on every result
 * plus §16 (paths built ONLY via buildCanonicalUrl — never concatenated),
 * §35 (reader-language surface first; canonical fallback never invents
 * translations) and §37 (deterministic ordering, client-agnostic DTOs).
 */
import { db } from '@/lib/db'

import {
  buildCanonicalUrl,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'

import {
  SEARCH_ENGINE_ID,
  type SearchCandidate,
  countSearchDocuments,
  lastIndexedAt,
  querySearchCandidates,
} from './engine'
import { SearchError } from './errors'
import type {
  SearchMatchedVia,
  SearchQueryInput,
  SearchResultExamRef,
  SearchResultItem,
  SearchResponse,
} from './types'

// ---------- §36 window semantics (mirrored — see indexing-service note) ----------

const DAY_MS = 24 * 60 * 60 * 1000

function versionIsCurrent(
  version: { effectiveFrom: Date; effectiveTo: Date | null },
  now = Date.now()
): boolean {
  if (version.effectiveFrom.getTime() > now) return false
  return version.effectiveTo == null || now < version.effectiveTo.getTime() + DAY_MS
}

// ---------- Ranking vocabulary (§17 tiers — portable across engines) ----------

/**
 * Tier scores are alternatives (a result is scored by its STRONGEST match),
 * boosts are additive. The canonical-fallback lane is capped below the
 * reader-language lane so a real translation always outranks a fallback.
 */
const TIER = {
  EXACT_TITLE: 1000,
  EXACT_ALIAS: 950,
  TITLE_PREFIX: 800,
  ALIAS_PREFIX: 760,
  TITLE_CONTAINS: 700,
  FTS: 500, // + up to 100 from ts_rank
  NEUTRAL_FTS_READER: 450, // canonical name/alias matched in the reader's language doc
  FUZZY_TITLE: 300, // + titleSim * 200
  FUZZY_BODY: 250, // + bodyWsim * 100
  // Canonical-fallback lane (§35 — no published surface in the reader language)
  FALLBACK_EXACT: 600,
  FALLBACK_PREFIX: 550,
  FALLBACK_CONTAINS: 500,
  FALLBACK_FTS: 400, // + up to 100 from ts_rank
  FALLBACK_FUZZY: 200, // + neutralSim * 200
} as const

const BOOST = {
  READER_LANGUAGE: 60,
  EXAM_MATCH: 120,
  FRESHNESS_MAX: 30,
  FRESHNESS_WINDOW_DAYS: 30,
} as const

/** §37 deterministic ordering after the score: knowledge first (the §7 core
 * object), then exams, then topics; then title, then ref. */
const TYPE_RANK: Record<string, number> = { KNOWLEDGE_UNIT: 0, EXAM: 1, TOPIC: 2 }

interface ScoredCandidate {
  candidate: SearchCandidate
  score: number
  matchedVia: SearchMatchedVia
  reasons: string[]
}

// ---------- Reader-country exam projection (§17.6/§17.9 + §14) ----------

/**
 * The reader's country's ACTIVE exams that have a CURRENT §36 version — the
 * boosting/explanation set. Cross-country requirements never enter: §14/§15
 * are enforced here exactly as on every other public read.
 */
async function currentExamsForCountry(
  countryId: string
): Promise<Array<SearchResultExamRef & { versionId: string }>> {
  const exams = await db.exam.findMany({
    where: { countryId, status: 'ACTIVE' },
    select: {
      slug: true,
      name: true,
      code: true,
      versions: { select: { id: true, effectiveFrom: true, effectiveTo: true } },
    },
    orderBy: { name: 'asc' },
  })
  const result: Array<SearchResultExamRef & { versionId: string }> = []
  for (const exam of exams) {
    const current = exam.versions.find((version) => versionIsCurrent(version))
    if (current) {
      result.push({ slug: exam.slug, name: exam.name, code: exam.code, versionId: current.id })
    }
  }
  return result
}

// ---------- Scoring (§17 tiers) ----------

interface TierResult {
  score: number
  matchedVia: SearchMatchedVia
  reason: string
}

/** §17.2 typo tolerance needs ≥4 characters to be meaningful — short queries
 * match through the exact/prefix/contains/FTS tiers only (a 2-char trigram
 * match like "fr" ~ "from" is noise, not typo tolerance). */
const FUZZY_MIN_QUERY_LENGTH = 4

/** Title-similarity floor for the fuzzy tier — set so real typos of real
 * titles land inside it ("chandrayan" vs the Chandrayaan-3 title ≈ 0.29). */
const FUZZY_TITLE_THRESHOLD = 0.25

function scoreReaderLanguageDoc(candidate: SearchCandidate, qLower: string): TierResult | null {
  const titleLower = candidate.title.toLowerCase()
  const aliasesLower = candidate.aliases?.map((alias) => alias.toLowerCase()) ?? []

  // §17.1 exact + prefix — the strongest signals a user can get.
  if (titleLower === qLower) {
    return { score: TIER.EXACT_TITLE, matchedVia: 'exact_title', reason: 'Exact title match' }
  }
  const exactAlias = aliasesLower.find((alias) => alias === qLower)
  if (exactAlias) {
    return {
      score: TIER.EXACT_ALIAS,
      matchedVia: 'exact_alias',
      reason: `Alias match: "${exactAlias}"`,
    }
  }
  if (titleLower.startsWith(qLower)) {
    return { score: TIER.TITLE_PREFIX, matchedVia: 'title_prefix', reason: 'Title prefix match' }
  }
  const prefixAlias = aliasesLower.find((alias) => alias.startsWith(qLower))
  if (prefixAlias) {
    return {
      score: TIER.ALIAS_PREFIX,
      matchedVia: 'alias_prefix',
      reason: `Alias prefix: "${prefixAlias}"`,
    }
  }
  if (titleLower.includes(qLower)) {
    return { score: TIER.TITLE_CONTAINS, matchedVia: 'title_contains', reason: 'Title contains the query' }
  }
  // Language-aware full text (§17.4) — ts_rank differentiates within the tier.
  if (candidate.langFts) {
    return {
      score: TIER.FTS + Math.min(100, candidate.langRank * 400),
      matchedVia: 'full_text',
      reason: 'Full-text match in this language',
    }
  }
  if (candidate.neutralFts) {
    return {
      score: TIER.NEUTRAL_FTS_READER + Math.min(100, candidate.neutralRank * 400),
      matchedVia: 'neutral_full_text',
      reason: 'Canonical name or alias match',
    }
  }
  // §17.2 typo tolerance — trigram tiers.
  if (qLower.length >= FUZZY_MIN_QUERY_LENGTH && candidate.titleSim >= FUZZY_TITLE_THRESHOLD) {
    return {
      score: TIER.FUZZY_TITLE + candidate.titleSim * 200,
      matchedVia: 'fuzzy',
      reason: 'Close title match (typo-tolerant)',
    }
  }
  if (qLower.length >= FUZZY_MIN_QUERY_LENGTH && candidate.bodyWsim >= 0.5) {
    return {
      score: TIER.FUZZY_BODY + candidate.bodyWsim * 100,
      matchedVia: 'fuzzy',
      reason: 'Close text match (typo-tolerant)',
    }
  }
  return null
}

function scoreFallbackDoc(candidate: SearchCandidate, qLower: string): TierResult | null {
  // §35 canonical-fallback lane: the object has NO published surface in the
  // reader's language — it is findable only through its canonical identity.
  const canonicalLower = candidate.canonicalName.toLowerCase()
  const aliasesLower = candidate.aliases?.map((alias) => alias.toLowerCase()) ?? []

  if (canonicalLower === qLower || aliasesLower.includes(qLower)) {
    return {
      score: TIER.FALLBACK_EXACT,
      matchedVia: 'exact_title',
      reason: 'Exact canonical-name match',
    }
  }
  if (
    canonicalLower.startsWith(qLower) ||
    aliasesLower.some((alias) => alias.startsWith(qLower)) ||
    canonicalLower.includes(qLower)
  ) {
    return {
      score: TIER.FALLBACK_PREFIX,
      matchedVia: 'neutral_prefix',
      reason: 'Canonical-name match (no published content in this language yet)',
    }
  }
  if (candidate.neutralFts) {
    return {
      score: TIER.FALLBACK_FTS + Math.min(100, candidate.neutralRank * 400),
      matchedVia: 'neutral_full_text',
      reason: 'Canonical name or alias match (no published content in this language yet)',
    }
  }
  if (qLower.length >= FUZZY_MIN_QUERY_LENGTH && candidate.neutralSim >= 0.25) {
    return {
      score: TIER.FALLBACK_FUZZY + candidate.neutralSim * 200,
      matchedVia: 'neutral_fuzzy',
      reason: 'Close canonical-name match (typo-tolerant)',
    }
  }
  return null
}

// ---------- §16 path builder (the single source of URL truth) ----------

function resultPath(
  country: { slug: string; isDefault: boolean },
  languageCode: string,
  defaultLanguageCode: string,
  candidate: SearchCandidate
): string {
  const segments =
    candidate.objectType === 'KNOWLEDGE_UNIT'
      ? ['gk', candidate.topicSlug ?? candidate.ref, candidate.ref]
      : candidate.objectType === 'TOPIC'
        ? ['gk', candidate.ref]
        : ['exams', candidate.ref]
  return buildCanonicalUrl(country, { code: languageCode }, defaultLanguageCode, segments)
}

// ---------- Public search ----------

/**
 * Runs one search in a country + language context (§14/§15/§35) and returns
 * the §37 envelope payload: deterministic results with §16 canonical paths
 * (in the reader's language), §17 explanations, and index health.
 */
export async function publicSearch(query: SearchQueryInput): Promise<SearchResponse> {
  const startedAt = Date.now()

  // ---------- Locale (§35: only languages the country configures) ----------
  let resolution
  try {
    resolution = await resolveLocaleContext({
      country: query.country,
      language: query.language,
    })
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new SearchError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }
  if (resolution.country.status === 'COMING_SOON') {
    throw new SearchError(
      'COUNTRY_NOT_FOUND',
      `"${resolution.country.name}" has not launched yet — search becomes available when the market goes live`
    )
  }
  const countryShape = {
    slug: resolution.country.slug,
    isDefault: resolution.country.isDefault,
  }
  const readerLanguage = resolution.language.code
  const countryRow = await db.country.findUnique({
    where: { isoCode: resolution.country.isoCode },
    select: { id: true, defaultLanguage: { select: { code: true } } },
  })
  if (!countryRow?.defaultLanguage) {
    throw new SearchError('COUNTRY_NOT_FOUND', 'Country configuration is incomplete')
  }
  const defaultLanguageCode = countryRow.defaultLanguage.code

  // ---------- §17.6 exam-aware context (reader country only, §14) ----------
  const currentExams = await currentExamsForCountry(countryRow.id)
  const examBySlug = new Map(currentExams.map((exam) => [exam.slug, exam]))

  // §8 exam filter — validated inside the reader's country: another market's
  // exam is a clean 404, exactly like the exam detail read (§15).
  let examFilter: (SearchResultExamRef & { versionId: string }) | null = null
  if (query.exam) {
    examFilter = examBySlug.get(query.exam.toLowerCase()) ?? null
    if (!examFilter) {
      throw new SearchError(
        'EXAM_NOT_FOUND',
        'This exam is not part of the selected country\'s live exam directory'
      )
    }
  }

  // ---------- Engine candidates (§29 port) ----------
  const objectTypes =
    query.type === 'units'
      ? (['KNOWLEDGE_UNIT'] as const)
      : query.type === 'exams'
        ? (['EXAM'] as const)
        : query.type === 'topics'
          ? (['TOPIC'] as const)
          : (['KNOWLEDGE_UNIT', 'EXAM', 'TOPIC'] as const)

  const candidates = await querySearchCandidates({
    q: query.q,
    countryIso: resolution.country.isoCode,
    languageCode: readerLanguage,
    objectTypes: [...objectTypes],
    examRef: examFilter?.slug,
  })

  // ---------- Score + boost (§17 tiers) ----------
  const qLower = query.q.toLowerCase()
  const now = Date.now()
  const scored: ScoredCandidate[] = []

  for (const candidate of candidates) {
    const isReaderLanguage = candidate.languageCode === readerLanguage
    const tier = isReaderLanguage
      ? scoreReaderLanguageDoc(candidate, qLower)
      : scoreFallbackDoc(candidate, qLower)
    if (!tier) continue

    const reasons: string[] = [tier.reason]
    let score = tier.score

    if (isReaderLanguage) score += BOOST.READER_LANGUAGE

    // §17.6 exam-aware boost + explanation — reader-country exams only (§14).
    const unitExams = currentExams.filter(
      (exam) => candidate.examRefs?.includes(exam.slug) ?? false
    )
    if (unitExams.length > 0) {
      score += BOOST.EXAM_MATCH
      for (const exam of unitExams) {
        reasons.push(`In the current ${exam.name} syllabus`)
      }
    }

    // §17.7 freshness boost (current-affairs events join here in P6).
    const ageDays = (now - candidate.freshnessAt.getTime()) / DAY_MS
    if (ageDays >= 0 && ageDays < BOOST.FRESHNESS_WINDOW_DAYS) {
      score += Math.round(
        BOOST.FRESHNESS_MAX * (1 - ageDays / BOOST.FRESHNESS_WINDOW_DAYS)
      )
      if (ageDays < 14) reasons.push('Recently updated')
    }

    scored.push({ candidate, score, matchedVia: tier.matchedVia, reasons })
  }

  // ---------- §17.8 canonical-object deduplication ----------
  // One row per (objectType, ref): the reader-language document wins over the
  // same object's other-language document (its lane scores higher by design).
  const bestByObject = new Map<string, ScoredCandidate>()
  for (const entry of scored) {
    const key = `${entry.candidate.objectType}:${entry.candidate.ref}`
    const existing = bestByObject.get(key)
    if (
      !existing ||
      entry.score > existing.score ||
      (entry.score === existing.score &&
        entry.candidate.languageCode === readerLanguage &&
        existing.candidate.languageCode !== readerLanguage)
    ) {
      bestByObject.set(key, entry)
    }
  }
  const ranked = [...bestByObject.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (TYPE_RANK[a.candidate.objectType] ?? 9) - (TYPE_RANK[b.candidate.objectType] ?? 9) ||
      a.candidate.title.localeCompare(b.candidate.title) ||
      a.candidate.ref.localeCompare(b.candidate.ref)
  )

  // ---------- §37 pagination ----------
  const total = ranked.length
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize))
  const page = Math.min(query.page, totalPages)
  const window = ranked.slice((page - 1) * query.pageSize, page * query.pageSize)

  // ---------- Result DTOs ----------
  const results: SearchResultItem[] = window.map(({ candidate, score, matchedVia, reasons }) => {
    const isReaderLanguage = candidate.languageCode === readerLanguage
    const unitExams = currentExams.filter(
      (exam) => candidate.examRefs?.includes(exam.slug) ?? false
    )
    return {
      objectType: candidate.objectType,
      ref: candidate.ref,
      title: isReaderLanguage ? candidate.title : candidate.canonicalName,
      summary: candidate.summary,
      languageCode: candidate.languageCode,
      presentedFrom: isReaderLanguage ? 'reader_language' : 'canonical_fallback',
      urlPath: resultPath(countryShape, readerLanguage, defaultLanguageCode, candidate),
      topicSlug: candidate.topicSlug,
      topicLabel: candidate.topicLabel,
      unitType: candidate.unitType,
      difficulty: candidate.difficulty,
      exams: unitExams.map(({ slug, name, code }) => ({ slug, name, code })),
      matchedVia,
      matchReasons: reasons,
      score: Math.round(score),
    }
  })

  // ---------- Index health (§29 engine identity on every response) ----------
  const [documents, lastIndexed] = await Promise.all([countSearchDocuments(), lastIndexedAt()])

  return {
    query: {
      q: query.q,
      country: { isoCode: resolution.country.isoCode, name: resolution.country.name },
      language: {
        code: readerLanguage,
        name: resolution.language.name,
        nativeName: resolution.language.nativeName,
      },
      type: query.type,
      exam: examFilter ? { slug: examFilter.slug, name: examFilter.name, code: examFilter.code } : null,
    },
    results,
    pagination: { page, pageSize: query.pageSize, total, totalPages },
    index: {
      engine: SEARCH_ENGINE_ID,
      documents,
      lastIndexedAt: lastIndexed?.toISOString() ?? null,
      tookMs: Date.now() - startedAt,
    },
  }
}
