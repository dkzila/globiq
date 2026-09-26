/**
 * GlobIQ — Search module: the indexing pipeline (P4-S1)
 * Master Plan §17 (search strategy — the pipeline's job is to project public
 * canonical objects into the vendor-neutral index format), §7 (the index
 * holds REPRESENTATIONS of canonical records — unit documents are keyed by
 * the canonical slug and never by representation identity), §14/§15 (country
 * scope denormalised onto every document; COMING_SOON markets and non-public
 * objects leave the index entirely), §19 (only PUBLISHED surfaces are
 * indexed — scheduled items join the index the moment they materialize, via
 * the content-service hook), §22 (the three public page surfaces that exist
 * today: knowledge pages, exam pages, /gk/{topic}/ hubs), §35 (one document
 * per language that ACTUALLY carries a published surface — never planned
 * languages), §36 (current-version-only exam projection; withdrawn objects
 * are removed, never left stale).
 *
 * The pipeline never imports other feature modules (they import IT for the
 * hooks below — one-way dependency, §28 boundaries), so it reads canonical
 * data through Prisma directly and mirrors the §36 window semantics locally
 * (see `versionIsCurrent` / `mappingIsInEffect`).
 */
import { db } from '@/lib/db'

import {
  SEARCH_ENGINE_ID,
  type IndexableDocument,
  countSearchDocuments,
  ensureSearchEngineReady,
  ftsConfigMap,
  lastIndexedAt,
  removeSearchDocuments,
  upsertSearchDocument,
} from './engine'
import type {
  SearchAdminStats,
  SearchObjectTypePublic,
  SearchReindexResult,
} from './types'

// ---------- Shared helpers ----------

const DAY_MS = 24 * 60 * 60 * 1000
const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** §36 day-granular inclusive window (mirrors windowContains — the pipeline
 * cannot import exams-syllabus because that module imports this one). */
function versionIsCurrent(
  version: { effectiveFrom: Date; effectiveTo: Date | null },
  now = Date.now()
): boolean {
  if (version.effectiveFrom.getTime() > now) return false
  return version.effectiveTo == null || now < version.effectiveTo.getTime() + DAY_MS
}

/** §8 effective period (mirrors mappingInEffect for current versions). */
function mappingIsInEffect(
  mapping: { effectiveFrom: Date | null; effectiveTo: Date | null },
  now = Date.now()
): boolean {
  if (mapping.effectiveFrom && mapping.effectiveFrom.getTime() > now) return false
  if (mapping.effectiveTo == null) return true
  return now < mapping.effectiveTo.getTime() + DAY_MS
}

/** Slug → spaced tokens ("chandrayaan-3-landing" → "chandrayaan 3 landing")
 * so §16-style slugs stay searchable as natural phrases. */
