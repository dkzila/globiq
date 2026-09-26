/**
 * GET /api/knowledge/units/{ref} — public detail by slug or id (Master Plan
 * §7, §14/§15 country scoping, §22: quick fact + deeper explanation + topic
 * path). Only VERIFIED units under a publicly visible topic are served.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicKnowledgeUnit, toKnowledgeErrorResponse } from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const limit = checkRateLimit(`knowledge:read:${clientIp(request)}`, RATE_LIMITS.knowledgeRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { ref } = await params
  const url = new URL(request.url)

  try {
    const unit = await getPublicKnowledgeUnit(ref, {
      country: url.searchParams.get('country') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
    })
    return ok({ unit })
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/public/detail] unexpected error:', error)
    return fail('Could not load the knowledge unit', 'INTERNAL_ERROR', 500)
  }
}
