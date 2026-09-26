/**
 * GET  /api/knowledge/admin/units — admin list (all lifecycle statuses).
 *   ADMIN: everything. COUNTRY_ADMIN: global (read-only) + own-country units
 *   (Master Plan §38 scoped surfaces).
 * POST /api/knowledge/admin/units — create a unit (enters DRAFT). Dedup is by
 *   canonical identity: unique slug + one canonical name per topic (§11).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminKnowledgeListQuerySchema,
  createKnowledgeUnit,
  createKnowledgeUnitSchema,
  getAdminKnowledgeUnits,
  toKnowledgeErrorResponse,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'knowledge:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminKnowledgeListQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    topic: url.searchParams.get('topic') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminKnowledgeUnits(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/admin/list] unexpected error:', error)
    return fail('Could not load knowledge units', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'knowledge:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`knowledge:write:${clientIp(request)}`, RATE_LIMITS.knowledgeWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createKnowledgeUnitSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const unit = await createKnowledgeUnit(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ unit }, { status: 201 })
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/admin/create] unexpected error:', error)
    return fail('Could not create the knowledge unit', 'INTERNAL_ERROR', 500)
  }
}
