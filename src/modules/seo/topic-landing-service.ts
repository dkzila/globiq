/**
 * GlobIQ — SEO module: topic landing page composition (P4-S2)
 * Master Plan §16 (the stable canonical topic page …/gk/{topic-slug}/), §33
 * (evergreen GK topic pages as indexable landing surfaces — topic clusters,
 * internal links, units, exams), §13 (one global taxonomy; the landing is
 * country-aware — a topic hidden in the reader's country is a typed 404),
 * §14/§15 (server-side scope; COMING_SOON markets browse global content),
 * §8/§36 (exams aggregated from in-effect requirement rows on CURRENT
 * versions of the reader's country's ACTIVE exams — the same liveness as the
 * P3-S5 unit-coverage mirror), §35 (labels resolved requested → country
 * default → canonical; honest canonical fallback on unit summaries), §37
 * (deterministic ordering, paginated units, explicit errors).
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
} from './composition-helpers'
import { SeoError } from './errors'
import type { TopicLandingQuery } from './validation'
import type {
  LandingChildTopic,
  LandingExamCard,
  LandingRelatedTopic,
  TopicLanding,
} from './types'

/** §33 internal links — how many sibling topics the landing surfaces. */
const RELATED_TOPIC_LIMIT = 6

// ---------- Public read ----------

/**
 * The §16/§33 topic landing composition: breadcrumb, header, cluster
 * children, the topic's own units (paginated), the exams that need units
 * from this topic's subtree, and sibling internal links. Any topic type
 * (DOMAIN/BRANCH/TOPIC) has a landing — domains are the §34 GK category
 * hubs, leaves are the evergreen pages.
 */
