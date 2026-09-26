/**
 * GlobIQ — Search module (Master Plan §28, §43 P4-S1)
 *
 * Public interface. Other modules and route handlers import from here only.
 *
 * Consumers:
 *  - `publicSearch` + `searchQuerySchema` — the §17 product surface (§38
 *    public app): GET /api/search.
 *  - `onUnitChanged` / `onTopicChanged` / `onExamChanged` / `onMappingsChanged`
 *    — indexing hooks called by the knowledge/content/taxonomy/exams/exam-
 *    mapping services after visibility-affecting mutations (§17 freshness by
 *    construction; one-way dependency — this module never imports them back).
 *  - `reindexAll` + `getIndexStats` — the §38 admin console surface.
 */
export { SearchError, toSearchErrorResponse } from './errors'
export type { SearchErrorCode } from './errors'

export { searchQuerySchema, SEARCH_TYPE_FILTERS } from './validation'
export type { SearchQuery } from './validation'

export { SEARCH_ENGINE_ID } from './engine'

export {
  buildUnitDocuments,
  buildTopicDocuments,
  buildExamDocuments,
  reindexObject,
  reindexAll,
  getIndexStats,
  onUnitChanged,
  onTopicChanged,
  onExamChanged,
  onMappingsChanged,
} from './indexing-service'

export { publicSearch } from './query-service'

export type {
  SearchAdminStats,
  SearchMatchedVia,
  SearchObjectTypePublic,
  SearchPresentedFrom,
  SearchResultExamRef,
  SearchResultItem,
  SearchResponse,
  SearchReindexResult,
  SearchTypeFilter,
} from './types'
