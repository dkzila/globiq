/**
 * GlobIQ — Exams & Syllabus module: SyllabusNode tree service (P3-S2)
 * Master Plan §6 (SyllabusNode row: exam_version_id, parent_id, topic_id,
 * depth, priority, notes), §11 (step 3 anchor — the tree ExamMapping expands
 * into canonical KnowledgeUnits once P3-S3 lands), §13 (exams reach the
 * taxonomy/knowledge exclusively through SyllabusNode → topicId links; exam
 * wording never enters the canonical taxonomy), §14/§15 (a tree rides its
 * exam's owning country — scope enforced server-side on every query), §16
 * (syllabus-topic paths …/exams/{exam}/syllabus/{topic}/, shipped as data),
 * §36 (version-pinned trees: staging until the version enters history, then
 * FROZEN — a syllabus change creates a new ExamVersion), §37 (explicit typed
 * errors, deterministic ordering), §38 (editorial console + public app),
 * §43 (P3-S2 scope), §45 (structurally rich seed trees).
 *
 * Editability model (§36): a tree is `staged` while the exam is DRAFT
 * (private provisioning) or the version is future-dated; it becomes `frozen`
 * the moment a non-DRAFT exam's version window starts, and `locked` when the
 * exam retires. Corrections never edit a frozen tree — they create a new
 * ExamVersion, exactly like the version windows themselves.
 */
import type { SyllabusNode, Topic } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditRequestMeta,
} from '@/modules/audit'
import {
  buildCanonicalUrl,
} from '@/modules/country-locale'

import { ExamError } from './service'
import {
  assertCanManageExam,
  currentVersionOf,
  findExam,
  resolvePublicContext,
  toVersionRef,
  windowContains,
  type ExamRow,
  type VersionWithCount,
} from './service'
import type {
  AdminSyllabusNode,
  AdminVersionTree,
  PublicExamSyllabus,
  PublicSyllabusNode,
  SyllabusEditability,
} from './types'
import type {
  CreateSyllabusNodeInput,
  ImportSyllabusOutlineInput,
  PublicSyllabusQuery,
  UpdateSyllabusNodeInput,
} from './validation'

// ---------- §36 editability ----------

interface EditabilityDecision {
  editability: SyllabusEditability
  reason: string
}

/**
 * When may this tree change? Staging exists only BEFORE the version enters
 * history: a DRAFT exam is private provisioning (nothing publicly consumed),
 * and a future-dated version has not started. Once a non-DRAFT exam's version
 * window starts, the tree is §36 history — corrections go into a new version.
 */
export function treeEditability(
  exam: { status: string },
  version: { effectiveFrom: Date }
): EditabilityDecision {
  if (exam.status === 'RETIRED') {
    return { editability: 'locked', reason: 'Retired exams are read-only (§36).' }
  }
  if (exam.status === 'DRAFT') {
    return {
      editability: 'staged',
      reason: 'DRAFT exam — private provisioning; the tree stays editable until the exam activates.',
    }
  }
  if (version.effectiveFrom.getTime() > Date.now()) {
    return {
      editability: 'staged',
      reason: 'Future-dated version — the tree is staging until its window starts.',
    }
  }
  return {
    editability: 'frozen',
    reason: 'This version is in effect — its tree is §36 history. Syllabus changes create a new version.',
  }
}

function assertTreeEditable(
  exam: { status: string },
  version: { effectiveFrom: Date; label: string }
): void {
  const decision = treeEditability(exam, version)
  if (decision.editability === 'locked') {
    throw new ExamError('STATE_LOCKED', decision.reason)
  }
  if (decision.editability === 'frozen') {
    throw new ExamError('VERSION_FROZEN', decision.reason)
  }
}

// ---------- Tree assembly ----------

type NodeRow = SyllabusNode & {
  topic: Pick<Topic, 'id' | 'slug' | 'canonicalName' | 'countryId' | 'scope'> | null
}

const NODE_ORDER = [{ priority: 'asc' } as const, { id: 'asc' } as const]

async function loadVersionNodes(versionId: string): Promise<NodeRow[]> {
  return db.syllabusNode.findMany({
    where: { examVersionId: versionId },
    include: { topic: { select: { id: true, slug: true, canonicalName: true, countryId: true, scope: true } } },
    orderBy: NODE_ORDER,
  })
}

