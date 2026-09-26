/**
 * GlobIQ — Exam Mapping module: public DTOs (P3-S3/P3-S4)
 * Master Plan §6 (ExamMapping row), §8 (the requirement layer: relevance,
 * priority, required_depth, expected_scope, question_likelihood, source_basis,
 * effective_period, notes), §11 (step 3: expand a version's tree into its
 * mapped canonical units; steps 4–9: the P3-S4 combined-exam union — max
 * depth, covering-exam set, canonical dedup, ranked queue), §13 (the only
 * exam→knowledge path), §14 (unit scope: GLOBAL or the exam's country),
 * §16 (knowledge-page paths shipped as data), §35 (topic labels per language
 * on coverage nodes), §36 (version-pinned mappings; superseded = history),
 * §37 (client-agnostic shapes, no internal ids beyond console needs),
 * §46.3 (a computed union, never a stored duplicate).
 */

// ---------- §8 vocabulary (mirror of the Prisma enums — client-agnostic) ----------

export type MappingRelevancePublic = 'DIRECT' | 'PARTIAL' | 'CONTEXTUAL'
export type MappingPriorityPublic = 'CORE' | 'SUPPORTING' | 'LOW'
export type RequiredDepthPublic = 'ONE_LINE' | 'FACT' | 'CONCEPT' | 'DETAILED' | 'ANALYTICAL'
export type QuestionLikelihoodPublic = 'HIGH' | 'MEDIUM' | 'LOW'

/** Ordered shallow → deep (§8 ladder; the §11 union takes the max across exams). */
export const REQUIRED_DEPTH_ORDER: readonly RequiredDepthPublic[] = [
  'ONE_LINE',
  'FACT',
  'CONCEPT',
  'DETAILED',
  'ANALYTICAL',
]

// ---------- §36 mapping editability ----------

/**
 * When may mappings on this version change? (Schema comment in
 * prisma/schema.prisma documents why this differs from the TREE rule.)
 * - `staged`: DRAFT exam (private provisioning) or future-dated version.
 * - `live`: the CURRENT version in effect — mappings keep flowing because
 *   §12 step 5 requires current-affairs knowledge to attach to live syllabi
 *   "the moment it's mapped". The TREE stays frozen (P3-S2 rule unchanged).
 * - `frozen`: started but superseded — §36 history, read-only.
 * - `locked`: RETIRED exam — everything read-only.
 */
export type MappingEditability = 'staged' | 'live' | 'frozen' | 'locked'

// ---------- Console (editorial) shapes ----------

/** A mapping row as the console renders it (§8 fields + unit context). */
export interface AdminMapping {
  id: string
  unit: {
    id: string
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    /** Unit lifecycle — public coverage shows VERIFIED only; the console sees all. */
    status: string
    /** The unit's own canonical topic (§13). */
    topicSlug: string | null
  }
  relevance: MappingRelevancePublic
  priority: MappingPriorityPublic
  requiredDepth: RequiredDepthPublic
  questionLikelihood: QuestionLikelihoodPublic
  expectedScope: string | null
  sourceBasis: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

/** A syllabus node with its mappings (the console tree). */
export interface AdminMappingNode {
  id: string
  name: string
  depth: number
  priority: number
  topic: { slug: string; canonicalName: string } | null
  mappingCount: number
  mappings: AdminMapping[]
  children: AdminMappingNode[]
}

/** GET admin mapping read — the whole version's mapping surface at once. */
export interface AdminVersionMappings {
  exam: {
    id: string
    slug: string
    name: string
    code: string
    status: string
    countryIso: string
    countryName: string
  }
  version: {
    id: string
    label: string
    effectiveFrom: string
    effectiveTo: string | null
    isCurrent: boolean
    isUpcoming: boolean
    nodeCount: number
    mappingCount: number
  }
  editability: MappingEditability
  editabilityReason: string
  /** Total mappings pinned to this version (all nodes; incl. expired/future). */
  mappingCount: number
  nodeCount: number
  tree: AdminMappingNode[]
}

// ---------- Unit search (the console's §8 mapping picker) ----------

/** Where a unit is already mapped — the cross-exam context that makes the
 * Appendix A "same unit, different depth" workflow visible while mapping. */
export interface UnitMappingContext {
  examSlug: string
  examName: string
  examCode: string
  versionId: string
  versionLabel: string
  versionIsCurrent: boolean
  nodeId: string
  nodeName: string
  requiredDepth: RequiredDepthPublic
}

/** A knowledge unit offered to the mapping picker (country-visible, §14). */
export interface MappingUnitOption {
  id: string
  slug: string
  canonicalName: string
  canonicalSummary: string | null
  type: string
  difficulty: string
  status: string
  topic: { slug: string; canonicalName: string } | null
  /** Existing mappings across this exam's country's exams (all versions). */
  mappedOn: UnitMappingContext[]
}

// ---------- Public coverage shapes (§38; consumed by P3-S4/S5) ----------

/** One mapped unit on the public coverage view. */
export interface PublicCoverageMapping {
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
  }
  /** §16 knowledge-page path (…/gk/{topic}/{slug}/) in the resolved locale. */
  canonicalPath: string
  requiredDepth: RequiredDepthPublic
  priority: MappingPriorityPublic
  relevance: MappingRelevancePublic
  expectedScope: string | null
  /** §8: "editorial/analytical metadata; not a guaranteed prediction". */
  questionLikelihood: QuestionLikelihoodPublic
  effectiveFrom: string | null
  effectiveTo: string | null
}

