/**
 * GlobIQ — Audit module: public DTOs
 * Master Plan §6 (AuditLog), §19, §30, §36, §37 (client-agnostic shapes).
 */

/** Actor reference embedded in an audit event (all fields optional: system
 * events and anonymous attempts have no user row). */
export interface AuditActorRef {
  userId: string | null
  email: string | null
  role: string | null
}

/** What service-layer mutations pass to `recordAudit`. */
export interface AuditEventInput {
  actor?: AuditActorRef | null
  action: string
  objectType: string
  objectId?: string | null
  objectLabel?: string | null
  /** State prior to the mutation (auto-redacted before write). */
  before?: unknown
  /** State after the mutation (auto-redacted before write). */
  after?: unknown
  metadata?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
}

/** Request context services thread into audit calls (§30). */
export interface AuditRequestMeta {
  ip?: string | null
  userAgent?: string | null
}

/** Serialised audit row — before/after/metadata are already redacted at write. */
export interface PublicAuditLog {
  id: string
  action: string
  actor: { id: string | null; email: string | null; role: string | null }
  objectType: string
  objectId: string | null
  objectLabel: string | null
  before: unknown
  after: unknown
  metadata: unknown
  ip: string | null
  createdAt: string
}

export interface AuditPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface AuditListResult {
  items: PublicAuditLog[]
  pagination: AuditPagination
  /** Reflects the active filter (coherent with `items`). */
  summary: { total: number; last24h: number; topActions: Array<{ action: string; count: number }> }
  /** Distinct values across the whole trail — powers UI filter dropdowns. */
  facets: { actions: string[]; objectTypes: string[] }
}

/** Namespaced action vocabulary (shared by emitting services and the UI). */
export const AUDIT_ACTIONS = {
  userRegister: 'user.register',
  userLogin: 'auth.login',
  userLoginFailed: 'auth.login.failed',
  userLogout: 'auth.logout',
  sessionRevoke: 'auth.session.revoke',
  countryCreate: 'country.create',
  countryUpdate: 'country.update',
  countryLanguagesSet: 'country.languages.set',
  languageCreate: 'language.create',
  languageUpdate: 'language.update',
  topicCreate: 'taxonomy.topic.create',
  topicUpdate: 'taxonomy.topic.update',
  topicRetire: 'taxonomy.topic.retire',
  topicLabelsSet: 'taxonomy.topic.labels.set',
  topicAliasesSet: 'taxonomy.topic.aliases.set',
  knowledgeUnitCreate: 'knowledge.unit.create',
  knowledgeUnitUpdate: 'knowledge.unit.update',
  knowledgeUnitTransition: 'knowledge.unit.transition',
  contentItemCreate: 'content.item.create',
  contentItemUpdate: 'content.item.update',
  contentItemTransition: 'content.item.transition',
  sourceCreate: 'source.create',
  sourceUpdate: 'source.update',
  sourceVerify: 'source.verification.transition',
  /** Object-level source-registry denials (role/scope mismatch — §20 signal). */
  sourceDenied: 'source.denied',
  /** §24 provenance join events on content objects. */
  sourceLinkCreate: 'content.item.source.link',
  sourceLinkUpdate: 'content.item.source.update',
  sourceLinkRemove: 'content.item.source.unlink',
  /** Object-level source-link denials (item country/scope mismatch — §20 signal). */
  sourceLinkDenied: 'content.item.source.denied',
  /** Route permission-gate denials (requirePermission). */
  accessDenied: 'access.denied',
  /** Object-level taxonomy denials (country/scope mismatch — §20 signal). */
  taxonomyDenied: 'taxonomy.topic.denied',
  /** Object-level knowledge denials (country/scope/state mismatch — §20 signal). */
  knowledgeDenied: 'knowledge.unit.denied',
  /** Object-level content denials (country/scope/state mismatch — §20 signal). */
  contentDenied: 'content.item.denied',
  /** P2-S4 editorial workspace (§19 — every task mutation is audited). */
  editorialTaskCreate: 'editorial.task.create',
  editorialTaskUpdate: 'editorial.task.update',
  editorialTaskTransition: 'editorial.task.transition',
  /** Object-level editorial denials (scope/assignment mismatch — §20 signal). */
  editorialTaskDenied: 'editorial.task.denied',
  /** P3-S1 exams (§6/§36 — every exam/version mutation is audited). */
  examCreate: 'exam.create',
  examUpdate: 'exam.update',
  examTransition: 'exam.transition',
  examVersionCreate: 'exam.version.create',
  examVersionUpdate: 'exam.version.update',
  examVersionRemove: 'exam.version.remove',
  /** Object-level exam denials (country/scope mismatch — §20 signal). */
  examDenied: 'exam.denied',
  /** P3-S2 syllabus trees (§6/§36 — every node/import mutation is audited). */
  syllabusNodeCreate: 'syllabus.node.create',
  syllabusNodeUpdate: 'syllabus.node.update',
  syllabusNodeRemove: 'syllabus.node.remove',
  syllabusImport: 'syllabus.import',
  /** Object-level syllabus denials (country/scope mismatch — §20 signal). */
  syllabusDenied: 'syllabus.denied',
} as const

/** Object type vocabulary (§6 entities that exist so far). */
export const AUDIT_OBJECT_TYPES = {
  user: 'User',
  authSession: 'AuthSession',
  country: 'Country',
  language: 'Language',
  topic: 'Topic',
  knowledgeUnit: 'KnowledgeUnit',
  contentItem: 'ContentItem',
  contentRevision: 'ContentRevision',
  editorialTask: 'EditorialTask',
  source: 'Source',
  contentSourceLink: 'ContentSourceLink',
  exam: 'Exam',
  examVersion: 'ExamVersion',
  syllabusNode: 'SyllabusNode',
  permission: 'Permission',
} as const
