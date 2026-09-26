/**
 * GlobIQ — SEO module (Master Plan §28, §43 P4-S2…S5)
 *
 * Public interface. Other modules and route handlers import from here only.
 * Internal files may change without notice (modular monolith rule, §28).
 *
 * P4-S2: the §34 country homepages (each country's GK/current-affairs index
 *        and discovery hub — India at the §16 root default) and the §33/§16
 *        topic landing pages (…/gk/{topic-slug}/) — both as computed views
 *        over the canonical model (§7 store-once) with §14/§15 server-side
 *        country scope, §35 language resolution with honest fallback, §36
 *        lifecycle-aware reads and §37 client-agnostic DTOs.
 * P4-S3…S5 (future sessions): exam/syllabus SEO pages, canonical
 *        URL/hreflang/sitemap/robots infrastructure, metadata and structured
 *        data with SEO validation.
 */
export { SeoError, toSeoErrorResponse } from './errors'
export type { SeoErrorCode } from './errors'

export { homepageQuerySchema, topicLandingQuerySchema, topicRefSchema } from './validation'
export type { HomepageQuery, TopicLandingQuery } from './validation'

export { getCountryHomepage } from './homepage-service'
export { getTopicLanding } from './topic-landing-service'

export type {
  CountryHomepage,
  CountryStatusPublic,
  DiscoveryLanguage,
  ExamsSection,
  HomepageCategory,
  HomepageCurrentAffairs,
  HomepageExamCard,
  HomepageTopicCard,
  HomepageUnitCard,
  LandingChildTopic,
  LandingExamCard,
  LandingRelatedTopic,
  LandingUnitsSection,
  TopicLanding,
} from './types'
