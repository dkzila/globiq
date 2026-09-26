/**
 * GlobIQ — Exam Mapping module: the §11 Multi-Exam Combination Engine (P3-S4)
 *
 * The central mechanism that solves the "student preparing for RRB Group D
 * and MP Police Constable at the same time" problem (§11): a COMPUTED view,
 * never a separately stored syllabus/content database (§46.3).
 *
 * Algorithm — implemented step by step (numbers in comments):
 *  1. Collect the exam set, valid for the user's country (§14 enforced
 *     server-side; until P5-S1 wires follows, the client passes the set —
 *     single-exam mode is the same call with one ref, "without any additional
 *     data modeling").
 *  2. Resolve each exam to its ACTIVE ExamVersion (the §36 window containing
 *     now; future/staged versions never contribute).
 *  3. Expand each version's SyllabusNode tree into its mapped canonical
 *     KnowledgeUnits via ExamMapping (§13 — the only exam→knowledge path),
 *     keeping public reality: VERIFIED, country-visible, in-effect mappings.
 *  4. UNION the KnowledgeUnit ids across all exams.
 *  5. Shared units keep the MAXIMUM required_depth (the §8 ladder:
 *     ONE_LINE < FACT < CONCEPT < DETAILED < ANALYTICAL) and the set of
 *     relevant exams/syllabus nodes — the "Covers: Exam A + Exam B" badge.
 *  6. Deduplicate strictly by CANONICAL identity (unit id) — never by
 *     title/text similarity, which is unreliable.
 *  7. Rank the combined queue. §11 lists "user state (mastery, revision
 *     due-date), priority, and freshness" — mastery/revision arrive in P7 and
 *     personalisation in P5, so this session ships the deterministic BASE
 *     ranking (priority → question likelihood → freshness), with the
 *     comparator documented as the single merge point for those signals.
 *  8. Render each item once, showing which exams cover it (the API ships the
 *     covering set; the UI renders "Covers: …").
 *
 * Nothing here persists: no writes, no audit, no storage — every response is
 * computed at request time (§46.3).
 */
import { db } from '@/lib/db'
import { buildCanonicalUrl } from '@/modules/country-locale'
import {
  ExamError,
  findExam,
  resolvePublicContext,
  windowContains,
} from '@/modules/exams-syllabus'
import type { ExamRow, VersionWithCount } from '@/modules/exams-syllabus'

import {
  loadVersionMappings,
  loadVersionNodes,
  mappingInEffect,
  resolveTopicLabels,
  type MappingRow,
  type NodeRow,
} from './mapping-service'
import type {
  CombinedCovering,
  CombinedExamResolution,
  CombinedExamView,
  CombinedQueueUnit,
  MappingPriorityPublic,
  QuestionLikelihoodPublic,
  RequiredDepthPublic,
} from './types'
import { REQUIRED_DEPTH_ORDER } from './types'
import type { CombinedQueueQuery } from './validation'

// ---------- §11 step 7 — base ranking weights ----------

/** Mapping priority weight (§8): CORE before SUPPORTING before LOW. */
const PRIORITY_WEIGHT: Record<MappingPriorityPublic, number> = {
  CORE: 3,
  SUPPORTING: 2,
  LOW: 1,
}

/** Question-likelihood weight (§8): HIGH before MEDIUM before LOW. */
const LIKELIHOOD_WEIGHT: Record<QuestionLikelihoodPublic, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

/** §8 depth ladder position (shallow → deep); the §11 step 5 max uses this. */
const depthRank = (depth: RequiredDepthPublic): number =>
  REQUIRED_DEPTH_ORDER.indexOf(depth)

/** Deterministic string ordering (§37) — plain code-unit compare, no locale. */
function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------- Step 2: resolve the input set ----------

interface ResolvedExam {
  exam: ExamRow
  /** §11 step 2: the ACTIVE version — the §36 window containing now. */
  version: VersionWithCount | null
}

/**
 * Resolves one ref inside the request's country context. Uniform 404s for
 * unknown, non-ACTIVE and out-of-country exams (§14/§15 — the exam is simply
 * not part of this country's public reality; no enumeration).
 */
async function resolveExamRef(ref: string, countryId: string): Promise<ResolvedExam> {
  const exam = await findExam(ref)
  if (!exam || exam.countryId !== countryId || exam.status !== 'ACTIVE') {
    throw new ExamError('EXAM_NOT_FOUND', `Exam "${ref}" was not found in this country`)
  }
  return { exam, version: exam.versions.find((row) => windowContains(row)) ?? null }
}

// ---------- Union accumulation (§11 steps 3–6) ----------

interface CoveringSeed {
  /** Position of the covering exam in the (deduplicated) request order. */
  examIndex: number
  exam: { slug: string; name: string; code: string }
  node: NodeRow
  mapping: MappingRow
}

interface UnitAccumulator {
  unit: MappingRow['knowledgeUnit']
  coverings: CoveringSeed[]
}

// ---------- Public service ----------

