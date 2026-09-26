/**
 * GET  /api/content/admin/sources?q=&type=&verification= — the §24 evidence
 *   registry: every Source record with usage counts and the verification
 *   summary. `source:manage` (ADMIN + COUNTRY_ADMIN — sources are
 *   platform-level shared evidence; usage is scope-filtered per actor, §20).
 * POST /api/content/admin/sources — register evidence (publisher, URL,
 *   publication/retrieved dates, category, notes). One canonical record per
 *   normalized URL (§11 dedup rule applied to evidence). New records start
 *   UNVERIFIED (§24 — verification is a separate editorial decision).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminSourceListQuerySchema,
  createSource,
  createSourceSchema,
  getAdminSources,
  toSourceErrorResponse,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'source:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminSourceListQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    verification: url.searchParams.get('verification') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid registry query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminSources(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[sources/admin/list] unexpected error:', error)
    return fail('Could not load the source registry', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
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

  const parsed = createSourceSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const source = await createSource(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ source }, { status: 201 })
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[sources/admin/create] unexpected error:', error)
    return fail('Could not register the source', 'INTERNAL_ERROR', 500)
  }
}
