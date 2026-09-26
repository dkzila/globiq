/**
 * GlobIQ — Exam Mapping module (Master Plan §28, §43 P3-S3…S4)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P3-S3: the §8 requirement layer — ExamMapping rows anchoring canonical
 * KnowledgeUnits to version-pinned SyllabusNodes with per-exam depth,
 * priority, relevance, likelihood, scope, basis and effective period.
 * Console CRUD (staged/live versions), the public per-exam coverage read
 * (§11 step 3's data contract), and the §14 country-guarded unit picker with
 * cross-exam mapping context (Appendix A's "same unit, different depth"
 * workflow).
 *
 * P3-S4: the §11 multi-exam union/deduplication engine — the COMPUTED
 * combined-exam view (union by canonical unit id, max required depth, the
 * covering-exam set for the "Covers: Exam A + Exam B" badge, base ranking
 * by priority/likelihood/freshness). Single-exam mode is the same call with
 * one ref. Nothing is stored (§46.3). Until P5-S1 wires follows, clients
 * pass the exam set explicitly.
 */
export {
  MappingError,
  toMappingErrorResponse,
  mappingEditability,
  getAdminVersionMappings,
  searchUnitsForMapping,
  createExamMapping,
  updateExamMapping,
  removeExamMapping,
  getPublicExamCoverage,
} from './mapping-service'
export { getCombinedExamView } from './combination-service'
export {
  createExamMappingSchema,
  updateExamMappingSchema,
  mappingUnitSearchSchema,
  publicCoverageQuerySchema,
  combinedQueueQuerySchema,
  parseCombinedExamRefs,
  MAX_COMBINED_EXAMS,
  MAPPING_RELEVANCE,
  MAPPING_PRIORITIES,
  REQUIRED_DEPTHS,
  QUESTION_LIKELIHOOD,
} from './validation'
export type {
  CreateExamMappingInput,
  UpdateExamMappingInput,
  MappingUnitSearchQuery,
  PublicCoverageQuery,
  CombinedQueueQuery,
} from './validation'
export type {
  AdminMapping,
  AdminMappingNode,
  AdminVersionMappings,
  CombinedCovering,
  CombinedExamResolution,
  CombinedExamView,
  CombinedQueueUnit,
  MappingEditability,
  MappingPriorityPublic,
  MappingRelevancePublic,
  MappingUnitOption,
  PublicCoverageMapping,
  PublicCoverageNode,
  PublicExamCoverage,
  QuestionLikelihoodPublic,
  RequiredDepthPublic,
  UnitMappingContext,
} from './types'
export { REQUIRED_DEPTH_ORDER } from './types'
