/**
 * POST /api/search/admin/reindex — full index rebuild (§17 indexing pipeline,
 * §38 admin console). ADMIN only (search:manage — the index spans every
 * country's data); the operation is audited (§30). Idempotent: reprojects
 * every public object and removes documents of objects that left the public
 * surface (§36 — a full reindex leaves no stale rows).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit } from '@/modules/audit'
import { reindexAll, toSearchErrorResponse } from '@/modules/search'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'search:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`search:reindex:${clientIp(request)}`, RATE_LIMITS.searchWrite)
  if (!limit.allowed) {
    return fail('Too many rebuild attempts. Try again shortly.', 'RATE_LIMITED', 429, {
      retryAfterSec: limit.retryAfterSec,
    })
  }

  try {
    const result = await reindexAll()
    await recordAudit({
      actor: { userId: auth.actor.userId, email: auth.actor.email, role: auth.actor.role },
      action: AUDIT_ACTIONS.searchReindex,
      objectType: AUDIT_OBJECT_TYPES.searchDocument,
      objectId: null,
      objectLabel: 'full-rebuild',
      after: {
        unitsIndexed: result.unitsIndexed,
        topicsIndexed: result.topicsIndexed,
        examsIndexed: result.examsIndexed,
        documentsWritten: result.documentsWritten,
        documentsRemoved: result.documentsRemoved,
        tookMs: result.tookMs,
      },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    }).catch(() => undefined)
    return ok(result)
  } catch (error) {
    const mapped = toSearchErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[search/admin/reindex] unexpected error:', error)
    return fail('Reindex failed', 'INTERNAL_ERROR', 500)
  }
}