function toAdminNode(row: NodeRow, childrenOf: Map<string | null, NodeRow[]>): AdminSyllabusNode {
  const children = childrenOf.get(row.id) ?? []
  return {
    id: row.id,
    parentId: row.parentId,
    name: row.name,
    topicId: row.topicId,
    topic: row.topic ? { slug: row.topic.slug, canonicalName: row.topic.canonicalName } : null,
    depth: row.depth,
    priority: row.priority,
    notes: row.notes,
    childCount: children.length,
    children: children.map((child) => toAdminNode(child, childrenOf)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Groups rows by parent once, then nests deterministically (§37). */
function groupByParent(rows: NodeRow[]): Map<string | null, NodeRow[]> {
  const childrenOf = new Map<string | null, NodeRow[]>()
  for (const row of rows) {
    const key = row.parentId
    const bucket = childrenOf.get(key)
    if (bucket) bucket.push(row)
    else childrenOf.set(key, [row])
  }
  return childrenOf
}

/** Builds the admin tree for a version (no permission checks — internal). */
export async function buildAdminVersionTree(exam: ExamRow, version: VersionWithCount): Promise<AdminVersionTree> {
  const [rows, country] = await Promise.all([
    loadVersionNodes(version.id),
    db.country.findUnique({ where: { id: exam.countryId }, select: { isoCode: true, name: true } }),
  ])
  const childrenOf = groupByParent(rows)
  const decision = treeEditability(exam, version)
  return {
    exam: {
      id: exam.id,
      slug: exam.slug,
      name: exam.name,
      code: exam.code,
      status: exam.status as AdminVersionTree['exam']['status'],
      countryIso: country?.isoCode ?? '??',
      countryName: country?.name ?? 'Unknown country',
    },
    version: toVersionRef(version),
    editability: decision.editability,
    editabilityReason: decision.reason,
    nodeCount: rows.length,
    tree: (childrenOf.get(null) ?? []).map((row) => toAdminNode(row, childrenOf)),
  }
}

/** Refetches the exam + version after a mutation, then rebuilds the tree. */
async function refreshTree(examId: string, versionId: string): Promise<AdminVersionTree> {
  const fresh = await findExam(examId)
  if (!fresh) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  const version = fresh.versions.find((row) => row.id === versionId)
  if (!version) throw new ExamError('VERSION_NOT_FOUND', 'Exam version not found on this exam')
  return buildAdminVersionTree(fresh, version)
}

// ---------- Guarded loads for writes ----------

/**
 * Exam + version + §36 editability in one guarded step: scope check on the
 * exam (§14/§20 — audited denial), version membership, tree mutability.
 */
async function loadEditableTree(
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
  assertTreeEditable(exam, version)
  return { exam, version }
}

/**
 * Resolves a topicId against §13/§14: the topic must exist and be usable by
 * this exam's country — GLOBAL topics fit every exam; a COUNTRY-scoped topic
 * fits only its owning country's exams (a UK exam cannot bind an Indian
 * taxonomy extension, and vice versa).
 */
async function resolveTopicLink(
  topicId: string,
  examCountryId: string,
  examCountryName: string
): Promise<Topic> {
  const topic = await db.topic.findUnique({ where: { id: topicId } })
  if (!topic) throw new ExamError('TOPIC_NOT_FOUND', 'Topic not found')
  if (topic.scope === 'COUNTRY' && topic.countryId !== examCountryId) {
    throw new ExamError(
      'TOPIC_COUNTRY_MISMATCH',
      `Topic "${topic.canonicalName}" belongs to another country's taxonomy — a ${examCountryName} exam can link GLOBAL topics or its own country's topics only (§13/§14)`
    )
  }
  return topic
}

function nodeSnapshot(row: SyllabusNode) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    topicId: row.topicId,
    depth: row.depth,
    priority: row.priority,
    notes: row.notes,
  }
}

// ---------- Public read (§38; §14/§15 scope rides the exam) ----------

/**
 * The syllabus a reader sees today: the CURRENT version's tree by default
 * (§11 step 2's resolution), or an explicitly requested version that has
 * STARTED (§36 old versions stay queryable — future/staged versions are not
 * public). ACTIVE exams of ACTIVE countries only.
 */
export async function getPublicExamSyllabus(
  ref: string,
  query: PublicSyllabusQuery
): Promise<PublicExamSyllabus> {
  const exam = await findExam(ref)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')

  const { countryRow, country, languageCode } = await resolvePublicContext(query)
  // §14: a syllabus is visible only inside its exam's owning country context.
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
        'This syllabus version has not taken effect yet — staged trees are not public (§36)'
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
    // No version in effect — the clean "not published yet" state.
    return {
      exam: { id: exam.id, slug: exam.slug, name: exam.name, code: exam.code, level: exam.level },
      version: null,
      editability: 'frozen',
      nodeCount: 0,
      nodes: [],
      language,
    }
  }

  const rows = await loadVersionNodes(version.id)

  // §35: resolve topic labels in the requested language (fallback: the
  // country's default language label, then the canonical name).
  const topicIds = [...new Set(rows.map((row) => row.topicId).filter((id): id is string => id != null))]
  const labelByTopicId = new Map<string, string>()
  const labelLanguageByTopicId = new Map<string, string>()
  if (topicIds.length > 0) {
    const labels = await db.topicLabel.findMany({
      where: {
        topicId: { in: topicIds },
        language: { code: { in: [languageCode, country.defaultLanguage.code] } },
      },
      select: { topicId: true, name: true, language: { select: { code: true } } },
    })
    for (const label of labels) {
      if (label.language.code === languageCode || !labelByTopicId.has(label.topicId)) {
        labelByTopicId.set(label.topicId, label.name)
        labelLanguageByTopicId.set(label.topicId, label.language.code)
      }
    }
  }

  const childrenOf = groupByParent(rows)
  const toPublicNode = (row: NodeRow): PublicSyllabusNode => {
    const topic = row.topic
    let topicInfo: PublicSyllabusNode['topic'] = null
    if (topic) {
      topicInfo = {
        slug: topic.slug,
        canonicalName: topic.canonicalName,
        label: labelByTopicId.get(topic.id) ?? topic.canonicalName,
        labelLanguage: labelLanguageByTopicId.get(topic.id) ?? 'canonical',
      }
    }
    return {
      name: row.name,
      depth: row.depth,
      priority: row.priority,
      notes: row.notes,
      topic: topicInfo,
      // §16 syllabus-topic path, shipped as data (routes land in P4-S3/S4).
      canonicalPath: topic
        ? buildCanonicalUrl(
            { slug: country.slug, isDefault: country.isDefault },
            { code: languageCode },
            country.defaultLanguage.code,
            ['exams', exam.slug, 'syllabus', topic.slug]
          )
        : null,
      children: (childrenOf.get(row.id) ?? []).map(toPublicNode),
    }
  }

  return {
    exam: { id: exam.id, slug: exam.slug, name: exam.name, code: exam.code, level: exam.level },
    version: {
      id: version.id,
      label: version.label,
      effectiveFrom: version.effectiveFrom.toISOString(),
      effectiveTo: version.effectiveTo?.toISOString() ?? null,
      isCurrent: windowContains(version),
    },
    editability: treeEditability(exam, version).editability,
    nodeCount: rows.length,
    nodes: (childrenOf.get(null) ?? []).map(toPublicNode),
    language,
  }
}

