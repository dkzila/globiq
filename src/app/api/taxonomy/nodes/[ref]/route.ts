/**
 * GET /api/taxonomy/nodes/{ref} — public topic detail by slug (or id).
 * Hidden statuses / out-of-scope countries return 404 (§14 server-side
 * scoping — the client never learns about unavailable nodes).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicTopic, toTaxonomyErrorResponse } from '@/modules/taxonomy'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const limit = checkRateLimit(`taxonomy:read:${clientIp(request)}`, RATE_LIMITS.taxonomyRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { ref } = await params
  const url = new URL(request.url)
  const country = url.searchParams.get('country') ?? undefined
  const language = url.searchParams.get('language') ?? undefined

  try {
    const topic = await getPublicTopic(ref, { country, language })
    return ok(topic)
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/node] unexpected error:', error)
    return fail('Could not load the topic', 'INTERNAL_ERROR', 500)
  }
}
