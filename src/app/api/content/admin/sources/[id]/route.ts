/**
 * GET   /api/content/admin/sources/{id} — evidence record detail + where it is
 *   cited (usage scope-filtered per actor, §20).
 * PATCH /api/content/admin/sources/{id} — metadata corrections (title,
 *   publisher, URL, type, dates, notes). Every edit is audited; the record is
 *   never deleted (§36 — unreliable evidence is marked, not removed).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminSource,
  toSourceErrorResponse,
  updateSource,
  updateSourceSchema,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'source:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const source = await getAdminSource(auth.actor, id)
    return ok({ source })
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[sources/admin/detail] unexpected error:', error)
    return fail('Could not load the source', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'source:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`source:write:${clientIp(request)}`, RATE_LIMITS.sourceWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateSourceSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const source = await updateSource(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ source })
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[sources/admin/update] unexpected error:', error)
    return fail('Could not update the source', 'INTERNAL_ERROR', 500)
  }
}