// ---------- Admin read (§38 console — any version, incl. staged) ----------

export async function getAdminVersionTree(
  actor: Actor,
  examId: string,
  versionId: string
): Promise<AdminVersionTree> {
  assertCan(actor, 'exam:manage')
  const exam = await findExam(examId)
  if (!exam) throw new ExamError('EXAM_NOT_FOUND', 'Exam not found')
  assertCanManageExam(actor, exam, 'syllabus.read')
  const version = exam.versions.find((row) => row.id === versionId)
  if (!version) throw new ExamError('VERSION_NOT_FOUND', 'Exam version not found on this exam')
  return buildAdminVersionTree(exam, version)
}

// ---------- Admin writes: node CRUD (§36 staged trees only) ----------

export async function createSyllabusNode(
  actor: Actor,
  examId: string,
  versionId: string,
  input: CreateSyllabusNodeInput,
  meta: AuditRequestMeta = {}
): Promise<AdminVersionTree> {
  const { exam, version } = await loadEditableTree(actor, examId, versionId, 'syllabus.node.create', meta)

  // Parent must live in the SAME version (a tree never spans versions).
  let parent: SyllabusNode | null = null
  if (input.parentId) {
    parent = await db.syllabusNode.findFirst({
      where: { id: input.parentId, examVersionId: version.id },
    })
    if (!parent) {
      throw new ExamError('PARENT_INVALID', 'Parent node not found in this exam version')
    }
  }

  let topicId: string | null = null
  if (input.topicId) {
    const examCountry = await db.country.findUnique({
      where: { id: exam.countryId },
      select: { id: true, name: true },
    })
    const topic = await resolveTopicLink(input.topicId, exam.countryId, examCountry?.name ?? 'this country')
    topicId = topic.id
  }

  // Append after the current last sibling (priority keeps §6 sibling order).
  const lastSibling = await db.syllabusNode.findFirst({
    where: { examVersionId: version.id, parentId: parent?.id ?? null },
    orderBy: [{ priority: 'desc' }, { id: 'desc' }],
    select: { priority: true },
  })
  const priority = input.priority ?? (lastSibling ? lastSibling.priority + 1 : 0)

  const created = await db.syllabusNode.create({
    data: {
      examVersionId: version.id,
      parentId: parent?.id ?? null,
      name: input.name,
      topicId,
      depth: parent ? parent.depth + 1 : 0,
      priority,
      notes: input.notes ?? null,
    },
  })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.syllabusNodeCreate,
    objectType: AUDIT_OBJECT_TYPES.syllabusNode,
    objectId: created.id,
    objectLabel: `${exam.slug} · ${version.label} · ${created.name}`,
    before: null,
    after: nodeSnapshot(created),
    metadata: { examSlug: exam.slug, versionId: version.id, versionLabel: version.label },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return refreshTree(exam.id, version.id)
}

