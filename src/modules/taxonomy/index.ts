/**
 * GlobIQ — Taxonomy module (Master Plan §28, §43 P1-S4)
 *
 * Public interface. Other modules and route handlers import from here only.
 */
export {
  TaxonomyError,
  toTaxonomyErrorResponse,
  topicActorFromAuth,
  getPublicTree,
  getPublicTopic,
  searchTopics,
  getAdminTree,
  getAdminTopic,
  createTopic,
  updateTopic,
  retireTopic,
  setTopicLabels,
  setTopicAliases,
} from './service'
export {
  createTopicSchema,
  updateTopicSchema,
  setTopicLabelsSchema,
  setTopicAliasesSchema,
  topicTreeQuerySchema,
  topicSearchQuerySchema,
  topicSlugSchema,
} from './validation'
export type {
  CreateTopicInput,
  UpdateTopicInput,
  SetTopicLabelsInput,
  SetTopicAliasesInput,
} from './validation'
export type {
  AdminTopicDetail,
  AdminTopicNode,
  PublicTopicAlias,
  PublicTopicDetail,
  PublicTopicLabel,
  PublicTopicNode,
  PublicTopicPathEntry,
  TopicActor,
  TopicPermissions,
  TopicSearchResult,
  TopicScopePublic,
  TopicStatusPublic,
  TopicTypePublic,
} from './types'
