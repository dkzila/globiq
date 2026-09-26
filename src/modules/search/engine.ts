/**
 * GlobIQ — Search module: the engine abstraction (P4-S1)
 * Master Plan §17 ("a dedicated search engine may be introduced when scale
 * requires it — the domain model must NOT depend on a specific search
 * vendor") and §29 (initial approach: "Application search or managed search
 * abstraction"; the key is "abstraction and boundaries, not premature
 * infrastructure").
 *
 * This file is the ONLY place that knows which physical engine serves search.
 * The default adapter is PostgreSQL full-text search living inside the primary
 * database (§29 "application search"):
 *
 *  - Index-time tokenisation (§17 language-aware): the upsert computes
 *    `to_tsvector(<language config>, bodyText)` — 'english' for en, the
 *    verified-live 'hindi' Snowball config for hi, 'simple' otherwise — plus a
 *    language-neutral `to_tsvector('simple', neutralText)`.
 *  - Typo tolerance (§17): pg_trgm similarity / word_similarity scoring.
 *  - Exact/prefix/alias tiers (§17): ILIKE + the aliases JSON array, scored by
 *    the query service (see query-service.ts — tiering is portable, so a
 *    future managed engine only re-implements candidate retrieval).
 *
 * Everything above the port (document builders, ranking, §16 path building,
 * §17 explanations) is vendor-neutral and lives in indexing/query services.
 *
 * Dev-environment note: `prisma db push` may drop the GIN indexes below (they
 * are not expressible in the Prisma schema), so readiness is idempotent and
 * cached per process — the engine self-heals.
 */
import { Prisma } from '@prisma/client'

import { db } from '@/lib/db'

import type { SearchObjectTypePublic } from './types'

// ---------- Engine identity (§29 — surfaced in every response) ----------

export const SEARCH_ENGINE_ID = 'postgres-fts-v1'

/** Candidate ceiling per query — protects the app-side scoring pass. */
const CANDIDATE_LIMIT = 500

// ---------- The port (§17/§29 vendor-neutral contract) ----------

/** What the indexing pipeline produces: one object × one language variant. */
export interface IndexableDocument {
  objectType: SearchObjectTypePublic
  ref: string
  languageCode: string
  countryIso: string | null
  title: string
  canonicalName: string
  summary: string | null
  bodyText: string
  neutralText: string
  aliases: string[] | null
  topicSlug: string | null
  topicLabel: string | null
  unitType: string | null
  difficulty: string | null
  examRefs: string[] | null
  freshnessAt: Date
}

/** A candidate row + the engine-computed match signals the scorer consumes. */
export interface SearchCandidate extends Omit<IndexableDocument, 'bodyText' | 'neutralText'> {
  /** Full-text match on the language-localised text (reader-language docs). */
  langFts: boolean
  /** Full-text match on the language-neutral canonical/alias text. */
  neutralFts: boolean
  /** ts_rank of the language-config match (0 when langFts is false). */
  langRank: number
  /** ts_rank of the neutral match (0 when neutralFts is false). */
  neutralRank: number
  /** pg_trgm similarity(title, q) — typo tolerance on the display title. */
  titleSim: number
  /** pg_trgm word_similarity(q, bodyText) — typo tolerance inside the text. */
  bodyWsim: number
  /** pg_trgm similarity(neutralText, q) — canonical-fallback fuzzy tier. */
  neutralSim: number
}

export interface EngineCandidateQuery {
  q: string
  /** Reader's resolved country ISO (§14 — GLOBAL docs + this market only). */
  countryIso: string
  /** Reader's resolved language code (§35). */
  languageCode: string
  /** §17 object-type filter; empty = all types. */
  objectTypes: SearchObjectTypePublic[]
  /** §8 exam filter: keep only documents whose examRefs contain this slug. */
  examRef?: string
}

// ---------- FTS config resolution (§17 language-aware tokenisation) ----------

/**
 * Preferred Postgres text-search config per language code. The Supabase
 * PostgreSQL build ships the Snowball 'hindi' config (verified live:
 * to_tsvector('hindi', 'चंद्रयान …') stems correctly). Availability is checked
 * once per process; anything missing (or any unlisted language) falls back to
 * 'simple', which still tokenises Devanagari and Latin scripts correctly —
 * only stemming is lost.
 */
const PREFERRED_FTS_CONFIGS: Record<string, string> = {
  en: 'english',
  hi: 'hindi',
}

const configCache = new Map<string, string>()

export async function ftsConfigFor(languageCode: string): Promise<string> {
  const cached = configCache.get(languageCode)
  if (cached) return cached

  const preferred = PREFERRED_FTS_CONFIGS[languageCode] ?? 'simple'
  let resolved = 'simple'
  if (preferred !== 'simple') {
    const available = await db.$queryRawUnsafe(
      `SELECT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = $1) AS present`,
      preferred
    )
    if (Array.isArray(available) && (available[0] as { present: boolean } | undefined)?.present) {
      resolved = preferred
    }
  }
  configCache.set(languageCode, resolved)
  return resolved
}