function slugTokens(slug: string): string {
  return slug.replace(/-/g, ' ')
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

/** Caps one representation body's contribution to the index text. */
const BODY_EXCERPT = 2500

// ---------- Unit documents (§7/§22 knowledge pages) ----------

/**
 * Projects one canonical unit into the index: one document per language that
 * carries at least one PUBLISHED representation (§35). Non-VERIFIED units,
 * inactive topics, and not-yet-launched markets produce no documents (the
 * caller removes any stale ones — §36 nothing stale survives).
 */
export async function buildUnitDocuments(
  unitRef: string
): Promise<{ documents: IndexableDocument[]; indexable: boolean }> {
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(unitRef) ? { id: unitRef } : { slug: unitRef.toLowerCase() },
    include: {
      topic: {
        include: {
          labels: { include: { language: true } },
          aliases: { include: { language: true } },
          country: true,
        },
      },
      country: true,
    },
  })
  if (!unit) return { documents: [], indexable: false }

  // Public visibility mirrors the P2-S1/P2-S5 read chain: VERIFIED unit under
  // an ACTIVE topic, in a market that has launched (§14/§15).
  const topic = unit.topic
  if (unit.status !== 'VERIFIED' || topic.status !== 'ACTIVE') {
    return { documents: [], indexable: false }
  }

  // §14 effective scope: GLOBAL unit under GLOBAL topic → visible everywhere;
  // anything else is scoped to its (unit's or topic's) country — and that
  // country must be ACTIVE to be findable at all.
  const scopeCountry = unit.scope === 'COUNTRY' ? unit.country : topic.scope === 'COUNTRY' ? topic.country : null
  if (scopeCountry && scopeCountry.status !== 'ACTIVE') {
    return { documents: [], indexable: false }
  }
  const countryIso = scopeCountry?.isoCode ?? null

  // §35: only languages with an actually-published representation.
  const items = await db.contentItem.findMany({
    where: {
      knowledgeUnitId: unit.id,
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
    },
    include: { language: true, publishedRevision: true },
  })
  const byLanguage = new Map<
    string,
    Array<{ format: string; title: string; body: string; publishedAt: Date }>
  >()
  for (const item of items) {
    if (item.language.status !== 'ACTIVE' || !item.publishedRevision) continue
    const list = byLanguage.get(item.language.code) ?? []
    list.push({
      format: item.format,
      title: item.publishedRevision.title,
      body: item.publishedRevision.body.slice(0, BODY_EXCERPT),
      publishedAt: item.publishedRevision.publishedAt,
    })
    byLanguage.set(item.language.code, list)
  }
  // §8 exam projection: exams whose CURRENT §36 version carries an in-effect
  // mapping to this unit (any country — reader-country scoping happens at
  // query time, §14).
  const mappings = await db.examMapping.findMany({
    where: { knowledgeUnitId: unit.id },
    include: { examVersion: { include: { exam: { include: { country: true } } } } },
  })
  const now = Date.now()
  const examRefs = dedupe(
    mappings
      .filter(
        (mapping) =>
          mappingIsInEffect(mapping, now) &&
          mapping.examVersion.exam.status === 'ACTIVE' &&
          versionIsCurrent(mapping.examVersion, now)
      )
      .map((mapping) => mapping.examVersion.exam.slug)
  )

  const topicAliases = topic.aliases.map((alias) => alias.value)

  if (byLanguage.size === 0) {
    // §6: the KnowledgeUnit is itself a searchable semantic object — a
    // VERIFIED unit without published representations still gets ONE
    // canonical-reference document (English-reference fields, §7). It is
    // presented to readers as the canonical record — exactly the §22 page's
    // canonical-summary behaviour — never as a translation that doesn't exist.
    const englishLabel = topic.labels.find((entry) => entry.language.code === 'en')
    return {
      documents: [
        {
          objectType: 'KNOWLEDGE_UNIT',
          ref: unit.slug,
          languageCode: 'en',
          countryIso,
          title: unit.canonicalName,
          canonicalName: unit.canonicalName,
          summary: unit.canonicalSummary,
          bodyText: dedupe([unit.canonicalName, unit.canonicalSummary ?? '', unit.canonicalBody]).join(' '),
          neutralText: dedupe([
            unit.canonicalName,
            topic.canonicalName,
            ...topicAliases,
            slugTokens(unit.slug),
          ]).join(' '),
          aliases: dedupe([unit.canonicalName, ...topicAliases]),
          topicSlug: topic.slug,
          topicLabel: englishLabel?.name ?? null,
          unitType: unit.type,
          difficulty: unit.difficulty,
          examRefs: examRefs.length > 0 ? examRefs : null,
          freshnessAt: unit.updatedAt,
        },
      ],
      indexable: true,
    }
  }

  const documents: IndexableDocument[] = []
  for (const [languageCode, representations] of byLanguage) {
    const label = topic.labels.find((entry) => entry.language.code === languageCode)
    const factCard = representations.find((item) => item.format === 'FACT_CARD')
    documents.push({
      objectType: 'KNOWLEDGE_UNIT',
      ref: unit.slug,
      languageCode,
      countryIso,
      title: unit.canonicalName, // §7 canonical identity — representations live in bodyText
      canonicalName: unit.canonicalName,
      summary: factCard?.body ?? unit.canonicalSummary,
      bodyText: dedupe([
        unit.canonicalName,
        unit.canonicalSummary ?? '',
        unit.canonicalBody,
        label?.name ?? '',
        ...representations.map((item) => `${item.title} ${item.body}`),
      ]).join(' '),
      neutralText: dedupe([
        unit.canonicalName,
        topic.canonicalName,
        ...topicAliases,
        slugTokens(unit.slug),
      ]).join(' '),
      aliases: dedupe([unit.canonicalName, ...topicAliases]),
      topicSlug: topic.slug,
      topicLabel: label?.name ?? null,
      unitType: unit.type,
      difficulty: unit.difficulty,
      examRefs: examRefs.length > 0 ? examRefs : null,
      // §17.7 freshness = the latest PUBLICATION in this language (not the
      // unit row's updatedAt, which administrative touches also bump).
      freshnessAt: representations.reduce(
        (latest, item) => (item.publishedAt.getTime() > latest.getTime() ? item.publishedAt : latest),
        representations[0]!.publishedAt
      ),
    })
  }
  return { documents, indexable: true }
}

