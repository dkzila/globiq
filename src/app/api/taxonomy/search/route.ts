/**
 * GET /api/taxonomy/search — public topic search
 * (Master Plan §13: nodes findable via canonical name, slug, language labels
 * and aliases). Query: ?q=…&country=&language=&limit=
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { searchTopics, toTaxonomyErrorResponse, topicSearchQuerySchema } from '@/modules/taxonomy'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`taxonomy:read:${clientIp(request)}`, RATE_LIMITS.taxonomyRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = topicSearchQuerySchema.safeParse({
    q: url.searchParams.get('q') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', { fields: parsed.error.flatten().fieldErrors })
  }

  try {
    const results = await searchTopics(parsed.data)
    return ok({ query: parsed.data.q, count: results.length, results })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/search] unexpected error:', error)
    return fail('Search failed', 'INTERNAL_ERROR', 500)
  }
}
