/**
 * GlobIQ — Exam Mapping module: domain service (P3-S3)
 * Master Plan §6 (ExamMapping row: knowledge_unit_id, exam_version_id,
 * syllabus_node_id, relevance, priority, required_depth, expected_scope,
 * question_likelihood, source_basis, effective_period, notes), §8 (the
 * requirement layer — the SAME canonical unit maps to many exams at different
 * depths; never copied content), §11 (step 3: "Expand each ExamVersion's
 * SyllabusNode tree into its mapped canonical KnowledgeUnits via ExamMapping"
 * — the P3-S4 union engine consumes these rows), §12 (step 5: current-affairs
 * knowledge flows "into a followed exam's combined queue the moment it's
 * mapped"), §13 (exams reach knowledge exclusively through
 * SyllabusNode → ExamMapping), §14/§15 (a mapping rides its exam's owning
 * country; the unit must be GLOBAL or that country's — enforced server-side),
 * §16 (knowledge-page paths …/gk/{topic}/{slug}/ shipped as data), §18/§20
 * (mapping operations are exam:manage = ADMIN + COUNTRY_ADMIN own-country;
 * the Exam Specialist role is future), §35 (topic labels on public coverage
 * nodes resolved requested → country default → canonical), §36 (version-pinned
 * mappings; superseded versions' mappings are history), §37 (service-boundary
 * authorization, deterministic ordering, explicit typed errors), §38
 * (editorial console + public app), §45/Appendix A (seed: one unit, many
 * depths across exams).
 *
 * §36 EDITABILITY (mappingEditability) — deliberately DIFFERENT from the
 * P3-S2 tree rule, and why: the tree freezes the moment its version starts,
 * but §12 requires mappings to keep flowing on the CURRENT version (events
 * occur mid-window; a frozen mapping surface would make current-affairs
 * mapping impossible and leave live exams unmappable). Therefore mappings are
 * editable while `staged` (DRAFT exam / future version) AND while `live`
 * (the current version in effect); they become history (`frozen`) only when
 * the version is superseded, and `locked` when the exam retires. Every edit
 * is audited either way.
 *
 * Module boundary (§28): this module imports exams-syllabus's public helpers
 * (findExam, assertCanManageExam, resolvePublicContext, windowContains) —
 * never the reverse. Mapping-specific guards on node deletion / outline
 * import / version removal live in exams-syllabus and count this table.
 */
import type { ExamMapping, SyllabusNode, Topic } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import { buildCanonicalUrl } from '@/modules/country-locale'
import { onMappingsChanged } from '@/modules/search'
import {
  ExamError,
  assertCanManageExam,
  findExam,
  resolvePublicContext,
  toExamErrorResponse,
  toVersionRef,
  windowContains,
  type ExamRow,
  type VersionWithCount,
} from '@/modules/exams-syllabus'

import type {
  AdminMapping,
  AdminMappingNode,
  AdminVersionMappings,
  MappingEditability,
  MappingUnitOption,
  PublicCoverageMapping,
  PublicCoverageNode,
  PublicExamCoverage,
  UnitMappingContext,
} from './types'
import type {
  CreateExamMappingInput,
  MappingUnitSearchQuery,
  PublicCoverageQuery,
  UpdateExamMappingInput,
} from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type MappingErrorCode =
  | 'MAPPING_NOT_FOUND'
  | 'UNIT_NOT_FOUND'
  | 'UNIT_COUNTRY_MISMATCH'
  | 'UNIT_ARCHIVED'
  | 'MAPPING_DUPLICATE'
  | 'MAPPING_WINDOW_INVALID'

const ERROR_STATUS: Record<MappingErrorCode, number> = {
  MAPPING_NOT_FOUND: 404,
  UNIT_NOT_FOUND: 404,
  UNIT_COUNTRY_MISMATCH: 400,
  UNIT_ARCHIVED: 400,
  MAPPING_DUPLICATE: 409,
  MAPPING_WINDOW_INVALID: 400,
}

export class MappingError extends Error {
  readonly code: MappingErrorCode
  readonly status: number

