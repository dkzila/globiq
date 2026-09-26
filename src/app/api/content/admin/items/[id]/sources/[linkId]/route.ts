/**
 * PATCH  /api/content/admin/items/{id}/sources/{linkId} — edit a citation's
 *   claim-level attribution (§24; null = content-level).
 * DELETE /api/content/admin/items/{id}/sources/{linkId} — detach evidence.
 *   The link is removed (audited); the Source record itself is preserved
 *   forever (§36 — evidence is never hard-deleted).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  toSourceErrorResponse,
  unlinkSourceFromItem,
  updateContentSourceClaim,
  updateSourceLinkSchema,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`source:write:${clientIp(request)}`, RATE_LIMITS.sourceWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateSourceLinkSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, linkId } = await params
  try {
    const link = await updateContentSourceClaim(auth.actor, id, linkId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ link })
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/sources/update-link] unexpected error:', error)
    return fail('Could not update the citation', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; linkId: string }> }
) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`source:write:${clientIp(request)}`, RATE_LIMITS.sourceWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id, linkId } = await params
  try {
    const result = await unlinkSourceFromItem(auth.actor, id, linkId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok(result)
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/sources/unlink] unexpected error:', error)
    return fail('Could not detach the source', 'INTERNAL_ERROR', 500)
  }
}
