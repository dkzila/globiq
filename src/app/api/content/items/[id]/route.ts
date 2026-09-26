/**
 * GET /api/content/items/{id}?country= — public content detail. Serves the
 * LIVE revision snapshot only (Master Plan §19: published content is
 * immutable at the revision level; §36: corrections are new revisions).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicContentItem, toContentErrorResponse } from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limit = checkRateLimit(`content:read:${clientIp(request)}`, RATE_LIMITS.contentRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const { id } = await params
  try {
    const item = await getPublicContentItem(id, {
      country: url.searchParams.get('country') ?? undefined,
    })
    return ok({ item })
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/public/detail] unexpected error:', error)
    return fail('Could not load the content item', 'INTERNAL_ERROR', 500)
  }
}
