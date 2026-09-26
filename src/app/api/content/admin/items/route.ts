/**
 * GET  /api/content/admin/items?unit=&status=&language=&format=&q= — admin
 *   list across all lifecycle statuses. ADMIN: everything. COUNTRY_ADMIN:
 *   global (read-only) + own-country content (Master Plan §38).
 * POST /api/content/admin/items — create a representation (enters DRAFT).
 *   Identity is one unit × one language × one format (§7); the language must
 *   be configured for the unit's country (§35, server-side).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminContentListQuerySchema,
  createContentItem,
  createContentItemSchema,
  getAdminContentItems,
  toContentErrorResponse,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminContentListQuerySchema.safeParse({
    unit: url.searchParams.get('unit') ?? undefined,
    status: url.searchParams.get('status') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    format: url.searchParams.get('format') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminContentItems(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/list] unexpected error:', error)
    return fail('Could not load content items', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
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

  const parsed = createContentItemSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const item = await createContentItem(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item }, { status: 201 })
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/create] unexpected error:', error)
    return fail('Could not create the content item', 'INTERNAL_ERROR', 500)
  }
}
