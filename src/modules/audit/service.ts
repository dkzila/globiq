/**
 * GlobIQ — Audit: domain service
 * Master Plan §6 (AuditLog model: actor/action/object/timestamp/before/after),
 * §19 (every privileged transition audited), §30 (audit logging for privileged
 * operations, data minimisation), §36 (taxonomy changes audited), §37
 * (service-boundary authorisation, pagination, deterministic sorting), §38.
 *
 * Write path: `recordAudit` is best-effort and NEVER throws — a failed audit
 * insert must not break a completed user operation. Events are recorded after
 * the mutation commits (documented trade-off: a crash between commit and
 * record loses the event; revisit with transactional outbox if required).
 *
 * Read path: `listAuditLogs` enforces `audit:read` (ADMIN in P1) at the
 * service boundary and returns deterministic, paginated, filterable history.
 */
import type { Prisma } from '@prisma/client'

import { db } from '@/lib/db'
import { assertCan, type Actor } from '@/lib/permissions'

import type {
  AuditEventInput,
  AuditListResult,
  PublicAuditLog,
} from './types'
import type { AuditListQuery } from './validation'

// ---------- Redaction (§30 data minimisation) ----------

const SENSITIVE_KEY_PATTERN = /password|passphrase|token|secret|authorization|credential/i
const REDACTED = '[redacted]'
const MAX_STRING_LENGTH = 500

/** Deep-clones and redacts a value so it is safe to persist as audit JSON. */
function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null
  if (depth > 8) return '[truncated]'
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? value.slice(0, MAX_STRING_LENGTH) + '…' : value
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) {
    return value.length > 100 ? [...value.slice(0, 100).map((v) => redact(v, depth + 1)), '[truncated]'] : value.map((v) => redact(v, depth + 1))
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, depth + 1)
    }
    return out
  }
  return String(value)
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === null || value === undefined) return undefined
  return redact(value) as Prisma.InputJsonValue
}

// ---------- Write path ----------

/** Records one audit event. Best-effort: logs and swallows all errors. */
export async function recordAudit(event: AuditEventInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId: event.actor?.userId ?? null,
        actorEmail: event.actor?.email ?? null,
        actorRole: event.actor?.role ?? null,
        action: event.action,
        objectType: event.objectType,
        objectId: event.objectId ?? null,
        objectLabel: event.objectLabel ?? null,
        before: toPrismaJson(event.before),
        after: toPrismaJson(event.after),
        metadata: toPrismaJson(event.metadata ?? null),
        ip: event.ip ?? null,
        userAgent: event.userAgent ? event.userAgent.slice(0, 200) : null,
      },
    })
  } catch (error) {
    console.error(`[audit] failed to record "${event.action}" (${event.objectType}):`, error)
  }
}

// ---------- Read path ----------

function toPublicAuditLog(row: {
  id: string
  actorId: string | null
  actorEmail: string | null
  actorRole: string | null
  action: string
  objectType: string
  objectId: string | null
  objectLabel: string | null
  before: Prisma.JsonValue | null
  after: Prisma.JsonValue | null
  metadata: Prisma.JsonValue | null
  ip: string | null
  createdAt: Date
}): PublicAuditLog {
  return {
    id: row.id,
    action: row.action,
    actor: { id: row.actorId, email: row.actorEmail, role: row.actorRole },
    objectType: row.objectType,
    objectId: row.objectId,
    objectLabel: row.objectLabel,
    before: row.before,
    after: row.after,
    metadata: row.metadata,
    ip: row.ip,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * Lists the audit trail with filters + pagination + a filter-coherent summary.
 * ADMIN-only (`audit:read`) — the analyst read-only role arrives with the
 * editorial module (P2-S4).
 */
export async function listAuditLogs(actor: Actor, query: AuditListQuery): Promise<AuditListResult> {
  assertCan(actor, 'audit:read')

  const where: Prisma.AuditLogWhereInput = {
    ...(query.action ? { action: query.action } : {}),
    ...(query.actor ? { actorEmail: { contains: query.actor, mode: 'insensitive' } } : {}),
    ...(query.objectType ? { objectType: query.objectType } : {}),
    ...(query.objectId ? { objectId: query.objectId } : {}),
    ...(query.from || query.to
      ? {
          createdAt: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  }

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [rows, total, last24h, topActions, actionFacets, objectTypeFacets] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], // deterministic (§37)
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    db.auditLog.count({ where }),
    db.auditLog.count({ where: { ...where, createdAt: { gte: since24h } } }),
    db.auditLog.groupBy({
      by: ['action'],
      where,
      _count: { action: true },
      orderBy: { _count: { action: 'desc' } },
      take: 6,
    }),
    db.auditLog.groupBy({ by: ['action'], _count: { action: true }, orderBy: { action: 'asc' } }),
    db.auditLog.groupBy({
      by: ['objectType'],
      _count: { objectType: true },
      orderBy: { objectType: 'asc' },
    }),
  ])

  return {
    items: rows.map(toPublicAuditLog),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    },
    summary: {
      total,
      last24h,
      topActions: topActions.map((entry) => ({ action: entry.action, count: entry._count.action })),
    },
    facets: {
      actions: actionFacets.map((entry) => entry.action),
      objectTypes: objectTypeFacets.map((entry) => entry.objectType),
    },
  }
}
