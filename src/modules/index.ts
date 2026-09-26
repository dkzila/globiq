/**
 * GlobIQ — Modular Monolith Module Registry
 * Master Plan §28 (Recommended Technical Boundary): 18 logical modules with
 * explicit interfaces and clear ownership, starting in one deployable app.
 *
 * This registry is the architecture contract: every module lists the phase and
 * session(s) that will implement it. Modules receive code under
 * `src/modules/<key>/` in their scheduled session — never early (§41/§48).
 */

export type ModuleStatus = 'planned' | 'in_progress' | 'delivered'

export interface ModuleDescriptor {
  key: string
  name: string
  description: string
  /** Master Plan phase that implements this module. */
  phase: string
  /** Session(s) from the §43 roadmap. */
  session: string
  status: ModuleStatus
}

export const MODULES: ModuleDescriptor[] = [
  { key: 'identity-access', name: 'Identity & Access', description: 'Token-based authentication, users, roles, sessions', phase: 'P1', session: 'P1-S2', status: 'delivered' },
  { key: 'country-locale', name: 'Country & Locale', description: 'Country/language configuration, routing context, server-side scoping', phase: 'P1', session: 'P1-S3', status: 'in_progress' },
  { key: 'taxonomy', name: 'Taxonomy', description: 'Canonical topic taxonomy with country extensions', phase: 'P1', session: 'P1-S4', status: 'planned' },
  { key: 'audit', name: 'Audit', description: 'Audit logging for privileged operations', phase: 'P1', session: 'P1-S5', status: 'planned' },
  { key: 'knowledge', name: 'Knowledge', description: 'KnowledgeUnit canonical model, ContentItems, Source provenance', phase: 'P2', session: 'P2-S1…S3', status: 'planned' },
  { key: 'editorial', name: 'Editorial', description: 'Editorial workspace, workflow, scoped roles', phase: 'P2', session: 'P2-S4…S5', status: 'planned' },
  { key: 'exams-syllabus', name: 'Exams & Syllabus', description: 'Country-specific exams, versioned syllabus trees', phase: 'P3', session: 'P3-S1…S2', status: 'planned' },
  { key: 'exam-mapping', name: 'Exam Mapping', description: 'Knowledge↔exam mappings, multi-exam union & deduplication engine', phase: 'P3', session: 'P3-S3…S5', status: 'planned' },
  { key: 'search', name: 'Search', description: 'Country/exam-aware search abstraction and indexing', phase: 'P4', session: 'P4-S1', status: 'planned' },
  { key: 'seo', name: 'SEO', description: 'Canonical URLs, hreflang, sitemaps, structured data', phase: 'P4', session: 'P4-S2…S5', status: 'planned' },
  { key: 'follow-save', name: 'Follow & Save', description: 'UserFollow signals vs SavedItem collections (separate concepts)', phase: 'P5', session: 'P5-S1…S2', status: 'planned' },
  { key: 'personalisation', name: 'Personalisation', description: 'Goals, explainable recommendations, dashboard, reset controls', phase: 'P5', session: 'P5-S3…S5', status: 'planned' },
  { key: 'current-affairs', name: 'Current Affairs', description: 'Event-centric current affairs, sources, freshness lifecycle', phase: 'P6', session: 'P6-S1…S5', status: 'planned' },
  { key: 'assessment', name: 'Questions & Assessment', description: 'QnA, Questions, MockTests, TestAttempts, mastery, revision', phase: 'P7', session: 'P7-S1…S5', status: 'planned' },
  { key: 'sharing', name: 'Sharing', description: 'Stable share URLs, OG metadata, Web Share API', phase: 'P8', session: 'P8-S1', status: 'planned' },
  { key: 'notifications', name: 'Notifications', description: 'Channel-agnostic engine with per-category preferences', phase: 'P8', session: 'P8-S2', status: 'planned' },
  { key: 'content-quality', name: 'Content Feedback / Quality', description: 'User error reports routed into the editorial quality loop', phase: 'P8', session: 'P8-S3', status: 'planned' },
  { key: 'analytics', name: 'Analytics', description: 'Relevance & learning metrics, editorial analytics', phase: 'P8', session: 'P8-S4…S5', status: 'planned' },
]
