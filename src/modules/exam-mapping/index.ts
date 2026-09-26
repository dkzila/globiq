/**
 * GlobIQ — Exam Mapping module (Master Plan §28, §43 P3-S3)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P3-S3: the §8 requirement layer — ExamMapping rows anchoring canonical
 * KnowledgeUnits to version-pinned SyllabusNodes with per-exam depth,
 * priority, relevance, likelihood, scope, basis and effective period.
 * Console CRUD (staged/live versions), the public per-exam coverage read
 * (§11 step 3's data contract — the P3-S4 union engine and P3-S5 pages
 * consume it), and the §14 country-guarded unit picker with cross-exam
 * mapping context (Appendix A's "same unit, different depth" workflow).
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
export {
  createExamMappingSchema,
  updateExamMappingSchema,
  mappingUnitSearchSchema,
  publicCoverageQuerySchema,
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
} from './validation'
export type {
  AdminMapping,
  AdminMappingNode,
  AdminVersionMappings,
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
