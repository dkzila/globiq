/**
 * GET /api/audit — the accountability trail (Master Plan §6 AuditLog, §19,
 * §30, §38). ADMIN-only in P1 (`audit:read`; the analyst read-only role
 * arrives with the editorial module). Filters: action, actor (email
 * substring), objectType, objectId, from/to; paginated with deterministic
 * ordering (§37). Summary + facets reflect the active filter / full trail.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { auditListQuerySchema, listAuditLogs } from '@/modules/audit'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'audit:read')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`audit:read:${clientIp(request)}`, RATE_LIMITS.auditRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = auditListQuerySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
    action: url.searchParams.get('action') ?? undefined,
    actor: url.searchParams.get('actor') ?? undefined,
    objectType: url.searchParams.get('objectType') ?? undefined,
    objectId: url.searchParams.get('objectId') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid audit query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await listAuditLogs(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    console.error('[audit/list] unexpected error:', error)
    return fail('Could not load the audit trail', 'INTERNAL_ERROR', 500)
  }
}