/**
 * The §11 combined-exam view: the union learning queue across the requested
 * exams (or one exam — single-exam mode, same algorithm). COMPUTED at request
 * time; nothing is stored (§46.3).
 */
export async function getCombinedExamView(query: CombinedQueueQuery): Promise<CombinedExamView> {
  // Step 1: the request's country context (§14 enforced server-side).
  const { countryRow, country, languageCode } = await resolvePublicContext(query)
  const language = {
    code: languageCode,
    name:
      country.defaultLanguage.code === languageCode
        ? country.defaultLanguage.name
        : country.languages.find((l) => l.code === languageCode)?.name ?? languageCode,
    nativeName: country.languages.find((l) => l.code === languageCode)?.nativeName ?? null,
  }

  // Steps 1–2: resolve every ref (parallel; order preserved by array index).
  const resolvedList = await Promise.all(
    query.exams.map((ref) => resolveExamRef(ref, countryRow.id))
  )

  // The same exam may arrive twice under different refs (slug + id) — the
  // union is over exams, not strings: keep the first resolution per exam id.
  const seenExamIds = new Set<string>()
  const exams: Array<{ resolved: ResolvedExam; index: number }> = []
  for (let index = 0; index < resolvedList.length; index += 1) {
    const resolved = resolvedList[index]
    if (seenExamIds.has(resolved.exam.id)) continue
    seenExamIds.add(resolved.exam.id)
    exams.push({ resolved, index: exams.length })
  }

  // Step 3: load each ACTIVE version's nodes + mappings in parallel.
  const perExam = await Promise.all(
    exams.map(async ({ resolved }) => {
      if (!resolved.version) return { resolved, nodes: [] as NodeRow[], mappings: [] as MappingRow[] }
      const [nodes, mappings] = await Promise.all([
        loadVersionNodes(resolved.version.id),
        loadVersionMappings(resolved.version.id),
      ])
      return { resolved, nodes, mappings }
    })
  )

  // Steps 3–6: union by canonical unit id (strictly canonical dedup).
  const union = new Map<string, UnitAccumulator>()
  const resolutions: CombinedExamResolution[] = []
  const topicIdsOfInterest = new Set<string>()

  perExam.forEach(({ resolved, nodes, mappings }, position) => {
    const nodesById = new Map(nodes.map((node) => [node.id, node]))

    // Public reality (mirrors getPublicExamCoverage).
    const visible = mappings.filter(
      (mapping) =>
        mapping.knowledgeUnit.status === 'VERIFIED' &&
        (mapping.knowledgeUnit.scope === 'GLOBAL' ||
          mapping.knowledgeUnit.countryId === countryRow.id) &&
        mappingInEffect(mapping, false)
    )

    const examRef = {
      slug: resolved.exam.slug,
      name: resolved.exam.name,
      code: resolved.exam.code,
    }

    const unitIds = new Set<string>()
    for (const mapping of visible) {
      const node = nodesById.get(mapping.syllabusNodeId)
      if (!node) continue // defensive: mappings always anchor on version nodes
      if (node.topic) topicIdsOfInterest.add(node.topic.id)

      const seed: CoveringSeed = { examIndex: position, exam: examRef, node, mapping }
      const existing = union.get(mapping.knowledgeUnitId)
      if (existing) {
        existing.coverings.push(seed)
      } else {
        union.set(mapping.knowledgeUnitId, {
          unit: mapping.knowledgeUnit,
          coverings: [seed],
        })
      }
      unitIds.add(mapping.knowledgeUnitId)
    }

    resolutions.push({
      exam: {
        id: resolved.exam.id,
        slug: resolved.exam.slug,
        name: resolved.exam.name,
        code: resolved.exam.code,
        level: resolved.exam.level,
      },
      version: resolved.version
        ? {
            id: resolved.version.id,
            label: resolved.version.label,
            effectiveFrom: resolved.version.effectiveFrom.toISOString(),
            effectiveTo: resolved.version.effectiveTo?.toISOString() ?? null,
          }
        : null,
      note: resolved.version
        ? null
        : 'No syllabus version is in effect yet — nothing to combine for this exam.',
      unitCount: unitIds.size,
      mappingCount: visible.length,
    })
  })

  // §35 topic labels for the covering nodes (requested → country default → canonical).
  const labels = await resolveTopicLabels(
    [...topicIdsOfInterest],
    languageCode,
    country.defaultLanguage.code
  )

  // Step 5: assemble each united unit — max depth, strongest priority and
  // likelihood, distinct covering exams, per-(exam × node) covering rows.
  const units: CombinedQueueUnit[] = []
  for (const accumulator of union.values()) {
    // Deterministic covering order: request order → node priority → node id.
    const coveringsSeeds = [...accumulator.coverings].sort(
      (a, b) =>
        a.examIndex - b.examIndex ||
        a.node.priority - b.node.priority ||
        compareStrings(a.node.id, b.node.id)
    )

    const coverings: CombinedCovering[] = coveringsSeeds.map((seed) => ({
      exam: seed.exam,
      node: {
        name: seed.node.name,
        depth: seed.node.depth,
        topic: seed.node.topic
          ? {
              slug: seed.node.topic.slug,
              canonicalName: seed.node.topic.canonicalName,
              label: labels.get(seed.node.topic.id)?.label ?? seed.node.topic.canonicalName,
              labelLanguage: labels.get(seed.node.topic.id)?.language ?? 'canonical',
            }
          : null,
      },
      requiredDepth: seed.mapping.requiredDepth,
      priority: seed.mapping.priority,
      relevance: seed.mapping.relevance,
      questionLikelihood: seed.mapping.questionLikelihood,
      expectedScope: seed.mapping.expectedScope,
      effectiveFrom: seed.mapping.effectiveFrom?.toISOString() ?? null,
      effectiveTo: seed.mapping.effectiveTo?.toISOString() ?? null,
    }))

    // Step 5: the maximum required depth (the deepest exam wins — Appendix A:
    // "the user receives the deeper version once").
    const maxDepth = coveringsSeeds.reduce(
      (deepest, seed) => Math.max(deepest, depthRank(seed.mapping.requiredDepth)),
      0
    )
    const strongestPriority = coveringsSeeds.reduce(
      (strongest, seed) => Math.max(strongest, PRIORITY_WEIGHT[seed.mapping.priority]),
      0
    )
    const strongestLikelihood = coveringsSeeds.reduce(
      (strongest, seed) => Math.max(strongest, LIKELIHOOD_WEIGHT[seed.mapping.questionLikelihood]),
      0
    )
    const latestEffectiveFrom = coveringsSeeds.reduce<number | null>((latest, seed) => {
      const time = seed.mapping.effectiveFrom?.getTime() ?? null
      if (time == null) return latest
      return latest == null ? time : Math.max(latest, time)
    }, null)

    // Step 5: the distinct covering-exam set (badge input), request order.
    const examByKey = new Map<string, { slug: string; name: string; code: string }>()
    for (const seed of coveringsSeeds) {
      if (!examByKey.has(seed.exam.slug)) examByKey.set(seed.exam.slug, seed.exam)
    }
    const coveringExams = [...examByKey.values()]

    units.push({
      unit: {
        slug: accumulator.unit.slug,
        canonicalName: accumulator.unit.canonicalName,
        canonicalSummary: accumulator.unit.canonicalSummary,
        type: accumulator.unit.type,
        difficulty: accumulator.unit.difficulty,
      },
      canonicalPath: buildCanonicalUrl(
        { slug: country.slug, isDefault: country.isDefault },
        { code: languageCode },
        country.defaultLanguage.code,
        ['gk', accumulator.unit.topic.slug, accumulator.unit.slug]
      ),
      requiredDepth: REQUIRED_DEPTH_ORDER[maxDepth],
      priority:
        (Object.keys(PRIORITY_WEIGHT) as MappingPriorityPublic[]).find(
          (key) => PRIORITY_WEIGHT[key] === strongestPriority
        ) ?? 'LOW',
      questionLikelihood:
        (Object.keys(LIKELIHOOD_WEIGHT) as QuestionLikelihoodPublic[]).find(
          (key) => LIKELIHOOD_WEIGHT[key] === strongestLikelihood
        ) ?? 'LOW',
      exams: coveringExams,
      examCount: coveringExams.length,
      isShared: coveringExams.length > 1,
      coverings,
      latestEffectiveFrom:
        latestEffectiveFrom == null ? null : new Date(latestEffectiveFrom).toISOString(),
    })
  }

  // Step 7: the base ranking — priority → likelihood → freshness → name → slug.
  // Deterministic (§37); the documented merge point for P5 personalisation
  // and P7 mastery/revision signals (they fold in as earlier comparators).
  units.sort((a, b) => {
    const priorityDelta = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
    if (priorityDelta !== 0) return priorityDelta
    const likelihoodDelta =
      LIKELIHOOD_WEIGHT[b.questionLikelihood] - LIKELIHOOD_WEIGHT[a.questionLikelihood]
    if (likelihoodDelta !== 0) return likelihoodDelta
    const aFresh = a.latestEffectiveFrom ? Date.parse(a.latestEffectiveFrom) : null
    const bFresh = b.latestEffectiveFrom ? Date.parse(b.latestEffectiveFrom) : null
    if (aFresh !== bFresh) {
      if (aFresh == null) return 1 // freshness: newest first, never-attached last
      if (bFresh == null) return -1
      return bFresh - aFresh
    }
    return (
      compareStrings(a.unit.canonicalName, b.unit.canonicalName) ||
      compareStrings(a.unit.slug, b.unit.slug)
    )
  })

  const mappingCount = resolutions.reduce((total, entry) => total + entry.mappingCount, 0)
  const sharedUnitCount = units.filter((unit) => unit.isShared).length

  return {
    exams: resolutions,
    units,
    stats: {
      examCount: resolutions.length,
      unitCount: units.length,
      mappingCount,
      sharedUnitCount,
      duplicatesAvoided: mappingCount - units.length,
    },
    language,
    computedAt: new Date().toISOString(),
  }
}