// ---------- Topic documents (§13/§16 /gk/{topic}/ hubs) ----------

export async function buildTopicDocuments(
  topicRef: string
): Promise<{ documents: IndexableDocument[]; indexable: boolean }> {
  const topic = await db.topic.findFirst({
    where: CUID_PATTERN.test(topicRef) ? { id: topicRef } : { slug: topicRef.toLowerCase() },
    include: {
      labels: { include: { language: true } },
      aliases: { include: { language: true } },
      country: true,
    },
  })
  if (!topic) return { documents: [], indexable: false }

  if (topic.status !== 'ACTIVE') return { documents: [], indexable: false }
  if (topic.scope === 'COUNTRY' && topic.country?.status !== 'ACTIVE') {
    return { documents: [], indexable: false }
  }

  const topicAliases = topic.aliases.map((alias) => alias.value)
  const activeLabels = topic.labels.filter((label) => label.language.status === 'ACTIVE')

  // §35 per-language labels; a topic with no label at all is still findable
  // through its canonical (English-reference) name — indexed as an 'en'
  // reference document, presented to other readers as canonical fallback.
  const variants: Array<{ languageCode: string; name: string; description: string | null }> =
    activeLabels.length > 0
      ? activeLabels.map((label) => ({
          languageCode: label.language.code,
          name: label.name,
          description: label.description ?? topic.description,
        }))
      : [{ languageCode: 'en', name: topic.canonicalName, description: topic.description }]

  const documents: IndexableDocument[] = variants.map((variant) => ({
    objectType: 'TOPIC',
    ref: topic.slug,
    languageCode: variant.languageCode,
    countryIso: topic.scope === 'COUNTRY' ? topic.country?.isoCode ?? null : null,
    title: variant.name,
    canonicalName: topic.canonicalName,
    summary: variant.description,
    bodyText: dedupe([variant.name, variant.description ?? '', topic.description ?? '']).join(' '),
    neutralText: dedupe([
      topic.canonicalName,
      ...topicAliases,
      slugTokens(topic.slug),
    ]).join(' '),
    aliases: dedupe([topic.canonicalName, ...topicAliases]),
    topicSlug: topic.slug,
    topicLabel: variant.name,
    unitType: null,
    difficulty: null,
    examRefs: null,
    freshnessAt: topic.updatedAt,
  }))
  return { documents, indexable: true }
}

// ---------- Exam documents (§6/§22 exam overview pages) ----------

export async function buildExamDocuments(
  examRef: string
): Promise<{ documents: IndexableDocument[]; indexable: boolean }> {
  const exam = await db.exam.findFirst({
    where: CUID_PATTERN.test(examRef) ? { id: examRef } : { slug: examRef.toLowerCase() },
    include: { country: { include: { defaultLanguage: true } } },
  })
  if (!exam) return { documents: [], indexable: false }

  // Public surface rules mirror the P3-S1 read: ACTIVE exam in an ACTIVE
  // country (DRAFT exams and unlaunched markets are never searchable).
  if (exam.status !== 'ACTIVE' || exam.country.status !== 'ACTIVE') {
    return { documents: [], indexable: false }
  }

  // Exam names are canonical (§14 country-owned metadata); the document is
  // indexed once in the owning market's default language. Other-language
  // readers still find it through neutralText (name + code + organiser).
  const languageCode = exam.country.defaultLanguage?.code ?? 'en'

  const text = dedupe([
    exam.name,
    exam.code,
    exam.organiser,
    exam.description ?? '',
    slugTokens(exam.slug),
  ]).join(' ')

  const document: IndexableDocument = {
    objectType: 'EXAM',
    ref: exam.slug,
    languageCode,
    countryIso: exam.country.isoCode,
    title: exam.name,
    canonicalName: exam.name,
    summary: exam.description,
    bodyText: text,
    neutralText: text,
    aliases: dedupe([exam.code]),
    topicSlug: null,
    topicLabel: null,
    unitType: null,
    difficulty: null,
    examRefs: null,
    freshnessAt: exam.updatedAt,
  }
  return { documents: [document], indexable: true }
}

