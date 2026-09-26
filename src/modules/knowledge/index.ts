/**
 * GlobIQ — Knowledge module (Master Plan §28, §43 P2-S1)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 */
export {
  KnowledgeError,
  toKnowledgeErrorResponse,
  getPublicKnowledgeUnits,
  getPublicKnowledgeUnit,
  getAdminKnowledgeUnits,
  getAdminKnowledgeUnit,
  createKnowledgeUnit,
  updateKnowledgeUnit,
  transitionKnowledgeUnit,
} from './service'
export {
  createKnowledgeUnitSchema,
  updateKnowledgeUnitSchema,
  knowledgeTransitionSchema,
  publicKnowledgeListQuerySchema,
  adminKnowledgeListQuerySchema,
} from './validation'
export type {
  CreateKnowledgeUnitInput,
  UpdateKnowledgeUnitInput,
  KnowledgeTransitionInput,
  PublicKnowledgeListQuery,
  AdminKnowledgeListQuery,
} from './validation'
export type {
  AdminKnowledgeListResult,
  AdminKnowledgeUnit,
  KnowledgeDifficultyPublic,
  KnowledgeEditability,
  KnowledgeScopePublic,
  KnowledgeStatusPublic,
  KnowledgeTopicRef,
  KnowledgeTransitionAction,
  KnowledgeUnitTypePublic,
  KnowledgeValidity,
  PublicKnowledgeListResult,
  PublicKnowledgeUnitDetail,
  PublicKnowledgeUnitSummary,
} from './types'
export {
  KNOWLEDGE_TRANSITIONS,
  KNOWLEDGE_EDITABILITY,
} from './types'