  constructor(code: MappingErrorCode, message: string) {
    super(message)
    this.name = 'MappingError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

/**
 * Maps MappingError AND the shared exam-domain ExamError (anchors/guards
 * throw those) to envelope data (§37) — one mapper per route.
 */
export function toMappingErrorResponse(
  error: unknown
): { message: string; code: string; status: number } | null {
  if (error instanceof MappingError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return toExamErrorResponse(error)
}

// ---------- §36 mapping editability ----------

interface EditabilityDecision {
  editability: MappingEditability
  reason: string
}

/** See the file header — mappings stay writable on the CURRENT version. */
export function mappingEditability(
  exam: { status: string },
  version: { effectiveFrom: Date; effectiveTo: Date | null }
): EditabilityDecision {
  if (exam.status === 'RETIRED') {
    return { editability: 'locked', reason: 'Retired exams are read-only (§36).' }
  }
  if (exam.status === 'DRAFT') {
    return {
      editability: 'staged',
      reason: 'DRAFT exam — private provisioning; mappings stay editable until the exam activates.',
    }
  }
  if (version.effectiveFrom.getTime() > Date.now()) {
    return {
      editability: 'staged',
      reason: 'Future-dated version — mappings are staging until its window starts.',
    }
  }
  if (windowContains(version)) {
    return {
      editability: 'live',
      reason:
        'This version is in effect — its syllabus tree is frozen (§36), but mappings keep flowing: current-affairs knowledge attaches to live syllabi the moment it is mapped (§12).',
    }
  }
  return {
    editability: 'frozen',
    reason:
      'This version has been superseded — its mappings are §36 history and stay read-only (old mappings remain historically queryable).',
  }
}

function assertMappingsEditable(exam: { status: string }, version: { effectiveFrom: Date; effectiveTo: Date | null }): void {
  const decision = mappingEditability(exam, version)
  if (decision.editability === 'locked') {
    throw new ExamError('STATE_LOCKED', decision.reason)
  }
  if (decision.editability === 'frozen') {
    throw new ExamError('VERSION_FROZEN', decision.reason)
  }
}

// ---------- Row loading ----------

const CUID_PATTERN = /^c[a-z0-9]{20,}$/

/** Mapping row with the canonical unit context (shared with the §11 engine). */
export type MappingRow = ExamMapping & {
  knowledgeUnit: {
    id: string
    slug: string
    canonicalName: string
    canonicalSummary: string | null
    type: string
    difficulty: string
    status: string
    scope: string
    countryId: string | null
    topic: { slug: string }
  }
}

const MAPPING_INCLUDE = {
  knowledgeUnit: {
    select: {
      id: true,
      slug: true,
      canonicalName: true,
      canonicalSummary: true,
      type: true,
      difficulty: true,
      status: true,
      scope: true,
      countryId: true,
      topic: { select: { slug: true } },
    },
  },
} as const

/** Syllabus node row with its §13 topic link (shared with the §11 engine). */
export type NodeRow = SyllabusNode & {
  topic: Pick<Topic, 'id' | 'slug' | 'canonicalName' | 'countryId' | 'scope'> | null
}

const NODE_ORDER = [{ priority: 'asc' } as const, { id: 'asc' } as const]

/** Shared with the §11 combination engine (sibling file in this module). */
export async function loadVersionNodes(versionId: string): Promise<NodeRow[]> {
  return db.syllabusNode.findMany({
    where: { examVersionId: versionId },
    include: { topic: { select: { id: true, slug: true, canonicalName: true, countryId: true, scope: true } } },
    orderBy: NODE_ORDER,
  })
}

/** Shared with the §11 combination engine (sibling file in this module). */
export async function loadVersionMappings(versionId: string): Promise<MappingRow[]> {
  return db.examMapping.findMany({
    where: { examVersionId: versionId },
    include: MAPPING_INCLUDE,
    orderBy: [{ knowledgeUnit: { canonicalName: 'asc' } }, { id: 'asc' }], // deterministic (§37)
  })
}

// ---------- Assembly (admin console) ----------

function toAdminMapping(row: MappingRow): AdminMapping {
  return {
    id: row.id,
    unit: {
      id: row.knowledgeUnit.id,
      slug: row.knowledgeUnit.slug,
      canonicalName: row.knowledgeUnit.canonicalName,
      canonicalSummary: row.knowledgeUnit.canonicalSummary,
      type: row.knowledgeUnit.type,
      difficulty: row.knowledgeUnit.difficulty,
      status: row.knowledgeUnit.status,
      topicSlug: row.knowledgeUnit.topic.slug,
    },
    relevance: row.relevance,
    priority: row.priority,
    requiredDepth: row.requiredDepth,
    questionLikelihood: row.questionLikelihood,
    expectedScope: row.expectedScope,
    sourceBasis: row.sourceBasis,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toAdminMappingNode(
  row: NodeRow,
  childrenOf: Map<string | null, NodeRow[]>,
  mappingsByNode: Map<string, MappingRow[]>
): AdminMappingNode {
  const mappings = mappingsByNode.get(row.id) ?? []
  return {
    id: row.id,
    name: row.name,
    depth: row.depth,
    priority: row.priority,
    topic: row.topic ? { slug: row.topic.slug, canonicalName: row.topic.canonicalName } : null,
    mappingCount: mappings.length,
    mappings: mappings.map(toAdminMapping),
    children: (childrenOf.get(row.id) ?? []).map((child) =>
      toAdminMappingNode(child, childrenOf, mappingsByNode)
    ),
  }
}

/** Builds the console read for a version (no permission checks — internal). */
async function buildVersionMappings(exam: ExamRow, version: VersionWithCount): Promise<AdminVersionMappings> {
  const [nodes, mappings, country] = await Promise.all([
    loadVersionNodes(version.id),
    loadVersionMappings(version.id),
    db.country.findUnique({ where: { id: exam.countryId }, select: { isoCode: true, name: true } }),
  ])

  const childrenOf = new Map<string | null, NodeRow[]>()
  for (const node of nodes) {
    const bucket = childrenOf.get(node.parentId)
    if (bucket) bucket.push(node)
    else childrenOf.set(node.parentId, [node])
  }
  const mappingsByNode = new Map<string, MappingRow[]>()
  for (const mapping of mappings) {
    const bucket = mappingsByNode.get(mapping.syllabusNodeId)
    if (bucket) bucket.push(mapping)
    else mappingsByNode.set(mapping.syllabusNodeId, [mapping])
  }

  const decision = mappingEditability(exam, version)
  const versionRef = toVersionRef(version)
  return {
    exam: {
      id: exam.id,
      slug: exam.slug,
      name: exam.name,
      code: exam.code,
      status: exam.status,
      countryIso: country?.isoCode ?? '??',
      countryName: country?.name ?? 'Unknown country',
    },
    version: {
      id: versionRef.id,
      label: versionRef.label,
      effectiveFrom: versionRef.effectiveFrom,
      effectiveTo: versionRef.effectiveTo,
      isCurrent: versionRef.isCurrent,
      isUpcoming: versionRef.isUpcoming,
      nodeCount: versionRef.nodeCount,
      mappingCount: versionRef.mappingCount,
    },
    editability: decision.editability,
    editabilityReason: decision.reason,
    mappingCount: mappings.length,
    nodeCount: nodes.length,
    tree: (childrenOf.get(null) ?? []).map((row) =>
      toAdminMappingNode(row, childrenOf, mappingsByNode)
    ),
  }
}

/** Refetches exam + version after a mutation, then rebuilds the mapping view. */
async function refreshMappings(examId: string, versionId: string): Promise<AdminVersionMappings> {
  const fresh = await findExam(examId)
  if (!fresh) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  const version = fresh.versions.find((row) => row.id === versionId)
  if (!version) throw new ExamError('VERSION_NOT_FOUND', 'Exam version not found on this exam')
  return buildVersionMappings(fresh, version)
}

// ---------- Guarded loads for writes ----------

/**
 * Exam + version in one guarded step: scope check on the exam (§14/§20 —
 * audited denial), version membership. Editability is applied per operation
 * (reads never check it; writes call assertMappingsEditable).
 */
async function loadMappingContext(
  actor: Actor,
  examId: string,
  versionId: string,
  operation: string,
  meta?: AuditRequestMeta
): Promise<{ exam: ExamRow; version: VersionWithCount }> {
  const exam = await findExam(examId)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, operation, meta)
  const version = exam.versions.find((row) => row.id === versionId)
  if (!version) throw new ExamError('VERSION_NOT_FOUND', 'Exam version not found on this exam')
  return { exam, version }
}

// ---------- Admin reads (§38 console) ----------

export async function getAdminVersionMappings(
  actor: Actor,
  examId: string,
  versionId: string
): Promise<AdminVersionMappings> {
  assertCan(actor, 'exam:manage')
  const { exam, version } = await loadMappingContext(actor, examId, versionId, 'mapping.read')
  return buildVersionMappings(exam, version)
}

/** Country-visible units for the mapping picker (§14: GLOBAL or the exam's
 * country) with cross-exam mapping context — the Appendix A workflow aid. */
export async function searchUnitsForMapping(
  actor: Actor,
  examId: string,
  query: MappingUnitSearchQuery
): Promise<{ units: MappingUnitOption[] }> {
  const exam = await findExam(examId)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'mapping.search')

  const units = await db.knowledgeUnit.findMany({
    where: {
      status: { not: 'ARCHIVED' }, // archived units are end-of-life (§36) — nothing new maps to them
      OR: [{ scope: 'GLOBAL' }, { scope: 'COUNTRY', countryId: exam.countryId }],
      canonicalName: { contains: query.q, mode: 'insensitive' },
    },
    select: {
      id: true,
      slug: true,
      canonicalName: true,
      canonicalSummary: true,
      type: true,
      difficulty: true,
      status: true,
      topic: { select: { slug: true, canonicalName: true } },
    },
    orderBy: [{ canonicalName: 'asc' }, { id: 'asc' }], // deterministic (§37)
    take: 10,
  })

  // Where are these units already mapped? Same country's exams only (§14) —
  // this is the editor's dedup/depth context, never cross-country data.
  const unitIds = units.map((unit) => unit.id)
  const existing =
    unitIds.length > 0
      ? await db.examMapping.findMany({
          where: {
            knowledgeUnitId: { in: unitIds },
            syllabusNode: { examVersion: { exam: { countryId: exam.countryId } } },
          },
          include: {
            syllabusNode: {
              select: {
                id: true,
                name: true,
                examVersion: {
                  select: {
                    id: true,
                    label: true,
                    effectiveFrom: true,
                    effectiveTo: true,
                    exam: { select: { slug: true, name: true, code: true } },
                  },
                },
              },
            },
          },
          orderBy: [{ syllabusNode: { examVersion: { exam: { name: 'asc' } } } }, { id: 'asc' }],
        })
      : []

  const contextByUnit = new Map<string, UnitMappingContext[]>()
  for (const mapping of existing) {
    const node = mapping.syllabusNode
    const context: UnitMappingContext = {
      examSlug: node.examVersion.exam.slug,
      examName: node.examVersion.exam.name,
      examCode: node.examVersion.exam.code,
      versionId: node.examVersion.id,
      versionLabel: node.examVersion.label,
      versionIsCurrent: windowContains(node.examVersion),
      nodeId: node.id,
      nodeName: node.name,
      requiredDepth: mapping.requiredDepth,
    }
    const bucket = contextByUnit.get(mapping.knowledgeUnitId)
    if (bucket) bucket.push(context)
    else contextByUnit.set(mapping.knowledgeUnitId, [context])
  }

  return {
    units: units.map((unit) => ({
      id: unit.id,
      slug: unit.slug,
      canonicalName: unit.canonicalName,
      canonicalSummary: unit.canonicalSummary,
      type: unit.type,
      difficulty: unit.difficulty,
      status: unit.status,
      topic: unit.topic,
      mappedOn: contextByUnit.get(unit.id) ?? [],
    })),
  }
}

// ---------- Admin writes (§36 staged/live only) ----------

function mappingSnapshot(row: ExamMapping) {
  return {
    id: row.id,
    knowledgeUnitId: row.knowledgeUnitId,
    examVersionId: row.examVersionId,
    syllabusNodeId: row.syllabusNodeId,
    relevance: row.relevance,
    priority: row.priority,
    requiredDepth: row.requiredDepth,
    questionLikelihood: row.questionLikelihood,
    expectedScope: row.expectedScope,
    sourceBasis: row.sourceBasis,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
    notes: row.notes,
  }
}

/** Resolves the §7 canonical record and enforces §14 scope (server-side). */
async function resolveMappableUnit(unitRef: string, examCountryId: string, examCountryName: string) {
  const unit = await db.knowledgeUnit.findFirst({
    where: CUID_PATTERN.test(unitRef) ? { id: unitRef } : { slug: unitRef.toLowerCase() },
    include: { topic: { select: { slug: true } } },
  })
  if (!unit) throw new MappingError('UNIT_NOT_FOUND', 'Knowledge unit not found')
  if (unit.status === 'ARCHIVED') {
    throw new MappingError('UNIT_ARCHIVED', `"${unit.canonicalName}" is archived (§36) — map a live unit instead`)
  }
  if (unit.scope === 'COUNTRY' && unit.countryId !== examCountryId) {
    throw new MappingError(
      'UNIT_COUNTRY_MISMATCH',
      `"${unit.canonicalName}" belongs to another country's knowledge — a ${examCountryName} exam can map GLOBAL units or its own country's only (§14)`
    )
  }
  return unit
}

export async function createExamMapping(
  actor: Actor,
  examId: string,
  versionId: string,
  input: CreateExamMappingInput,
  meta: AuditRequestMeta = {}
): Promise<AdminVersionMappings> {
  const { exam, version } = await loadMappingContext(actor, examId, versionId, 'mapping.create', meta)
  assertMappingsEditable(exam, version)

  // §6/§13 anchor: the node must belong to THIS version (a mapping never
  // spans versions; examVersionId is derived from the node, never trusted
  // from the client).
  const node = await db.syllabusNode.findFirst({
    where: { id: input.nodeId, examVersionId: version.id },
  })
  if (!node) {
    throw new ExamError('NODE_NOT_FOUND', 'Syllabus node not found in this exam version')
  }

  const examCountry = await db.country.findUnique({
    where: { id: exam.countryId },
    select: { name: true },
  })
  const unit = await resolveMappableUnit(input.unitRef, exam.countryId, examCountry?.name ?? 'this country')

  // One mapping per unit per node (§6 natural key).
  const duplicate = await db.examMapping.findUnique({
    where: { knowledgeUnitId_syllabusNodeId: { knowledgeUnitId: unit.id, syllabusNodeId: node.id } },
    select: { id: true },
  })
  if (duplicate) {
    throw new MappingError(
      'MAPPING_DUPLICATE',
      `"${unit.canonicalName}" is already mapped to "${node.name}" — edit the existing mapping instead`
    )
  }

  const created = await db.examMapping.create({
    data: {
      knowledgeUnitId: unit.id,
      examVersionId: version.id,
      syllabusNodeId: node.id,
      relevance: input.relevance,
      priority: input.priority,
      requiredDepth: input.requiredDepth,
      questionLikelihood: input.questionLikelihood,
      expectedScope: input.expectedScope ?? null,
      sourceBasis: input.sourceBasis ?? null,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveTo: input.effectiveTo ?? null,
      notes: input.notes ?? null,
      createdById: actor.userId,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examMappingCreate,
    objectType: AUDIT_OBJECT_TYPES.examMapping,
    objectId: created.id,
    objectLabel: `${exam.slug} · ${version.label} · ${node.name} · ${unit.canonicalName} (${input.requiredDepth})`,
    before: null,
    after: mappingSnapshot(created),
    metadata: {
      examSlug: exam.slug,
      versionId: version.id,
      versionLabel: version.label,
      unitSlug: unit.slug,
      nodeName: node.name,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17: a new §8 requirement re-projects the unit's examRefs (boost +
  // "In the current … syllabus" explanation).
  await onMappingsChanged([unit.slug])

  return refreshMappings(exam.id, version.id)
}

export async function updateExamMapping(
  actor: Actor,
  examId: string,
  versionId: string,
  mappingId: string,
  input: UpdateExamMappingInput,
  meta: AuditRequestMeta = {}
): Promise<AdminVersionMappings> {
  const { exam, version } = await loadMappingContext(actor, examId, versionId, 'mapping.update', meta)
  assertMappingsEditable(exam, version)

  const existing = await db.examMapping.findFirst({
    where: { id: mappingId, examVersionId: version.id },
    include: MAPPING_INCLUDE,
  })
  if (!existing) throw new MappingError('MAPPING_NOT_FOUND', 'Exam mapping not found on this version')

  const updated = await db.examMapping.update({
    where: { id: existing.id },
    data: {
      ...(input.relevance !== undefined ? { relevance: input.relevance } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.requiredDepth !== undefined ? { requiredDepth: input.requiredDepth } : {}),
      ...(input.questionLikelihood !== undefined ? { questionLikelihood: input.questionLikelihood } : {}),
      ...(input.expectedScope !== undefined ? { expectedScope: input.expectedScope } : {}),
      ...(input.sourceBasis !== undefined ? { sourceBasis: input.sourceBasis } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.effectiveFrom !== undefined ? { effectiveFrom: input.effectiveFrom } : {}),
      ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo } : {}),
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examMappingUpdate,
    objectType: AUDIT_OBJECT_TYPES.examMapping,
    objectId: existing.id,
    objectLabel: `${exam.slug} · ${version.label} · ${existing.knowledgeUnit.canonicalName}`,
    before: mappingSnapshot(existing),
    after: mappingSnapshot(updated),
    metadata: {
      examSlug: exam.slug,
      versionId: version.id,
      versionLabel: version.label,
      unitSlug: existing.knowledgeUnit.slug,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17: an edited effective period/depth can change today's
  // requirements — the unit's examRefs are re-projected.
  await onMappingsChanged([existing.knowledgeUnit.slug])

  return refreshMappings(exam.id, version.id)
}

export async function removeExamMapping(
  actor: Actor,
  examId: string,
  versionId: string,
  mappingId: string,
  meta: AuditRequestMeta = {}
): Promise<AdminVersionMappings> {
  const { exam, version } = await loadMappingContext(actor, examId, versionId, 'mapping.remove', meta)
  assertMappingsEditable(exam, version)

  const existing = await db.examMapping.findFirst({
    where: { id: mappingId, examVersionId: version.id },
    include: MAPPING_INCLUDE,
  })
  if (!existing) throw new MappingError('MAPPING_NOT_FOUND', 'Exam mapping not found on this version')

  await db.examMapping.delete({ where: { id: existing.id } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.examMappingRemove,
    objectType: AUDIT_OBJECT_TYPES.examMapping,
    objectId: existing.id,
    objectLabel: `${exam.slug} · ${version.label} · ${existing.knowledgeUnit.canonicalName}`,
    before: mappingSnapshot(existing),
    after: null,
    metadata: {
      examSlug: exam.slug,
      versionId: version.id,
      versionLabel: version.label,
      unitSlug: existing.knowledgeUnit.slug,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  // P4-S1 §17: a removed requirement may drop the unit from today's syllabi.
  await onMappingsChanged([existing.knowledgeUnit.slug])

  return refreshMappings(exam.id, version.id)
}

// ---------- Public coverage read (§38; the P3-S4 engine's data contract) ----------

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * §8 effective_period, day-granular inclusive semantics (mirrors version
 * windows): null bounds = unbounded. `historical` mode keeps expired mappings
 * (§36 "old mappings remain historically queryable") and only hides
 * not-yet-valid ones. Shared with the §11 combination engine (the engine
 * always reads CURRENT versions, so it passes historical=false).
 */
export function mappingInEffect(
  mapping: { effectiveFrom: Date | null; effectiveTo: Date | null },
  historical: boolean,
  now = Date.now()
): boolean {
  if (mapping.effectiveFrom && mapping.effectiveFrom.getTime() > now) return false
  if (historical) return true
  if (mapping.effectiveTo == null) return true
  return now < mapping.effectiveTo.getTime() + DAY_MS
}

/**
 * §35 topic labels resolved requested-language → country-default → canonical
 * (the canonical fallback is applied by the caller). Shared with the §11
 * combination engine (covering nodes carry the same label resolution).
 */
export async function resolveTopicLabels(
  topicIds: string[],
  languageCode: string,
  defaultLanguageCode: string
): Promise<Map<string, { label: string; language: string }>> {
  const resolved = new Map<string, { label: string; language: string }>()
  if (topicIds.length === 0) return resolved
  const labels = await db.topicLabel.findMany({
    where: {
      topicId: { in: topicIds },
      language: { code: { in: [languageCode, defaultLanguageCode] } },
    },
    select: { topicId: true, name: true, language: { select: { code: true } } },
  })
  for (const label of labels) {
    if (label.language.code === languageCode || !resolved.has(label.topicId)) {
      resolved.set(label.topicId, { label: label.name, language: label.language.code })
    }
  }
  return resolved
}

/**
 * The knowledge an exam needs today: the current version's mappings expanded
 * into VERIFIED, country-visible units grouped by syllabus node (§11 step 3's
 * public shape). `?version=` reads a STARTED version's coverage historically
 * (§36) — future/staged versions are never public.
 */
export async function getPublicExamCoverage(
  ref: string,
  query: PublicCoverageQuery
): Promise<PublicExamCoverage> {
  const exam = await findExam(ref)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')

  const { countryRow, country, languageCode } = await resolvePublicContext(query)
  // §14: coverage is visible only inside the exam's owning country context.
  if (exam.countryId !== countryRow.id || exam.status !== 'ACTIVE') {
    throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  }

  // Resolve the target version (current by default, explicit started one otherwise).
  let version: VersionWithCount | null = null
  if (query.version) {
    version = exam.versions.find((row) => row.id === query.version) ?? null
    if (!version) throw new ExamError('VERSION_NOT_FOUND', 'Exam version not found on this exam')
    if (version.effectiveFrom.getTime() > Date.now()) {
      throw new ExamError(
        'VERSION_NOT_STARTED',
        'This version has not taken effect yet — staged coverage is not public (§36)'
      )
    }
  } else {
    version = exam.versions.find((row) => windowContains(row)) ?? null
  }

  const language = {
    code: languageCode,
    name:
      country.defaultLanguage.code === languageCode
        ? country.defaultLanguage.name
        : country.languages.find((l) => l.code === languageCode)?.name ?? languageCode,
    nativeName: country.languages.find((l) => l.code === languageCode)?.nativeName ?? null,
  }

  if (!version) {
    // No version in effect — the clean "not published yet" state. Mappings
    // are always version-pinned, so nothing can exist yet (staged by nature).
    return {
      exam: { id: exam.id, slug: exam.slug, name: exam.name, code: exam.code, level: exam.level },
      version: null,
      editability: 'staged',
      unitCount: 0,
      mappingCount: 0,
      nodes: [],
      language,
    }
  }

  const historical = !windowContains(version)
  const [nodes, mappings] = await Promise.all([
    loadVersionNodes(version.id),
    loadVersionMappings(version.id),
  ])

  // Public reality (§38 + §14): VERIFIED units only, country-visible, and
  // currently in effect (historical reads keep expired mappings).
  const visible = mappings.filter(
    (mapping) =>
      mapping.knowledgeUnit.status === 'VERIFIED' &&
      (mapping.knowledgeUnit.scope === 'GLOBAL' || mapping.knowledgeUnit.countryId === countryRow.id) &&
      mappingInEffect(mapping, historical)
  )

  // §35 topic labels for the coverage nodes (requested → country default → canonical).
  const topicIds = [...new Set(nodes.map((node) => node.topicId).filter((id): id is string => id != null))]
  const labels = await resolveTopicLabels(topicIds, languageCode, country.defaultLanguage.code)
  const labelByTopicId = new Map<string, string>()
  const labelLanguageByTopicId = new Map<string, string>()
  for (const [topicId, resolved] of labels) {
    labelByTopicId.set(topicId, resolved.label)
    labelLanguageByTopicId.set(topicId, resolved.language)
  }

  const mappingsByNode = new Map<string, MappingRow[]>()
  const mappedUnitIds = new Set<string>()
  for (const mapping of visible) {
    const bucket = mappingsByNode.get(mapping.syllabusNodeId)
    if (bucket) bucket.push(mapping)
    else mappingsByNode.set(mapping.syllabusNodeId, [mapping])
    mappedUnitIds.add(mapping.knowledgeUnitId)
  }

  // §16 knowledge-page path (…/gk/{topic}/{slug}/) — same construction as the
  // §22 render service, from country + language + unit identity.
  const toPublicMapping = (row: MappingRow): PublicCoverageMapping => ({
    unit: {
      slug: row.knowledgeUnit.slug,
      canonicalName: row.knowledgeUnit.canonicalName,
      canonicalSummary: row.knowledgeUnit.canonicalSummary,
      type: row.knowledgeUnit.type,
      difficulty: row.knowledgeUnit.difficulty,
    },
    canonicalPath: buildCanonicalUrl(
      { slug: country.slug, isDefault: country.isDefault },
      { code: languageCode },
      country.defaultLanguage.code,
      ['gk', row.knowledgeUnit.topic.slug, row.knowledgeUnit.slug]
    ),
    requiredDepth: row.requiredDepth,
    priority: row.priority,
    relevance: row.relevance,
    expectedScope: row.expectedScope,
    questionLikelihood: row.questionLikelihood,
    effectiveFrom: row.effectiveFrom?.toISOString() ?? null,
    effectiveTo: row.effectiveTo?.toISOString() ?? null,
  })

  // Prune to mapping-bearing branches: keep a node when it (or any descendant)
  // carries mappings — ancestors give the syllabus context, dead branches go.
  const childrenOf = new Map<string | null, NodeRow[]>()
  for (const node of nodes) {
    const bucket = childrenOf.get(node.parentId)
    if (bucket) bucket.push(node)
    else childrenOf.set(node.parentId, [node])
  }
  const toPublicNode = (row: NodeRow): PublicCoverageNode | null => {
    const children = (childrenOf.get(row.id) ?? [])
      .map(toPublicNode)
      .filter((child): child is PublicCoverageNode => child != null)
    const own = mappingsByNode.get(row.id) ?? []
    if (own.length === 0 && children.length === 0) return null
    return {
      name: row.name,
      depth: row.depth,
      priority: row.priority,
      topic: row.topic
        ? {
            slug: row.topic.slug,
            canonicalName: row.topic.canonicalName,
            label: labelByTopicId.get(row.topic.id) ?? row.topic.canonicalName,
            labelLanguage: labelLanguageByTopicId.get(row.topic.id) ?? 'canonical',
          }
        : null,
      mappings: own.map(toPublicMapping),
      children,
    }
  }

  const tree = (childrenOf.get(null) ?? [])
    .map(toPublicNode)
    .filter((node): node is PublicCoverageNode => node != null)

  return {
    exam: { id: exam.id, slug: exam.slug, name: exam.name, code: exam.code, level: exam.level },
    version: {
      id: version.id,
      label: version.label,
      effectiveFrom: version.effectiveFrom.toISOString(),
      effectiveTo: version.effectiveTo?.toISOString() ?? null,
      isCurrent: windowContains(version),
    },
    editability: mappingEditability(exam, version).editability,
    unitCount: mappedUnitIds.size,
    mappingCount: visible.length,
    nodes: tree,
    language,
  }
}
