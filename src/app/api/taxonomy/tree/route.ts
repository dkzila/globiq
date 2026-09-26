/**
 * GET /api/taxonomy/tree — public taxonomy tree for a locale context
 * (Master Plan §13: one global framework with country-specific extensions).
 * Query: ?country=IN|in|india-slug & ?language=en — both optional (defaults to
 * the root market). Only ACTIVE, country-visible nodes with an ACTIVE ancestor
 * chain are returned (§14 server-side scoping).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicTree, toTaxonomyErrorResponse, topicTreeQuerySchema } from '@/modules/taxonomy'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`taxonomy:read:${clientIp(request)}`, RATE_LIMITS.taxonomyRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = topicTreeQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', { fields: parsed.error.flatten().fieldErrors })
  }

  try {
    const tree = await getPublicTree(parsed.data)
    return ok({
      country: parsed.data.country ?? null,
      language: parsed.data.language ?? null,
      rootCount: tree.length,
      tree,
    })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/tree] unexpected error:', error)
    return fail('Could not load the taxonomy tree', 'INTERNAL_ERROR', 500)
  }
}
