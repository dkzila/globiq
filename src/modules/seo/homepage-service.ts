/**
 * GlobIQ — SEO module: country homepage composition (P4-S2)
 * Master Plan §34 (Homepage Strategy — the country's GK/current-affairs
 * index and discovery hub; India is the root default, other countries under
 * their §16 directory; anonymous-first, progressively personalised from P5),
 * §33 (country-specific GK hubs as indexable landing surfaces), §13/§14/§15
 * (one global taxonomy with country extensions; explicit country scope
 * enforced server-side on every query — never by hiding UI; COMING_SOON
 * markets are browsable, not blocked), §35 (only the country's configured
 * languages; honest canonical fallback), §36 (lifecycle-aware reads — VERIFIED
 * units only, ACTIVE exams, CURRENT versions, in-effect mappings), §16
 * (every path built via buildCanonicalUrl — never from user input), §37
 * (deterministic ordering, client-agnostic DTO), §38 (public app surface).
 *
 * Nothing here persists — the homepage is a computed view over the canonical
 * model (§7 store-once). Popular knowledge uses the editorial orderIndex
 * (deterministic §37) until product analytics (P8) can rank by real usage.
 */
import { db } from '@/lib/db'
import { getPublicTopic, getPublicTree, TaxonomyError } from '@/modules/taxonomy'
import { mappingInEffect } from '@/modules/exam-mapping'

import {
  composeUnitCards,
  examPath,
  flattenTree,
  isCurrentVersion,
  loadUnitCountByTopic,
  resolveReaderContext,
  subtreeCounts,
  topicHubPath,
  visibleUnitsWhere,
  type ReaderContext,
} from './composition-helpers'
import { SeoError } from './errors'
import type {
  CountryHomepage,
  DiscoveryLanguage,
  HomepageCategory,
  HomepageExamCard,
  HomepageTopicCard,
} from './types'

// ---------- Constants ----------

/** §34 "major topics" — how many cards the homepage surfaces. */
const MAJOR_TOPIC_LIMIT = 6
/** §34 "popular knowledge" — how many unit teasers the homepage surfaces. */
const POPULAR_UNIT_LIMIT = 6
/** §34 exam directory — homepage cap (the exam/syllabus SEO pages are P4-S3). */
const EXAM_LIMIT = 8

// ---------- Public read ----------

/**
 * The §34 country homepage composition for one country × language context.
 * Unknown/INACTIVE countries are a typed 404; COMING_SOON markets resolve —
 * their homepage renders the launch state plus whatever global content is
 * legitimately visible (§15 — data scoping, not network blocking).
 */
export async function getCountryHomepage(input: {
  country?: string
  language?: string
}): Promise<CountryHomepage> {
  // ---------- Reader context (§14/§35 — server-side resolution) ----------
  const context = await resolveReaderContext(input)

  // ---------- The visible taxonomy (§13/§14 — snapshot-cached) ----------
  const tree = await getPublicTree({ country: input.country, language: input.language })
  const flat = flattenTree(tree)
  const nodeById = new Map(flat.map((entry) => [entry.node.id, entry.node]))

  // ---------- VERIFIED unit counts per visible topic (§14 scope applied) ----------
  const unitCountByTopic = await loadUnitCountByTopic(
    flat.map((entry) => entry.node.id),
    context.countryRow.id
  )
  const totalVisibleUnits = [...unitCountByTopic.values()].reduce(
    (sum, count) => sum + count,
    0
  )

  // ---------- §34 GK categories — top-level domains with §33 cluster previews ----------
  const categoryDetails = await Promise.all(
    tree.map(async (root) => {
      try {
        return await getPublicTopic(root.slug, {
          country: input.country,
          language: input.language,
        })
      } catch (error) {
        if (error instanceof TaxonomyError) return null
        throw error
      }
    })
  )

  const categories: HomepageCategory[] = tree.map((root, index) => {
    const detail = categoryDetails[index]
    const counts = subtreeCounts(root, unitCountByTopic)
    return {
      slug: root.slug,
      name: root.label,
      labelLanguage: root.labelLanguage,
      description: detail?.node.description ?? null,
      canonicalPath: topicHubPath(context, root.slug),
      topicCount: counts.topicCount,
      unitCount: counts.unitCount,
      children: root.children.map((child) => {
        const childCounts = subtreeCounts(child, unitCountByTopic)
        return {
          slug: child.slug,
          name: child.label,
          canonicalPath: topicHubPath(context, child.slug),
          topicCount: childCounts.topicCount,
          unitCount: childCounts.unitCount,
        }
      }),
    }
  })

  // ---------- §34 major topics — most content-bearing non-domain nodes ----------
  const majorTopics: HomepageTopicCard[] = flat
    .filter((entry) => entry.node.type !== 'DOMAIN')
    .map((entry) => ({
      entry,
      unitCount: subtreeCounts(entry.node, unitCountByTopic).unitCount,
    }))
    .filter((candidate) => candidate.unitCount > 0)
    .sort(
      (a, b) =>
        b.unitCount - a.unitCount ||
        a.entry.walkIndex - b.entry.walkIndex ||
        a.entry.node.slug.localeCompare(b.entry.node.slug)
    )
    .slice(0, MAJOR_TOPIC_LIMIT)
    .map(({ entry, unitCount }) => ({
      slug: entry.node.slug,
      name: entry.node.label,
      labelLanguage: entry.node.labelLanguage,
      canonicalPath: topicHubPath(context, entry.node.slug),
      unitCount,
      scope: entry.node.scope,
      path: [...entry.ancestors, entry.node].map((node) => ({
        slug: node.slug,
        name: node.label,
      })),
    }))

  // ---------- §34 exams — the country's ACTIVE exams, CURRENT versions (§36) ----------
  const exams = await composeHomepageExams(context)

  // ---------- §34 popular knowledge — §22 quick-fact resolution per card ----------
  const visibleTopicIds = flat.map((entry) => entry.node.id)
  let popularUnits: CountryHomepage['popularUnits'] = []
  if (visibleTopicIds.length > 0) {
    const unitRows = await db.knowledgeUnit.findMany({
      where: visibleUnitsWhere(visibleTopicIds, context.countryRow.id),
      orderBy: [{ orderIndex: 'asc' }, { canonicalName: 'asc' }], // deterministic (§37)
      take: POPULAR_UNIT_LIMIT,
    })
    popularUnits = await composeUnitCards({ unitRows, context, nodeById })
  }

  // ---------- §35 language switcher — only the country's own languages ----------
  const languages: DiscoveryLanguage[] = context.publicCountry.languages.map((language) => ({
    code: language.code,
    name: language.name,
    nativeName: language.nativeName,
    direction: language.direction,
    url: language.url,
    isDefault: language.code === context.defaultLanguageCode,
  }))

  // ---------- Assembly (§34) ----------
  return {
    country: {
      isoCode: context.publicCountry.isoCode,
      slug: context.publicCountry.slug,
      name: context.publicCountry.name,
      timezone: context.publicCountry.timezone,
      status: context.countryActive ? 'ACTIVE' : 'COMING_SOON',
      isDefault: context.publicCountry.isDefault,
    },
    language: {
      code: context.resolution.language.code,
      name: context.resolution.language.name,
      nativeName: context.resolution.language.nativeName,
      direction: context.resolution.language.direction,
    },
    canonicalUrl: context.resolution.canonicalUrl,
    languages,
    categories,
    majorTopics,
    exams,
    popularUnits,
    currentAffairs: {
      available: false,
      note: 'The current-affairs event feed arrives with the Current Affairs system — until then, browse the Current Affairs category and its evergreen hubs.',
    },
    stats: {
      topics: flat.length,
      units: totalVisibleUnits,
      exams: exams.available ? exams.items.length : 0,
    },
  }
}

