/**
 * GET /api/knowledge/units — public, VERIFIED-only knowledge units under one
 * visible topic (Master Plan §5 hierarchy, §7 canonical record, §14/§15
 * server-side country scoping, §22 knowledge-page contract, §37 pagination).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getPublicKnowledgeUnits,
  publicKnowledgeListQuerySchema,
  toKnowledgeErrorResponse,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`knowledge:read:${clientIp(request)}`, RATE_LIMITS.knowledgeRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = publicKnowledgeListQuerySchema.safeParse({
    topic: url.searchParams.get('topic') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    difficulty: url.searchParams.get('difficulty') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getPublicKnowledgeUnits(parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/public/list] unexpected error:', error)
    return fail('Could not load knowledge units', 'INTERNAL_ERROR', 500)
  }
}