export async function updateSyllabusNode(
  actor: Actor,
  examId: string,
  versionId: string,
  nodeId: string,
  input: UpdateSyllabusNodeInput,
  meta: AuditRequestMeta = {}
): Promise<AdminVersionTree> {
  const { exam, version } = await loadEditableTree(actor, examId, versionId, 'syllabus.node.update', meta)

  const node = await db.syllabusNode.findFirst({
    where: { id: nodeId, examVersionId: version.id },
  })
  if (!node) throw new ExamError('NODE_NOT_FOUND', 'Syllabus node not found in this exam version')

  // --- Move (parentId change): same-version parent + no subtree cycles ---
  let moving = false
  let newDepth = node.depth
  if (input.parentId !== undefined) {
    if (input.parentId === node.id) {
      throw new ExamError('PARENT_INVALID', 'A node cannot be its own parent')
    }
    if (input.parentId !== null) {
      const parent = await db.syllabusNode.findFirst({
        where: { id: input.parentId, examVersionId: version.id },
      })
      if (!parent) {
        throw new ExamError('PARENT_INVALID', 'Parent node not found in this exam version')
      }
      // Moving under a descendant would create a cycle — walk the parent's
      // ancestor chain within this version's node map.
      const versionNodes = await db.syllabusNode.findMany({
        where: { examVersionId: version.id },
        select: { id: true, parentId: true },
      })
      const byId = new Map(versionNodes.map((row) => [row.id, row]))
      let cursor: string | null = parent.parentId
      while (cursor) {
        if (cursor === node.id) {
          throw new ExamError(
            'INVALID_MOVE',
            'Cannot move a node under its own descendant — that would create a cycle'
          )
        }
        cursor = byId.get(cursor)?.parentId ?? null
      }
      newDepth = parent.depth + 1
    } else {
      newDepth = 0
    }
    moving = newDepth !== node.depth || (input.parentId ?? null) !== node.parentId
  }

  // --- Topic link (undefined = keep; null = unlink; id = link) ---
  let topicId: string | null | undefined
  if (input.topicId !== undefined && input.topicId !== null) {
    const examCountry = await db.country.findUnique({
      where: { id: exam.countryId },
      select: { name: true },
    })
    const topic = await resolveTopicLink(input.topicId, exam.countryId, examCountry?.name ?? 'this country')
    topicId = topic.id
  } else {
    topicId = input.topicId // null (unlink) or undefined (keep)
  }

  const updated = await db.syllabusNode.update({
    where: { id: node.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
      ...(topicId !== undefined ? { topicId } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(moving ? { depth: newDepth } : {}),
    },
  })

  // A move re-homes the subtree — shift descendant depths by the same delta.
  if (moving && newDepth !== node.depth) {
    const delta = newDepth - node.depth
    const queue = [node.id]
    while (queue.length > 0) {
      const current = queue.shift()!
      const children = await db.syllabusNode.findMany({
        where: { parentId: current },
        select: { id: true, depth: true },
      })
      for (const child of children) {
        await db.syllabusNode.update({
          where: { id: child.id },
          data: { depth: child.depth + delta },
        })
        queue.push(child.id)
      }
    }
  }

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.syllabusNodeUpdate,
    objectType: AUDIT_OBJECT_TYPES.syllabusNode,
    objectId: node.id,
    objectLabel: `${exam.slug} · ${version.label} · ${updated.name}`,
    before: nodeSnapshot(node),
    after: nodeSnapshot(updated),
    metadata: {
      examSlug: exam.slug,
      versionId: version.id,
      versionLabel: version.label,
      moved: moving,
      depthShift: moving ? newDepth - node.depth : 0,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return refreshTree(exam.id, version.id)
}

export async function removeSyllabusNode(
  actor: Actor,
  examId: string,
  versionId: string,
  nodeId: string,
  meta: AuditRequestMeta = {}
): Promise<AdminVersionTree> {
  const { exam, version } = await loadEditableTree(actor, examId, versionId, 'syllabus.node.remove', meta)

  const node = await db.syllabusNode.findFirst({
    where: { id: nodeId, examVersionId: version.id },
  })
  if (!node) throw new ExamError('NODE_NOT_FOUND', 'Syllabus node not found in this exam version')

  const childCount = await db.syllabusNode.count({ where: { parentId: node.id } })
  if (childCount > 0) {
    throw new ExamError(
      'NODE_HAS_CHILDREN',
      `This node has ${childCount} child node${childCount === 1 ? '' : 's'} — remove or move them first`
    )
  }
  // P3-S3 guard: a node carrying ExamMappings is referenced §8 requirement
  // data — deleting it would silently drop exam requirements. Mappings must
  // be removed explicitly first (each removal is audited).
  const mappingCount = await db.examMapping.count({ where: { syllabusNodeId: node.id } })
  if (mappingCount > 0) {
    throw new ExamError(
      'NODE_HAS_MAPPINGS',
      `This node carries ${mappingCount} exam mapping${mappingCount === 1 ? '' : 's'} — remove them first (mappings are explicit editorial data, never silently dropped)`
    )
  }

  await db.syllabusNode.delete({ where: { id: node.id } })

  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.syllabusNodeRemove,
    objectType: AUDIT_OBJECT_TYPES.syllabusNode,
    objectId: node.id,
    objectLabel: `${exam.slug} · ${version.label} · ${node.name}`,
    before: nodeSnapshot(node),
    after: null,
    metadata: { examSlug: exam.slug, versionId: version.id, versionLabel: version.label },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return refreshTree(exam.id, version.id)
}

// ---------- Admin writes: bulk outline import (staging path) ----------

const MAX_IMPORT_NODES = 2000

interface ParsedOutlineLine {
  name: string
  depth: number
  line: number
}

/**
 * Parses an indented outline into (name, depth) lines. Two spaces OR one tab
 * per level (never mixed); blank lines and `#` comments are skipped; an
 * indentation may only deepen by ONE level at a time. Lenient like the §23
 * parsers — but structural errors (mixed units, jumps) are explicit 400s.
 */
export function parseSyllabusOutline(outline: string): ParsedOutlineLine[] {
  const result: ParsedOutlineLine[] = []
  const lines = outline.split('\n')
  let prevDepth = -1
  let indentUnit: 'space' | 'tab' | null = null

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index]
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const leading = raw.match(/^[\t ]*/)?.[0] ?? ''
    if (leading.includes('\t') && leading.includes(' ')) {
      throw new ExamError(
        'OUTLINE_INVALID',
        `Line ${index + 1}: mixed tabs and spaces — use two spaces or one tab per level`
      )
    }
    let depth: number
    if (leading.includes('\t')) {
      depth = leading.length
      if (indentUnit === 'space') {
        throw new ExamError(
          'OUTLINE_INVALID',
          `Line ${index + 1}: tab indentation after space indentation — stick to one unit`
        )
      }
      indentUnit = 'tab'
    } else {
      if (leading.length % 2 !== 0) {
        throw new ExamError(
          'OUTLINE_INVALID',
          `Line ${index + 1}: odd space indentation — use two spaces per level`
        )
      }
      depth = leading.length / 2
      if (depth > 0 && indentUnit === 'tab') {
        throw new ExamError(
          'OUTLINE_INVALID',
          `Line ${index + 1}: space indentation after tab indentation — stick to one unit`
        )
      }
      if (depth > 0) indentUnit = 'space'
    }

    if (depth > prevDepth + 1) {
      throw new ExamError(
        'OUTLINE_INVALID',
        `Line ${index + 1}: indentation jumps from level ${Math.max(prevDepth, 0)} to ${depth} — deepen one level at a time`
      )
    }
    if (trimmed.length < 2) {
      throw new ExamError(
        'OUTLINE_INVALID',
        `Line ${index + 1}: node names must be at least 2 characters`
      )
    }

    prevDepth = depth
    result.push({ name: trimmed.slice(0, 200), depth, line: index + 1 })
  }

  if (result.length > MAX_IMPORT_NODES) {
    throw new ExamError('OUTLINE_INVALID', `Outline exceeds the ${MAX_IMPORT_NODES}-node limit`)
  }
  return result
}

