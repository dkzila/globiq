/**
 * GlobIQ — SEO module: public-surface DTOs (P4-S2)
 * Master Plan §33 (SEO landing pages — country GK hubs, evergreen topic
 * pages, topic clusters + internal links), §34 (Homepage Strategy — each
 * country homepage is that country's GK/current-affairs index and discovery
 * hub), §16 (canonical URLs generated from country + language + object
 * identity — never from user input), §14/§15 (explicit country scope
 * enforced server-side; COMING_SOON markets browse, never blocked),
 * §35 (only the country's own languages; canonical fallback labelled
 * honestly), §36 (lifecycle-aware — only VERIFIED units, ACTIVE exams,
 * CURRENT versions, in-effect mappings), §37 (client-agnostic JSON, no HTML
 * fragments — mobile-ready per §39), §38 (public app surface).
 */

/** §16 home URL prefix builder input (already country/language resolved). */
export type CountryStatusPublic = 'ACTIVE' | 'COMING_SOON'

/** The reader's language as exposed on every discovery surface (§35). */
export interface DiscoveryLanguage {
  code: string
  name: string
  nativeName: string | null
  direction: 'LTR' | 'RTL'
  /** §16 canonical home URL for this language inside the country. */
  url: string
  /** True when this is the country's default language (segment omitted §16). */
  isDefault: boolean
}

/**
 * §34 homepage element: current affairs. P6 (Current Affairs event system)
 * fills the live branch; until then every homepage renders the honest quiet
 * state — the discovery hub never fakes freshness (§36/§45).
 */
export interface HomepageCurrentAffairs {
  available: false
  /** Human-readable quiet-state note (rendered as-is). */
  note: string
}

/**
 * §34 homepage element: the country's exam directory. Quiet (not empty) for
 * COMING_SOON markets — exam content is country-scoped (§14) and launches
 * with the market (§38); an ACTIVE country with no exams is an honest empty
 * list, not a quiet state.
 */
export interface ExamsSection<Card> {
  available: boolean
  reason: 'COUNTRY_COMING_SOON' | null
  items: Card[]
}

/** An exam card on the homepage (§34 "exams", §36 CURRENT version). */
export interface HomepageExamCard {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  /** The currently effective §36 version, if any. */
  currentVersion: { label: string; effectiveFrom: string } | null
  /** §8 in-effect mappings on the current version (the "how big is it today" signal). */
  mappingCount: number
  /** §16 canonical exam path in the reader's language. */
  canonicalPath: string
}

/** An exam card on a topic landing page — the exam needs units from this topic. */
export interface LandingExamCard {
  slug: string
  name: string
  code: string
  organiser: string
  level: 'NATIONAL' | 'STATE' | 'REGIONAL'
  /** Distinct units under this topic's subtree that this exam needs today. */
  mappedUnitCount: number
  /** §16 canonical exam path in the reader's language. */
  canonicalPath: string
}

/** §34 "country GK categories": a top-level taxonomy domain (§13) as a hub card. */
export interface HomepageCategory {
  slug: string
  /** Localised label (requested language → country default → canonical). */
  name: string
  labelLanguage: string
  description: string | null
  /** §16 canonical topic-hub path (/gk/{slug}/ under the locale prefix). */
  canonicalPath: string
  /** Visible descendant topics (excluding the domain itself). */
  topicCount: number
  /** VERIFIED units visible under the whole subtree (§14 scope applied). */
  unitCount: number
  /** First-level branches — the §33 cluster preview / internal links. */
  children: Array<{
    slug: string
    name: string
    canonicalPath: string
    topicCount: number
    unitCount: number
  }>
}

/** §34 "major topics": the most content-bearing teachable topics. */
export interface HomepageTopicCard {
  slug: string
  name: string
  labelLanguage: string
  canonicalPath: string
  /** VERIFIED units under the subtree (same rule as category counts). */
  unitCount: number
  scope: 'GLOBAL' | 'COUNTRY'
  /** Breadcrumb labels from the domain down (§33 clusters). */
  path: Array<{ slug: string; name: string }>
}