/** Live config map for the admin stats surface. */
export async function ftsConfigMap(): Promise<Array<{ languageCode: string; config: string }>> {
  const languages = await db.language.findMany({
    where: { status: 'ACTIVE' },
    select: { code: true },
    orderBy: { code: 'asc' },
  })
  return Promise.all(
    languages.map(async (language) => ({
      languageCode: language.code,
      config: await ftsConfigFor(language.code),
    }))
  )
}

// ---------- Readiness (idempotent, cached, self-healing) ----------

let readyPromise: Promise<void> | null = null

export function ensureSearchEngineReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = (async () => {
      await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS pg_trgm`)
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "SearchDocument_tsvLang_gin" ON "SearchDocument" USING GIN ("tsvLang")`
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "SearchDocument_tsvNeutral_gin" ON "SearchDocument" USING GIN ("tsvNeutral")`
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "SearchDocument_title_trgm" ON "SearchDocument" USING GIN (title gin_trgm_ops)`
      )
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "SearchDocument_neutral_trgm" ON "SearchDocument" USING GIN ("neutralText" gin_trgm_ops)`
      )
    })().catch((error) => {
      // Reset so the next call retries (e.g. transient pooler hiccup).
      readyPromise = null
      throw error
    })
  }
  return readyPromise
}

// ---------- Write path: index-time tokenisation ----------

/** cuid-shaped id (the raw upsert bypasses Prisma's @default(cuid())). */
function newDocumentId(): string {
  let body = ''
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 24; i += 1) {
    body += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return `c${body}`
}

/**
 * Upserts one document (§17 indexing pipeline write): the (objectType, ref,
 * languageCode) triple is the identity — re-indexing replaces the previous
 * projection of the same public surface, including its index-time tsvector.
 */
export async function upsertSearchDocument(doc: IndexableDocument): Promise<void> {
  await db.$executeRaw`
    INSERT INTO "SearchDocument" (
      "id", "objectType", "ref", "languageCode", "countryIso",
      "title", "canonicalName", "summary", "bodyText", "neutralText",
      "aliases", "topicSlug", "topicLabel", "unitType", "difficulty",
      "examRefs", "freshnessAt", "indexedAt", "updatedAt", "tsvLang", "tsvNeutral"
    ) VALUES (
      ${newDocumentId()},
      ${doc.objectType}::"SearchObjectType",
      ${doc.ref},
      ${doc.languageCode},
      ${doc.countryIso},
      ${doc.title},
      ${doc.canonicalName},
      ${doc.summary},
      ${doc.bodyText},
      ${doc.neutralText},
      ${doc.aliases ? JSON.stringify(doc.aliases) : null}::jsonb,
      ${doc.topicSlug},
      ${doc.topicLabel},
      ${doc.unitType},
      ${doc.difficulty},
      ${doc.examRefs ? JSON.stringify(doc.examRefs) : null}::jsonb,
      ${doc.freshnessAt},
      now(), now(),
      to_tsvector(${await ftsConfigFor(doc.languageCode)}::regconfig, ${doc.bodyText}),
      to_tsvector('simple'::regconfig, ${doc.neutralText})
    )
    ON CONFLICT ("objectType", "ref", "languageCode") DO UPDATE SET
      "countryIso" = EXCLUDED."countryIso",
      "title" = EXCLUDED."title",
      "canonicalName" = EXCLUDED."canonicalName",
      "summary" = EXCLUDED."summary",
      "bodyText" = EXCLUDED."bodyText",
      "neutralText" = EXCLUDED."neutralText",
      "aliases" = EXCLUDED."aliases",
      "topicSlug" = EXCLUDED."topicSlug",
      "topicLabel" = EXCLUDED."topicLabel",
      "unitType" = EXCLUDED."unitType",
      "difficulty" = EXCLUDED."difficulty",
      "examRefs" = EXCLUDED."examRefs",
      "freshnessAt" = EXCLUDED."freshnessAt",
      "indexedAt" = now(),
      "updatedAt" = now(),
      "tsvLang" = EXCLUDED."tsvLang",
      "tsvNeutral" = EXCLUDED."tsvNeutral"
  `
}

/** Removes every language variant of one object (§36 lifecycle: withdrawn
 * surfaces leave the index — a stale doc is a broken search result). */
export async function removeSearchDocuments(
  objectType: SearchObjectTypePublic,
  ref: string
): Promise<number> {
  const result = await db.searchDocument.deleteMany({
    where: { objectType, ref },
  })
  return result.count
}

// ---------- Read path: candidate retrieval ----------

/** jsonb columns may arrive pre-parsed or as raw strings depending on driver. */
function asStringArray(value: unknown): string[] | null {
  if (value == null) return null
  const list = typeof value === 'string' ? JSON.parse(value) : value
  return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === 'string') : null
}

/** Strips LIKE wildcards from user input (matching, not injection, concern). */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, ' ')}%`
}