// ---------- Targeted (re)index operations ----------

/** Reindexes one object by public ref — builds when public, removes when not. */
export async function reindexObject(
  objectType: SearchObjectTypePublic,
  ref: string
): Promise<number> {
  const built =
    objectType === 'KNOWLEDGE_UNIT'
      ? await buildUnitDocuments(ref)
      : objectType === 'TOPIC'
        ? await buildTopicDocuments(ref)
        : await buildExamDocuments(ref)

  if (!built.indexable) {
    return removeSearchDocuments(objectType, ref)
  }
  for (const document of built.documents) {
    await upsertSearchDocument(document)
  }
  // Drop language variants that no longer carry a published surface (§35).
  const keepLanguages = new Set(built.documents.map((document) => document.languageCode))
  const stale = await db.searchDocument.findMany({
    where: { objectType, ref, languageCode: { notIn: [...keepLanguages] } },
    select: { languageCode: true },
  })
  if (stale.length > 0) {
    await db.searchDocument.deleteMany({
      where: { objectType, ref, languageCode: { notIn: [...keepLanguages] } },
    })
  }
  return built.documents.length
}

// ---------- Mutation hooks (§17 freshness by construction) ----------
//
// Other modules call these after visibility-affecting mutations. A hook must
// NEVER break the parent mutation: failures are logged and surfaced only in
// the admin reindex stats — the next full reindex heals any gap (§36).

export async function onUnitChanged(unitRef: string): Promise<void> {
  try {
    await reindexObject('KNOWLEDGE_UNIT', unitRef)
  } catch (error) {
    console.error('[search] unit reindex failed:', unitRef, error)
  }
}

/** Topic changes ripple: labels/aliases/status affect the topic's own
 * documents AND every unit under it (topic label chips, aliases, §14 scope). */
export async function onTopicChanged(topicRef: string): Promise<void> {
  try {
    await reindexObject('TOPIC', topicRef)
    const topic = await db.topic.findFirst({
      where: CUID_PATTERN.test(topicRef) ? { id: topicRef } : { slug: topicRef.toLowerCase() },
      select: { id: true },
    })
    if (topic) {
      const units = await db.knowledgeUnit.findMany({
        where: { topicId: topic.id },
        select: { slug: true },
      })
      for (const unit of units) {
        await reindexObject('KNOWLEDGE_UNIT', unit.slug)
      }
    }
  } catch (error) {
    console.error('[search] topic reindex failed:', topicRef, error)
  }
}

/** Exam changes ripple: the exam's own document plus every unit mapped to
 * any of its versions (§8/§36 — a new current version redefines examRefs). */
export async function onExamChanged(examRef: string): Promise<void> {
  try {
    await reindexObject('EXAM', examRef)
    const exam = await db.exam.findFirst({
      where: CUID_PATTERN.test(examRef) ? { id: examRef } : { slug: examRef.toLowerCase() },
      select: { id: true },
    })
    if (exam) {
      const mappings = await db.examMapping.findMany({
        where: { examVersion: { examId: exam.id } },
        select: { knowledgeUnit: { select: { slug: true } } },
        distinct: ['knowledgeUnitId'],
      })
      for (const mapping of mappings) {
        await reindexObject('KNOWLEDGE_UNIT', mapping.knowledgeUnit.slug)
      }
    }
  } catch (error) {
    console.error('[search] exam reindex failed:', examRef, error)
  }
}

/** §8 mapping mutations re-project the affected units' examRefs. */
export async function onMappingsChanged(unitRefs: string[]): Promise<void> {
  for (const unitRef of unitRefs) {
    try {
      await reindexObject('KNOWLEDGE_UNIT', unitRef)
    } catch (error) {
      console.error('[search] mapping reindex failed:', unitRef, error)
    }
  }
}