/**
 * §34 "popular knowledge": a canonical unit teaser card. The summary follows
 * the §22 quick-fact resolution exactly — the published FACT_CARD in the
 * reader's language when it exists, otherwise the canonical summary with an
 * honest fallback marker (§35 — a homepage never pretends a translation
 * exists).
 */
export interface HomepageUnitCard {
  slug: string
  canonicalName: string
  type: string
  difficulty: string
  summary: {
    text: string
    source: 'FACT_CARD' | 'CANONICAL_SUMMARY'
    /** Language of the delivered summary text ('en' for canonical fallback). */
    language: string
  }
  topic: { slug: string; name: string }
  /** §16 canonical knowledge-page path in the reader's language. */
  canonicalPath: string
  /** §8 in-effect requirement rows today: distinct ACTIVE exams of the
   * reader's country needing this unit on CURRENT versions (§36/§14). */
  examCount: number
}

/** GET /api/home payload — the §34 country homepage composition. */
export interface CountryHomepage {
  country: {
    isoCode: string
    slug: string
    name: string
    timezone: string | null
    status: CountryStatusPublic
    isDefault: boolean
  }
  language: { code: string; name: string; nativeName: string | null; direction: 'LTR' | 'RTL' }
  /** §16 canonical home URL for this country × language. */
  canonicalUrl: string
  /** §35 language switcher — ONLY this country's configured languages. */
  languages: DiscoveryLanguage[]
  /** §34 GK categories (top-level §13 domains visible in this country). */
  categories: HomepageCategory[]
  /** §34 major topics. */
  majorTopics: HomepageTopicCard[]
  /** §34 exams (quiet for COMING_SOON markets). */
  exams: ExamsSection<HomepageExamCard>
  /** §34 popular knowledge (deterministic editorial order — orderIndex, name). */
  popularUnits: HomepageUnitCard[]
  /** §34 current affairs (honest quiet state until the P6 event system). */
  currentAffairs: HomepageCurrentAffairs
  /** Hub counters (visible topics, VERIFIED units, ACTIVE exams). */
  stats: { topics: number; units: number; exams: number }
}

// ---------- Topic landing pages (§33/§16) ----------

/** A visible child topic on a landing page (§33 cluster / internal link). */
export interface LandingChildTopic {
  slug: string
  name: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  /** VERIFIED units under this child's subtree. */
  unitCount: number
  /** Visible descendant topic count (excluding itself). */
  topicCount: number
  canonicalPath: string
}

/** §33 internal links: sibling topics of the landing topic. */
export interface LandingRelatedTopic {
  slug: string
  name: string
  type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
  unitCount: number
  canonicalPath: string
}

export interface LandingUnitsSection {
  /** Units attached DIRECTLY to this topic (subtopics carry their own). */
  items: HomepageUnitCard[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

/** GET /api/topics/{slug} payload — the §16/§33 topic landing composition. */
export interface TopicLanding {
  topic: {
    slug: string
    canonicalName: string
    label: string
    labelLanguage: string
    description: string | null
    type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
    scope: 'GLOBAL' | 'COUNTRY'
    countryIso: string | null
  }
  /** §16 canonical hub path in the reader's language. */
  canonicalPath: string
  /** Home → … → self, each entry with its own §16 path (null slug = home). */
  breadcrumb: Array<{ slug: string | null; name: string; path: string }>
  /** Visible children (§33 clusters) in stable tree order. */
  children: LandingChildTopic[]
  /** Units directly on this topic (paginated, §37). */
  units: LandingUnitsSection
  /** Exams whose current syllabus needs units under this topic's subtree. */
  exams: ExamsSection<LandingExamCard>
  /** §33 internal links — sibling topics under the same parent. */
  relatedTopics: LandingRelatedTopic[]
  /** Subtree counters (units under the whole subtree, visible topics, exams). */
  stats: { unitCount: number; topicCount: number; examCount: number }
}