/**
 * Replaces the version's ENTIRE staged tree from an indented outline in one
 * transaction — the primary way editorial teams enter a syllabus from the
 * official notification. An empty outline clears the staged tree. Frozen
 * versions never reach this point (loadEditableTree already refused them).
 */
export async function importSyllabusOutline(
  actor: Actor,
  examId: string,
  versionId: string,
  input: ImportSyllabusOutlineInput,
  meta: AuditRequestMeta = {}
): Promise<AdminVersionTree> {
  const { exam, version } = await loadEditableTree(actor, examId, versionId, 'syllabus.import', meta)

  // P3-S3 guard: replacing the tree would orphan every mapping pinned to its
  // nodes. An import over a mapping-bearing version must be preceded by an
  // explicit mapping cleanup (audited) — never a silent loss (§36 spirit).
  const existingMappings = await db.examMapping.count({ where: { examVersionId: version.id } })
  if (existingMappings > 0) {
    throw new ExamError(
      'VERSION_HAS_MAPPINGS',
      `This version carries ${existingMappings} exam mapping${existingMappings === 1 ? '' : 's'} — remove them before replacing the tree (imports never silently drop mappings)`
    )
  }

  const parsed = parseSyllabusOutline(input.outline ?? '')
  const previousCount = await db.syllabusNode.count({ where: { examVersionId: version.id } })

  await db.$transaction(async (tx) => {
    await tx.syllabusNode.deleteMany({ where: { examVersionId: version.id } })

    // Sequential creates: each child needs its parent's id (trees are small —
    // the 2000-node cap keeps this a short transaction).
    const lastIdAtDepth: string[] = []
    const nextSiblingIndexAtDepth: number[] = []
    for (const line of parsed) {
      const parentId = line.depth === 0 ? null : lastIdAtDepth[line.depth - 1]
      const priority = nextSiblingIndexAtDepth[line.depth] ?? 0
      const created = await tx.syllabusNode.create({
        data: {
          examVersionId: version.id,
          parentId: parentId ?? null,
          name: line.name,
          depth: line.depth,
          priority,
        },
      })
      lastIdAtDepth[line.depth] = created.id
      lastIdAtDepth.length = line.depth + 1
      // Next sibling at this depth takes the following index; deeper levels
      // reset (a shallower node starts a fresh sibling run).
      nextSiblingIndexAtDepth[line.depth] = priority + 1
      nextSiblingIndexAtDepth.length = line.depth + 1
    }
  })

  const newCount = parsed.length
  await recordAudit({
    actor: { userId: actor.userId, email: actor.email, role: actor.role },
    action: AUDIT_ACTIONS.syllabusImport,
    objectType: AUDIT_OBJECT_TYPES.syllabusNode,
    objectId: version.id,
    objectLabel: `${exam.slug} · ${version.label}`,
    before: { nodeCount: previousCount },
    after: { nodeCount: newCount },
    metadata: {
      examSlug: exam.slug,
      versionId: version.id,
      versionLabel: version.label,
      mode: 'replace',
      maxDepth: parsed.reduce((max, line) => Math.max(max, line.depth), 0),
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })

  return refreshTree(exam.id, version.id)
}