// ---------- §34 exam directory ----------

/**
 * The homepage exam directory: the country's ACTIVE exams with their CURRENT
 * §36 version and §8 in-effect mapping counts. COMING_SOON markets get the
 * quiet state (exam content launches with the market — §14/§38); an ACTIVE
 * country with no exams gets an honest empty list.
 */
async function composeHomepageExams(context: ReaderContext): Promise<CountryHomepage['exams']> {
  if (!context.countryActive) {
    return { available: false, reason: 'COUNTRY_COMING_SOON', items: [] }
  }

  const examRows = await db.exam.findMany({
    where: { countryId: context.countryRow.id, status: 'ACTIVE' },
    include: {
      versions: { select: { id: true, label: true, effectiveFrom: true, effectiveTo: true } },
    },
    orderBy: [{ name: 'asc' }, { slug: 'asc' }], // deterministic (§37)
    take: EXAM_LIMIT,
  })

  // CURRENT version per exam (§36 — the version effective today).
  const currentVersionByExam = new Map<
    string,
    { id: string; label: string; effectiveFrom: Date }
  >()
  for (const exam of examRows) {
    const current = exam.versions
      .filter(isCurrentVersion)
      .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0]
    if (current) {
      currentVersionByExam.set(exam.id, {
        id: current.id,
        label: current.label,
        effectiveFrom: current.effectiveFrom,
      })
    }
  }

  // §8 in-effect mapping counts on those CURRENT versions (batched).
  const currentVersionIds = [...currentVersionByExam.values()].map((version) => version.id)
  const mappingCounts = new Map<string, number>()
  if (currentVersionIds.length > 0) {
    const mappings = await db.examMapping.findMany({
      where: { syllabusNode: { examVersionId: { in: currentVersionIds } } },
      select: {
        effectiveFrom: true,
        effectiveTo: true,
        syllabusNode: { select: { examVersionId: true } },
      },
    })
    for (const mapping of mappings) {
      if (mappingInEffect(mapping, false)) {
        mappingCounts.set(
          mapping.syllabusNode.examVersionId,
          (mappingCounts.get(mapping.syllabusNode.examVersionId) ?? 0) + 1
        )
      }
    }
  }

  return {
    available: true,
    reason: null,
    items: examRows.map<HomepageExamCard>((exam) => {
      const current = currentVersionByExam.get(exam.id) ?? null
      return {
        slug: exam.slug,
        name: exam.name,
        code: exam.code,
        organiser: exam.organiser,
        level: exam.level,
        currentVersion: current
          ? { label: current.label, effectiveFrom: current.effectiveFrom.toISOString() }
          : null,
        mappingCount: current ? mappingCounts.get(current.id) ?? 0 : 0,
        canonicalPath: examPath(context, exam.slug),
      }
    }),
  }
}