// ---------- Full rebuild + statistics (§38 admin console) ----------

/**
 * Rebuilds the whole index from canonical data (idempotent): projects every
 * public object, then removes documents whose object is no longer indexable
 * (lifecycle transitions, §36) — a full reindex leaves no stale rows.
 */
export async function reindexAll(): Promise<SearchReindexResult> {
  const startedAt = Date.now()
  await ensureSearchEngineReady()

  const units = await db.knowledgeUnit.findMany({ select: { slug: true } })
  const topics = await db.topic.findMany({ select: { slug: true } })
  const exams = await db.exam.findMany({ select: { slug: true } })

  let unitsIndexed = 0
  let topicsIndexed = 0
  let examsIndexed = 0
  let documentsWritten = 0
  const liveRefs: Record<SearchObjectTypePublic, string[]> = {
    KNOWLEDGE_UNIT: [],
    EXAM: [],
    TOPIC: [],
  }
  /** Live language variants per object — stale variants are removed (§35). */
  const liveLanguages = new Map<string, Set<string>>()

  const project = async (
    objectType: SearchObjectTypePublic,
    ref: string,
    build: () => Promise<{ documents: IndexableDocument[]; indexable: boolean }>
  ): Promise<boolean> => {
    const built = await build()
    if (!built.indexable) return false
    liveRefs[objectType].push(ref)
    liveLanguages.set(`${objectType}:${ref}`, new Set(built.documents.map((doc) => doc.languageCode)))
    for (const document of built.documents) {
      await upsertSearchDocument(document)
      documentsWritten += 1
    }
    return true
  }

  for (const unit of units) {
    if (await project('KNOWLEDGE_UNIT', unit.slug, () => buildUnitDocuments(unit.slug))) {
      unitsIndexed += 1
    }
  }
  for (const topic of topics) {
    if (await project('TOPIC', topic.slug, () => buildTopicDocuments(topic.slug))) {
      topicsIndexed += 1
    }
  }
  for (const exam of exams) {
    if (await project('EXAM', exam.slug, () => buildExamDocuments(exam.slug))) {
      examsIndexed += 1
    }
  }

  // §36: a full reindex leaves no stale rows — documents of objects that left
  // the public surface are removed, and so are language variants of live
  // objects that no longer carry a published surface (§35).
  let documentsRemoved = 0
  for (const objectType of Object.keys(liveRefs) as SearchObjectTypePublic[]) {
    const removed = await db.searchDocument.deleteMany({
      where: { objectType, ref: { notIn: liveRefs[objectType] } },
    })
    documentsRemoved += removed.count
  }
  for (const [key, languages] of liveLanguages) {
    const [objectType, ref] = key.split(':') as [SearchObjectTypePublic, string]
    const removed = await db.searchDocument.deleteMany({
      where: { objectType, ref, languageCode: { notIn: [...languages] } },
    })
    documentsRemoved += removed.count
  }

  return {
    unitsIndexed,
    topicsIndexed,
    examsIndexed,
    documentsWritten,
    documentsRemoved,
    tookMs: Date.now() - startedAt,
  }
}

/** Index statistics for the admin console (§38). */
export async function getIndexStats(): Promise<SearchAdminStats> {
  const [byTypeRows, byLanguageRows, documents, lastIndexed, ftsConfigs] = await Promise.all([
    db.searchDocument.groupBy({ by: ['objectType'], _count: { _all: true } }),
    db.searchDocument.groupBy({ by: ['languageCode'], _count: { _all: true } }),
    countSearchDocuments(),
    lastIndexedAt(),
    ftsConfigMap(),
  ])
  return {
    engine: SEARCH_ENGINE_ID,
    documents,
    byType: byTypeRows
      .map((row) => ({ objectType: row.objectType as SearchObjectTypePublic, count: row._count._all }))
      .sort((a, b) => a.objectType.localeCompare(b.objectType)),
    byLanguage: byLanguageRows
      .map((row) => ({ languageCode: row.languageCode, count: row._count._all }))
      .sort((a, b) => a.languageCode.localeCompare(b.languageCode)),
    lastIndexedAt: lastIndexed?.toISOString() ?? null,
    ftsConfigs,
  }
}
