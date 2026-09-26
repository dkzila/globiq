/**
 * GET /api/search — the §17 product surface (Master Plan §38 public app,
 * §14/§15 server-side country scope, §35 language resolution, §37 pagination
 * + explicit errors). Query: ?q=…&country=&language=&type=all|units|exams|
 * topics&exam=&page=&pageSize=. Every result carries its §16 canonical path
 * (in the reader's language) and §17 match explanations.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { publicSearch, searchQuerySchema, toSearchErrorResponse } from '@/modules/search'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`search:read:${clientIp(request)}`, RATE_LIMITS.searchRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = searchQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    exam: url.searchParams.get('exam') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid search parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await publicSearch(parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toSearchErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[search/public] unexpected error:', error)
    return fail('Search failed', 'SEARCH_FAILED', 500)
  }
}
