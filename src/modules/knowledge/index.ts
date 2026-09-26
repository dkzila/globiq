/**
 * GlobIQ — Knowledge module (Master Plan §28, §43 P2-S1…S5)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P2-S1: KnowledgeUnit — the canonical semantic record (§7).
 * P2-S2: ContentItem + revisions — publishable representations of that record
 *        (one language × one format each), with immutable published snapshots.
 * P2-S3: Source & provenance — the §24 trust model: evidence records with an
 *        editor verification workflow, claim/content-level citation links on
 *        content objects, and AI-provenance flags (§26).
 * P2-S5: Canonical rendering — the §22 knowledge-page assembly (quick fact,
 *        deeper explanation, related concepts, sources, exam coverage) with
 *        §16 canonical paths and §35 translation surfaces.
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

// ---------- P2-S2: ContentItem + revisions ----------
export {
  ContentError,
  toContentErrorResponse,
  getPublicContentItems,
  getPublicContentItem,
  getAdminContentItems,
  getAdminContentItem,
  listContentRevisions,
  createContentItem,
  updateContentItem,
  transitionContentItem,
} from './content-service'
export {
  createContentItemSchema,
  updateContentItemSchema,
  contentTransitionSchema,
  publicContentListQuerySchema,
  adminContentListQuerySchema,
  CONTENT_FORMATS,
  CONTENT_TRANSITION_ACTIONS,
  FORMAT_BODY_RULES,
  bodyFitsFormat,
} from './content-validation'
export type {
  CreateContentItemInput,
  UpdateContentItemInput,
  ContentTransitionInput,
  PublicContentListQuery,
  AdminContentListQuery,
} from './content-validation'
export type {
  AdminContentItem,
  AdminContentListResult,
  AdminContentRevisionListResult,
  ContentFormatPublic,
  ContentRevisionRef,
  ContentStatusPublic,
  ContentTransitionAction,
  ContentPagination,
  PublicContentItemDetail,
  PublicContentItemSummary,
  PublicContentListResult,
} from './content-types'
export {
  CONTENT_TRANSITIONS,
  CONTENT_EDITABILITY,
} from './content-types'

// ---------- P2-S3: Source & provenance (§24/§26) ----------
export {
  SourceError,
  toSourceErrorResponse,
  getAdminSources,
  getAdminSource,
  createSource,
  updateSource,
  transitionSourceVerification,
  listContentSources,
  linkSourceToItem,
  updateContentSourceClaim,
  unlinkSourceFromItem,
} from './source-service'
export {
  createSourceSchema,
  updateSourceSchema,
  sourceVerificationSchema,
  adminSourceListQuerySchema,
  linkSourceSchema,
  updateSourceLinkSchema,
  normalizeSourceUrl,
} from './source-validation'
export type {
  CreateSourceInput,
  UpdateSourceInput,
  SourceVerificationInput,
  AdminSourceListQuery,
  LinkSourceInput,
  UpdateSourceLinkInput,
} from './source-validation'
export type {
  AdminContentSourceLink,
  AdminContentSourceListResult,
  AdminSource,
  AdminSourceDetail,
  AdminSourceListResult,
  AdminSourceUsage,
  PublicSourceRef,
  SourceTypePublic,
  SourceVerificationAction,
  SourceVerificationPublic,
} from './source-types'
export {
  SOURCE_TYPES,
  SOURCE_VERIFICATIONS,
  SOURCE_VERIFICATION_TRANSITIONS,
} from './source-types'

// ---------- P2-S5: Canonical reading page (§22) ----------
export { getKnowledgePage } from './render-service'
export { PAGE_FORMAT_ORDER } from './render-types'
export type {
  ComparisonRow,
  ExamCoverageLayer,
  KnowledgePage,
  PageRepresentation,
  PageSource,
  ProfileField,
  QuickFactLayer,
  RelatedUnit,
  RepresentationParsed,
  TimelineEntry,
} from './render-types'
