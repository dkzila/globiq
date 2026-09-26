/**
 * GET /api/content/admin/items/{id}/revisions — the full revision history of
 * one content item (Master Plan §36: "Published content revisions preserve
 * previous versions"). Every revision is an immutable snapshot with its
 * changeSummary provenance; the trail is editorial-facing (admin surface).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { listContentRevisions, toContentErrorResponse } from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`content:read:${clientIp(request)}`, RATE_LIMITS.contentRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params
  try {
    const result = await listContentRevisions(auth.actor, id)
    return ok(result)
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/revisions] unexpected error:', error)
    return fail('Could not load the revision history', 'INTERNAL_ERROR', 500)
  }
}
