/**
 * GlobIQ — Exam Mapping module: per-unit exam coverage (P3-S5)
 *
 * The unit-side mirror of `getPublicExamCoverage` (Master Plan §22 "Knowledge
 * page: … + exam coverage"; §43 P3-S5 "exam-facing pages and coverage
 * display"): every live requirement row pointing AT one canonical unit —
 * "which exams need this, at what depth, under which syllabus topic".
 *
 * §7/§8: the requirement layer is many rows around ONE record. The exam page
 * asks "what does this exam need" (coverage, grouped by node); the knowledge
 * page asks "who needs this unit" (this mirror, one row per exam × node).
 * Both directions render the same §8 vocabulary — nothing is copied or
 * re-entered, and neither view persists anything.
 *
 * Rules enforced here (identical to every public mapping surface):
 * - §13: exams reach knowledge exclusively through SyllabusNode → ExamMapping.
 * - §14/§15: the reader's country context scopes the answer — only THIS
 *   country's ACTIVE exams contribute (a GB exam's requirement on a GLOBAL
 *   unit is GB-visible only, never leaked into an IN read).
 * - §36: CURRENT versions only — the mirror answers "today"; historical
 *   windows stay on the coverage read's explicit `?version=` path.
 * - §8: mappings must be in effect now (future-dated requirements are not
 *   yet real; the day-granular inclusive period applies).
 * - §35: node topic labels resolved requested → country default → canonical.
 * - §16: the exam-page path ships as data (…/exams/{exam-slug}/).
 * - §37: deterministic ordering (exam name → slug → node priority → node
 *   name → mapping id), explicit typed errors, client-agnostic DTOs.
 */
import { db } from '@/lib/db'
import { buildCanonicalUrl } from '@/modules/country-locale'
import { resolvePublicContext, windowContains } from '@/modules/exams-syllabus'

import { MappingError, mappingInEffect, resolveTopicLabels } from './mapping-service'
import type {
  UnitExamCoverage,
  UnitExamRequirement,
} from './types'
import type { UnitCoverageQuery } from './validation'

// ---------- Constants ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

// ---------- Public read ----------

/**
 * Which exams need this canonical unit today, in the reader's country and
 * language context. Unknown units are a typed 404 (§37 — the caller — the
 * §22 knowledge page — has already resolved the unit, so the not-found and
 * country branches cannot fire from that path; they exist for standalone
 * correctness). A non-VERIFIED unit has no public mappings to mirror, so it
 * resolves to the clean empty state instead of an error.
 */
export async function getUnitExamCoverage(
  unitRef: string,
  query: UnitCoverageQuery
): Promise<UnitExamCoverage> {
  // ---------- The canonical record (§7) ----------
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(unitRef) ? { id: unitRef } : { slug: unitRef.toLowerCase() },
    select: { id: true, status: true },
  })
  if (!unit) throw new MappingError('UNIT_NOT_FOUND', 'Knowledge unit not found')

  // ---------- Reader context (§14/§15/§35) ----------
  const { countryRow, country, languageCode } = await resolvePublicContext(query)

  // Public reality: only VERIFIED units have public mappings to mirror (§38).
  if (unit.status !== 'VERIFIED') {
    return { requirements: [], examCount: 0, requirementCount: 0 }
  }

  // ---------- The unit's requirement rows on this country's exams ----------
  const mappings = await db.examMapping.findMany({
    where: {
      knowledgeUnitId: unit.id,
      syllabusNode: {
        examVersion: { exam: { status: 'ACTIVE', countryId: countryRow.id } },
      },
    },
    include: {
      syllabusNode: {
        select: {
          id: true,
          name: true,
          depth: true,
          priority: true,
          topic: { select: { id: true, slug: true, canonicalName: true } },
          examVersion: {
            select: {
              id: true,
              label: true,
              effectiveFrom: true,
              effectiveTo: true,
              exam: { select: { slug: true, name: true, code: true, level: true } },
            },
          },
        },
      },
    },
  })

  // §36 + §8: CURRENT versions only, mappings in effect today. Superseded
  // windows (history) and future-dated requirements never appear here.
  const live = mappings.filter(
    (mapping) =>
      windowContains(mapping.syllabusNode.examVersion) && mappingInEffect(mapping, false)
  )

  // ---------- §35 topic labels on the covering nodes ----------
  const topicIds = [
    ...new Set(
      live.map((mapping) => mapping.syllabusNode.topic?.id).filter((id): id is string => id != null)
    ),
  ]
  const labels = await resolveTopicLabels(topicIds, languageCode, country.defaultLanguage.code)

  // ---------- §37 deterministic ordering ----------
  // Exam name → exam slug → node priority → node name → mapping id: stable
  // across calls and explainable to a reader scanning the panel top-to-bottom.
  live.sort((a, b) => {
    const examA = a.syllabusNode.examVersion.exam
    const examB = b.syllabusNode.examVersion.exam
    return (
      examA.name.localeCompare(examB.name) ||
      examA.slug.localeCompare(examB.slug) ||
      a.syllabusNode.priority - b.syllabusNode.priority ||
      a.syllabusNode.name.localeCompare(b.syllabusNode.name) ||
      a.id.localeCompare(b.id)
    )
  })

  const requirements: UnitExamRequirement[] = live.map((mapping) => {
    const node = mapping.syllabusNode
    const version = node.examVersion
    const label = node.topic ? labels.get(node.topic.id) : undefined
    return {
      exam: {
        slug: version.exam.slug,
        name: version.exam.name,
        code: version.exam.code,
        level: version.exam.level,
      },
      version: {
        label: version.label,
        effectiveFrom: version.effectiveFrom.toISOString(),
        effectiveTo: version.effectiveTo?.toISOString() ?? null,
        isCurrent: true,
      },
      node: {
        name: node.name,
        depth: node.depth,
        topic: node.topic
          ? {
              slug: node.topic.slug,
              canonicalName: node.topic.canonicalName,
              label: label?.label ?? node.topic.canonicalName,
              labelLanguage: label?.language ?? 'canonical',
            }
          : null,
      },
      requiredDepth: mapping.requiredDepth,
      priority: mapping.priority,
      relevance: mapping.relevance,
      questionLikelihood: mapping.questionLikelihood,
      expectedScope: mapping.expectedScope,
      effectiveFrom: mapping.effectiveFrom?.toISOString() ?? null,
      effectiveTo: mapping.effectiveTo?.toISOString() ?? null,
      // §16 exam-page path — country + language + exam identity, never user input.
      examPath: buildCanonicalUrl(
        { slug: country.slug, isDefault: country.isDefault },
        { code: languageCode },
        country.defaultLanguage.code,
        ['exams', version.exam.slug]
      ),
    }
  })

  const examSlugs = new Set(requirements.map((requirement) => requirement.exam.slug))
  return {
    requirements,
    examCount: examSlugs.size,
    requirementCount: requirements.length,
  }
}