/** A syllabus node on the public coverage tree (only mapping-bearing branches). */
export interface PublicCoverageNode {
  name: string
  depth: number
  priority: number
  topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  mappings: PublicCoverageMapping[]
  children: PublicCoverageNode[]
}

/** GET /api/exams/{ref}/coverage — the units an exam needs, per syllabus node. */
export interface PublicExamCoverage {
  exam: { id: string; slug: string; name: string; code: string; level: string }
  /** The version whose coverage is returned — current by default (§11 step 2),
   * or an explicitly requested STARTED version (§36 historical query). */
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null; isCurrent: boolean } | null
  editability: MappingEditability
  /** Distinct mapped units (a unit mapped to several nodes counts once). */
  unitCount: number
  mappingCount: number
  nodes: PublicCoverageNode[]
  language: { code: string; name: string; nativeName: string | null }
}

// ---------- §11 combined-exam shapes (P3-S4; consumed by P3-S5 pages) ----------

/** One exam's resolution inside a combined request (§11 steps 1–2). */
export interface CombinedExamResolution {
  exam: { id: string; slug: string; name: string; code: string; level: string }
  /** The ACTIVE version (the §36 window containing now) — null when nothing
   * is in effect yet, e.g. an exam whose versions are all still future. */
  version: { id: string; label: string; effectiveFrom: string; effectiveTo: string | null } | null
  /** Present when `version` is null — why this exam contributes nothing. */
  note: string | null
  /** Distinct units this exam contributed to the union. */
  unitCount: number
  /** Coverings this exam contributed (a unit may anchor at several nodes). */
  mappingCount: number
}

/** One (exam × syllabus node) requirement row behind a united unit. */
export interface CombinedCovering {
  exam: { slug: string; name: string; code: string }
  node: {
    name: string
    depth: number
    /** §35 topic label resolved requested → country default → canonical. */
    topic: { slug: string; canonicalName: string; label: string; labelLanguage: string } | null
  }
  requiredDepth: RequiredDepthPublic
  priority: MappingPriorityPublic
  relevance: MappingRelevancePublic
  questionLikelihood: QuestionLikelihoodPublic
  expectedScope: string | null
  effectiveFrom: string | null
  effectiveTo: string | null
}

/**
 * A canonical unit in the combined learning queue — rendered ONCE with its
 * covering exams (§11 steps 4–6 and 8–9; Appendix A's "deeper version once,
 * badged with both exams"). `requiredDepth` is the MAXIMUM across coverings
 * (§11 step 5); each covering keeps its own per-exam depth so the ladder
 * stays visible.
 */
export interface CombinedQueueUnit {
  unit: {
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
  }
  /** §16 knowledge-page path (…/gk/{topic}/{slug}/) in the resolved locale. */
  canonicalPath: string
  /** §11 step 5: the MAXIMUM required depth across covering exams. */
  requiredDepth: RequiredDepthPublic
  /** Strongest priority/likelihood across coverings — the §11 step 7 ranking
   * inputs available before personalisation lands (P5) and mastery/revision
   * signals arrive (P7). */
  priority: MappingPriorityPublic
  questionLikelihood: QuestionLikelihoodPublic
  /** Distinct covering exams, in request order — the "Covers: Exam A + Exam B"
   * badge input (§11 step 5/9; Appendix A's "Exam B only" is examCount 1). */
  exams: Array<{ slug: string; name: string; code: string }>
  examCount: number
  isShared: boolean
  /** One row per (exam × node) — the same unit may anchor at several nodes
   * of one exam (e.g. Prelims polity and Mains Fundamental Rights). */
  coverings: CombinedCovering[]
  /** Most recent mapping effectiveFrom across coverings (§11 step 7 freshness). */
  latestEffectiveFrom: string | null
}

/**
 * GET /api/exams/combined — the §11 computed combined-exam view: the union
 * queue across the requested exams. §46.3: a COMPUTED union, never a stored
 * duplicate — nothing here persists; `computedAt` records the request time.
 * Single-exam mode is the same shape with one exam in `exams` (§11).
 */
export interface CombinedExamView {
  /** The resolved input set — order mirrors the request (refs deduplicated). */
  exams: CombinedExamResolution[]
  /** The union queue — every canonical unit ONCE (§11 steps 4–6, 8). */
  units: CombinedQueueUnit[]
  stats: {
    /** Exams in the request set (after dedup). */
    examCount: number
    /** Distinct canonical units in the union (§11 step 4). */
    unitCount: number
    /** Total coverings across all exams (pre-dedup requirement rows). */
    mappingCount: number
    /** Units covered by two or more exams (the "Covers:" rows). */
    sharedUnitCount: number
    /** mappingCount − unitCount — requirement rows collapsed by canonical
     * identity (§11 step 6: dedup strictly canonical, never by title). */
    duplicatesAvoided: number
  }
  language: { code: string; name: string; nativeName: string | null }
  computedAt: string
}