/**
 * Fetches the candidate set for a query (§17 retrieval): reader-country scope
 * (§14/§15), optional type and §8 exam filters, and the two match lanes —
 * reader-language documents match on their localised text OR neutral text;
 * other-language documents (canonical fallback, §35) match on neutral text
 * ONLY, so a search never surfaces a translation that does not exist.
 * Fine-grained tiering/boosting happens in the query service (portable).
 */
export async function querySearchCandidates(
  query: EngineCandidateQuery
): Promise<SearchCandidate[]> {
  await ensureSearchEngineReady()

  const config = await ftsConfigFor(query.languageCode)
  const like = likePattern(query.q)
  const prefix = `${query.q.replace(/[\\%_]/g, ' ')}%`
  const examJson = query.examRef ? JSON.stringify([query.examRef]) : null

  const typeClause =
    query.objectTypes.length > 0
      ? Prisma.sql`AND "objectType"::text IN (${Prisma.join(query.objectTypes)})`
      : Prisma.empty

  const examClause = examJson
    ? Prisma.sql`AND "examRefs" @> ${examJson}::jsonb`
    : Prisma.empty

  const rows = await db.$queryRaw<
    Array<{
      objectType: string
      ref: string
      languageCode: string
      countryIso: string | null
      title: string
      canonicalName: string
      summary: string | null
      aliases: unknown
      topicSlug: string | null
      topicLabel: string | null
      unitType: string | null
      difficulty: string | null
      examRefs: unknown
      freshnessAt: Date
      langFts: boolean
      neutralFts: boolean
      langRank: number
      neutralRank: number
      titleSim: number
      bodyWsim: number
      neutralSim: number
    }>
  >`
    SELECT
      "objectType"::text AS "objectType",
      ref, "languageCode", "countryIso", title, "canonicalName", summary,
      aliases, "topicSlug", "topicLabel", "unitType", difficulty, "examRefs", "freshnessAt",
      ("tsvLang" @@ websearch_to_tsquery(${config}::regconfig, ${query.q})) AS "langFts",
      ("tsvNeutral" @@ websearch_to_tsquery('simple'::regconfig, ${query.q})) AS "neutralFts",
      COALESCE(ts_rank("tsvLang", websearch_to_tsquery(${config}::regconfig, ${query.q})), 0) AS "langRank",
      COALESCE(ts_rank("tsvNeutral", websearch_to_tsquery('simple'::regconfig, ${query.q})), 0) AS "neutralRank",
      COALESCE(similarity(title, ${query.q}), 0) AS "titleSim",
      COALESCE(word_similarity(${query.q}, "bodyText"), 0) AS "bodyWsim",
      COALESCE(similarity("neutralText", ${query.q}), 0) AS "neutralSim"
    FROM "SearchDocument"
    WHERE ("countryIso" IS NULL OR "countryIso" = ${query.countryIso})
      ${typeClause}
      ${examClause}
      AND (
        ("languageCode" = ${query.languageCode} AND (
          "tsvLang" @@ websearch_to_tsquery(${config}::regconfig, ${query.q})
          OR "tsvNeutral" @@ websearch_to_tsquery('simple'::regconfig, ${query.q})
          OR title ILIKE ${like}
          OR title ILIKE ${prefix}
          OR "neutralText" ILIKE ${like}
          OR (char_length(${query.q}) >= 4 AND similarity(title, ${query.q}) >= 0.3)
          OR (char_length(${query.q}) >= 4 AND word_similarity(${query.q}, "bodyText") >= 0.5)
        ))
        OR ("languageCode" <> ${query.languageCode} AND (
          "tsvNeutral" @@ websearch_to_tsquery('simple'::regconfig, ${query.q})
          OR "neutralText" ILIKE ${like}
          OR "canonicalName" ILIKE ${like}
          OR (char_length(${query.q}) >= 4 AND similarity("neutralText", ${query.q}) >= 0.3)
        ))
      )
    LIMIT ${CANDIDATE_LIMIT}
  `

  return rows.map((row) => ({
    objectType: row.objectType as SearchObjectTypePublic,
    ref: row.ref,
    languageCode: row.languageCode,
    countryIso: row.countryIso,
    title: row.title,
    canonicalName: row.canonicalName,
    summary: row.summary,
    aliases: asStringArray(row.aliases),
    topicSlug: row.topicSlug,
    topicLabel: row.topicLabel,
    unitType: row.unitType,
    difficulty: row.difficulty,
    examRefs: asStringArray(row.examRefs),
    freshnessAt: row.freshnessAt,
    langFts: row.langFts,
    neutralFts: row.neutralFts,
    langRank: row.langRank,
    neutralRank: row.neutralRank,
    titleSim: row.titleSim,
    bodyWsim: row.bodyWsim,
    neutralSim: row.neutralSim,
  }))
}

// ---------- Index statistics ----------

export async function countSearchDocuments(): Promise<number> {
  return db.searchDocument.count()
}

export async function lastIndexedAt(): Promise<Date | null> {
  const aggregate = await db.searchDocument.aggregate({
    _max: { indexedAt: true },
  })
  return aggregate._max.indexedAt
}
