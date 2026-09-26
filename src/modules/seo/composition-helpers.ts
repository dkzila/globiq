/**
 * GlobIQ — SEO module: shared composition helpers (P4-S2, internal)
 *
 * The primitives both discovery compositions (§34 homepage, §33 topic
 * landing) share: reader-context resolution (§14/§35), visible-tree
 * flattening with §16 path builders, VERIFIED unit-count rollups (§14 scope),
 * the §22 quick-fact card resolution (§35 honest fallback), §8 exam-count
 * aggregation (identical liveness to the requirement layer via
 * `mappingInEffect` + `windowContains`), and the COMING_SOON quiet rule
 * (§14/§38). Internal file — not part of the module's public interface (§28).
 */
import type { KnowledgeUnit } from '@prisma/client'

import { db } from '@/lib/db'
import {
  buildCanonicalUrl,
  getPublicCountry,
  LocaleError,
  resolveLocaleContext,
} from '@/modules/country-locale'
import type { LocaleResolution, PublicCountry } from '@/modules/country-locale'
import type { PublicTopicNode } from '@/modules/taxonomy'
import { windowContains } from '@/modules/exams-syllabus'
import { mappingInEffect } from '@/modules/exam-mapping'

import { SeoError } from './errors'
import type { HomepageUnitCard } from './types'

// ---------- Reader context ----------

export interface ReaderContext {
  resolution: LocaleResolution
  publicCountry: PublicCountry
  countryRow: { id: string; status: string }
  languageCode: string
  defaultLanguageCode: string
  countryActive: boolean
}

/**
 * Resolves the country/language context for a discovery surface (§14/§35).
 * Unknown/INACTIVE countries surface as the typed 404; COMING_SOON markets
 * resolve (§15 — routing signal, not a wall).
 */
export async function resolveReaderContext(input: {
  country?: string
  language?: string
}): Promise<ReaderContext> {
  let resolution
  try {
    resolution = await resolveLocaleContext(input)
  } catch (error) {
    if (error instanceof LocaleError) {
      throw new SeoError('COUNTRY_NOT_FOUND', error.message)
    }
    throw error
  }

  const [publicCountry, countryRow] = await Promise.all([
    getPublicCountry(resolution.country.isoCode),
    db.country.findUnique({
      where: { isoCode: resolution.country.isoCode },
      select: { id: true, status: true },
    }),
  ])
  if (!publicCountry || !countryRow) {
    throw new SeoError('COUNTRY_NOT_FOUND', 'Country not available')
  }

  return {
    resolution,
    publicCountry,
    countryRow,
    languageCode: resolution.language.code,
    defaultLanguageCode: publicCountry.defaultLanguage.code,
    countryActive: countryRow.status === 'ACTIVE',
  }
}

// ---------- Visible-tree primitives ----------

/** A flattened visible-tree node with its ancestor chain (§33 paths). */
export interface FlatNode {
  node: PublicTopicNode
  ancestors: PublicTopicNode[]
  parent: PublicTopicNode | null
  /** Position in the tree walk — deterministic §37 tiebreak. */
  walkIndex: number
}

export function flattenTree(roots: PublicTopicNode[]): FlatNode[] {
  const out: FlatNode[] = []
  let walkIndex = 0
  const walk = (nodes: PublicTopicNode[], ancestors: PublicTopicNode[], parent: PublicTopicNode | null) => {
    for (const node of nodes) {
      out.push({ node, ancestors, parent, walkIndex: walkIndex++ })
      walk(node.children, [...ancestors, node], node)
    }
  }
  walk(roots, [], null)
  return out
}

/** Subtree unit/topic counts rolled up from a per-topic unit-count map. */
export function subtreeCounts(
  node: PublicTopicNode,
  unitCountByTopic: Map<string, number>
): { unitCount: number; topicCount: number } {
  let unitCount = unitCountByTopic.get(node.id) ?? 0
  let topicCount = 0
  for (const child of node.children) {
    const childCounts = subtreeCounts(child, unitCountByTopic)
    unitCount += childCounts.unitCount
    topicCount += 1 + childCounts.topicCount
  }
  return { unitCount, topicCount }
}

/** §8/§36 liveness shared with the requirement layer: CURRENT version. */
export function isCurrentVersion(version: {
  effectiveFrom: Date
  effectiveTo: Date | null
}): boolean {
  return windowContains(version)
}

/**
 * VERIFIED unit counts per visible topic (§14 scope: GLOBAL units plus the
 * reader country's own COUNTRY-scoped units — never another market's).
 */
export async function loadUnitCountByTopic(
  topicIds: string[],
  countryId: string
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (topicIds.length === 0) return map
  const grouped = await db.knowledgeUnit.groupBy({
    by: ['topicId'],
    where: {
      topicId: { in: topicIds },
      status: 'VERIFIED',
      OR: [{ scope: 'GLOBAL' }, { countryId }],
    },
    _count: { _all: true },
  })
  for (const row of grouped) map.set(row.topicId, row._count._all)
  return map
}