export async function getTopicLanding(
  ref: string,
  query: TopicLandingQuery
): Promise<TopicLanding> {
  // ---------- Topic detail — visibility is the taxonomy's call (§13/§14) ----------
  let detail
  try {
    detail = await getPublicTopic(ref, {
      country: query.country,
      language: query.language,
    })
  } catch (error) {
    if (error instanceof TaxonomyError) {
      if (error.code === 'TOPIC_NOT_FOUND') {
        throw new SeoError('TOPIC_NOT_FOUND', 'Topic not found')
      }
      throw new SeoError(
        'TOPIC_NOT_VISIBLE',
        'This topic is not available in the selected country'
      )
    }
    throw error
  }

  // ---------- Reader context (§14/§35) ----------
  const context = await resolveReaderContext(query)

  // ---------- The visible tree — subtree structure + §35 labels ----------
  const tree = await getPublicTree({ country: query.country, language: query.language })
  const flat = flattenTree(tree)
  const nodeById = new Map(flat.map((entry) => [entry.node.id, entry.node]))

  // The landing node inside the visible tree (by slug or canonical id).
  const isCuid = /^c[a-z0-9]{20,}$/.test(ref)
  const landingEntry = flat.find((entry) =>
    isCuid ? entry.node.id === ref : entry.node.slug === detail.node.slug
  )
  const landingNode = landingEntry?.node ?? null

  // ---------- Unit counts per visible topic (§14 scope applied) ----------
  const unitCountByTopic = await loadUnitCountByTopic(
    flat.map((entry) => entry.node.id),
    context.countryRow.id
  )

  // ---------- Breadcrumb (Home → … → self, each with its §16 path) ----------
  const breadcrumb: TopicLanding['breadcrumb'] = [
    { slug: null, name: 'Home', path: context.resolution.canonicalUrl },
    ...(landingEntry
      ? [...landingEntry.ancestors, landingEntry.node].map((node) => ({
          slug: node.slug,
          name: node.label,
          path: topicHubPath(context, node.slug),
        }))
      : []),
  ]

  // ---------- §33 cluster children (stable tree order) ----------
  const children: LandingChildTopic[] = (landingNode?.children ?? []).map((child) => {
    const counts = subtreeCounts(child, unitCountByTopic)
    return {
      slug: child.slug,
      name: child.label,
      type: child.type,
      unitCount: counts.unitCount,
      topicCount: counts.topicCount,
      canonicalPath: topicHubPath(context, child.slug),
    }
  })

  // ---------- Subtree stats ----------
  const subtree = landingNode ? subtreeCounts(landingNode, unitCountByTopic) : { unitCount: 0, topicCount: 0 }
  const subtreeTopicIds = landingNode
    ? flattenTree([landingNode]).map((entry) => entry.node.id)
    : []

  // ---------- Units directly on this topic (paginated, §37) ----------
  const where = visibleUnitsWhere([detail.node.id], context.countryRow.id)
  const [unitRows, totalUnits] = await Promise.all([
    db.knowledgeUnit.findMany({
      where,
      orderBy: [{ orderIndex: 'asc' }, { canonicalName: 'asc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.knowledgeUnit.count({ where }),
  ])
  const units: TopicLanding['units'] = {
    items: await composeUnitCards({ unitRows, context, nodeById }),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total: totalUnits,
      totalPages: Math.max(1, Math.ceil(totalUnits / query.pageSize)),
    },
  }

  // ---------- Exams needing units from this subtree (§8/§36, unit-side) ----------
  const exams: TopicLanding['exams'] = await composeLandingExams({
    subtreeTopicIds,
    context,
  })

  // ---------- §33 internal links — sibling topics under the same parent ----------
  const siblings = landingEntry?.parent?.children ?? tree
  const relatedTopics: LandingRelatedTopic[] = siblings
    .filter((node) => node.slug !== detail.node.slug)
    .map((node) => ({
      node,
      unitCount: subtreeCounts(node, unitCountByTopic).unitCount,
    }))
    .sort(
      (a, b) =>
        b.unitCount - a.unitCount ||
        a.node.slug.localeCompare(b.node.slug) // deterministic (§37)
    )
    .slice(0, RELATED_TOPIC_LIMIT)
    .map(({ node, unitCount }) => ({
      slug: node.slug,
      name: node.label,
      type: node.type,
      unitCount,
      canonicalPath: topicHubPath(context, node.slug),
    }))

  // ---------- Assembly ----------
  return {
    topic: {
      slug: detail.node.slug,
      canonicalName: detail.node.canonicalName,
      label: detail.node.label,
      labelLanguage: detail.node.labelLanguage,
      description: detail.node.description,
      type: detail.node.type,
      scope: detail.node.scope,
      countryIso: detail.node.countryIso,
    },
    canonicalPath: topicHubPath(context, detail.node.slug),
    breadcrumb,
    children,
    units,
    exams,
    relatedTopics,
    stats: {
      unitCount: subtree.unitCount,
      topicCount: subtree.topicCount,
      examCount: exams.available ? exams.items.length : 0,
    },
  }
}

// ---------- Landing exam aggregation ----------

/**
 * Which of the reader's country's ACTIVE exams need units under the topic's
 * subtree today (CURRENT versions, in-effect §8 mappings — the P3-S5 mirror
 * aggregated over the subtree). COMING_SOON markets get the quiet state
 * (§14/§38); an ACTIVE country with no mapped exams gets an honest empty list.
 */
async function composeLandingExams(params: {
  subtreeTopicIds: string[]
  context: Awaited<ReturnType<typeof resolveReaderContext>>
}): Promise<TopicLanding['exams']> {
  const { subtreeTopicIds, context } = params
  if (!context.countryActive) {
    return { available: false, reason: 'COUNTRY_COMING_SOON', items: [] }
  }
  if (subtreeTopicIds.length === 0) {
    return { available: true, reason: null, items: [] }
  }

  // VERIFIED, country-visible units under the subtree (§14/§36).
  const subtreeUnits = await db.knowledgeUnit.findMany({
    where: visibleUnitsWhere(subtreeTopicIds, context.countryRow.id),
    select: { id: true },
  })
  if (subtreeUnits.length === 0) {
    return { available: true, reason: null, items: [] }
  }

  const mappings = await db.examMapping.findMany({
    where: {
      knowledgeUnitId: { in: subtreeUnits.map((unit) => unit.id) },
      syllabusNode: { examVersion: { exam: { status: 'ACTIVE', countryId: context.countryRow.id } } },
    },
    select: {
      knowledgeUnitId: true,
      effectiveFrom: true,
      effectiveTo: true,
      syllabusNode: {
        select: {
          examVersion: {
            select: {
              effectiveFrom: true,
              effectiveTo: true,
              exam: {
                select: {
                  id: true,
                  slug: true,
                  name: true,
                  code: true,
                  organiser: true,
                  level: true,
                },
              },
            },
          },
        },
      },
    },
  })

  // Exam → distinct mapped units (§8 liveness identical to the mirror).
  const unitsByExam = new Map<string, { exam: (typeof mappings)[number]['syllabusNode']['examVersion']['exam']; units: Set<string> }>()
  for (const mapping of mappings) {
    if (isCurrentVersion(mapping.syllabusNode.examVersion) && mappingInEffect(mapping, false)) {
      const exam = mapping.syllabusNode.examVersion.exam
      const entry = unitsByExam.get(exam.id) ?? { exam, units: new Set<string>() }
      entry.units.add(mapping.knowledgeUnitId)
      unitsByExam.set(exam.id, entry)
    }
  }

  return {
    available: true,
    reason: null,
    items: [...unitsByExam.values()]
      .map(({ exam, units: mapped }) => ({
        exam,
        mappedUnitCount: mapped.size,
      }))
      .sort(
        (a, b) =>
          a.exam.name.localeCompare(b.exam.name) || a.exam.slug.localeCompare(b.exam.slug) // deterministic (§37)
      )
      .map<LandingExamCard>(({ exam, mappedUnitCount }) => ({
        slug: exam.slug,
        name: exam.name,
        code: exam.code,
        organiser: exam.organiser,
        level: exam.level,
        mappedUnitCount,
        canonicalPath: examPath(context, exam.slug),
      })),
  }
}
