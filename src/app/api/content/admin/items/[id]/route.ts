/**
 * GET   /api/content/admin/items/{id} — admin item detail: working copy, live
 *   revision, revision count and server-computed affordances (§20/§37).
 * PATCH /api/content/admin/items/{id} — edit the WORKING COPY (title/body).
 *   For PUBLISHED items these edits are staged: public reads keep serving the
 *   live revision until publishing appends a new one (§19/§36). RETIRED items
 *   are read-only (§36).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminContentItem,
  toContentErrorResponse,
  updateContentItem,
  updateContentItemSchema,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const item = await getAdminContentItem(auth.actor, id)
    return ok({ item })
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/detail] unexpected error:', error)
    return fail('Could not load the content item', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`content:write:${clientIp(request)}`, RATE_LIMITS.contentWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateContentItemSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const item = await updateContentItem(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/update] unexpected error:', error)
    return fail('Could not update the content item', 'INTERNAL_ERROR', 500)
  }
}