// ---------- §16 path builders (single source of URL truth) ----------

export function topicHubPath(context: ReaderContext, topicSlug: string): string {
  return buildCanonicalUrl(
    { slug: context.publicCountry.slug, isDefault: context.publicCountry.isDefault },
    { code: context.languageCode },
    context.defaultLanguageCode,
    ['gk', topicSlug]
  )
}

export function knowledgePath(
  context: ReaderContext,
  topicSlug: string,
  unitSlug: string
): string {
  return buildCanonicalUrl(
    { slug: context.publicCountry.slug, isDefault: context.publicCountry.isDefault },
    { code: context.languageCode },
    context.defaultLanguageCode,
    ['gk', topicSlug, unitSlug]
  )
}

export function examPath(context: ReaderContext, examSlug: string): string {
  return buildCanonicalUrl(
    { slug: context.publicCountry.slug, isDefault: context.publicCountry.isDefault },
    { code: context.languageCode },
    context.defaultLanguageCode,
    ['exams', examSlug]
  )
}

// ---------- Unit cards (§34 popular knowledge / §33 landing units) ----------

/**
 * Builds §34/§33 unit teaser cards from already-loaded canonical rows: the
 * §22 quick-fact resolution (published FACT_CARD in the reader's language,
 * else the canonical summary with an honest §35 fallback marker), the topic
 * label from the visible tree, the §16 knowledge-page path, and the §8
 * in-effect exam count (distinct ACTIVE exams of the reader's country on
 * CURRENT versions — the same liveness as the P3-S5 coverage mirror).
 */
export async function composeUnitCards(params: {
  unitRows: KnowledgeUnit[]
  context: ReaderContext
  nodeById: Map<string, PublicTopicNode>
}): Promise<HomepageUnitCard[]> {
  const { unitRows, context, nodeById } = params
  if (unitRows.length === 0) return []

  const unitIds = unitRows.map((unit) => unit.id)

  // Published FACT_CARDs in the reader's language (the §22 quick fact).
  const factCards = await db.contentItem.findMany({
    where: {
      knowledgeUnitId: { in: unitIds },
      status: 'PUBLISHED',
      publishedRevisionId: { not: null },
      format: 'FACT_CARD',
      language: { code: context.languageCode },
    },
    select: {
      knowledgeUnitId: true,
      publishedRevision: { select: { body: true } },
    },
  })
  const factCardByUnit = new Map<string, string>()
  for (const card of factCards) {
    if (card.publishedRevision) {
      factCardByUnit.set(card.knowledgeUnitId, card.publishedRevision.body)
    }
  }

  // §8 exam counts per unit (batched, identical liveness to the mirror).
  const mappings = await db.examMapping.findMany({
    where: {
      knowledgeUnitId: { in: unitIds },
      syllabusNode: { examVersion: { exam: { status: 'ACTIVE', countryId: context.countryRow.id } } },
    },
    select: {
      knowledgeUnitId: true,
      effectiveFrom: true,
      effectiveTo: true,
      syllabusNode: {
        select: {
          examVersion: {
            select: { effectiveFrom: true, effectiveTo: true, exam: { select: { id: true } } },
          },
        },
      },
    },
  })
  const examsByUnit = new Map<string, Set<string>>()
  for (const mapping of mappings) {
    if (isCurrentVersion(mapping.syllabusNode.examVersion) && mappingInEffect(mapping, false)) {
      const set = examsByUnit.get(mapping.knowledgeUnitId) ?? new Set<string>()
      set.add(mapping.syllabusNode.examVersion.exam.id)
      examsByUnit.set(mapping.knowledgeUnitId, set)
    }
  }

  return unitRows.map<HomepageUnitCard>((unit) => {
    const topicNode = nodeById.get(unit.topicId)
    const factCard = factCardByUnit.get(unit.id) ?? null
    return {
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      type: unit.type,
      difficulty: unit.difficulty,
      summary: factCard
        ? { text: factCard, source: 'FACT_CARD', language: context.languageCode }
        : {
            // §35 canonical fallback — labelled honestly, never a fake translation.
            text: unit.canonicalSummary ?? unit.canonicalBody,
            source: 'CANONICAL_SUMMARY',
            language: 'en',
          },
      topic: { slug: topicNode?.slug ?? '', name: topicNode?.label ?? unit.canonicalName },
      canonicalPath: knowledgePath(
        context,
        topicNode?.slug ?? '',
        unit.slug
      ),
      examCount: examsByUnit.get(unit.id)?.size ?? 0,
    }
  })
}

/** The visible-unit where-clause shared by every discovery read (§14/§36). */
export function visibleUnitsWhere(topicIds: string[], countryId: string) {
  return {
    topicId: { in: topicIds },
    status: 'VERIFIED' as const,
    OR: [{ scope: 'GLOBAL' as const }, { countryId }],
  }
}
