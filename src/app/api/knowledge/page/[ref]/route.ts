/**
 * GET /api/knowledge/page/{ref} — the §22 knowledge page, assembled from the
 * canonical model (Master Plan §22: quick fact + deeper explanation + related
 * concepts + sources + exam coverage; §7: an assembly of one record's
 * representations; §16: canonical path; §35: country-configured languages
 * and actual published translations only). Public — no auth (§38).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getKnowledgePage, toKnowledgeErrorResponse } from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ ref: string }> }) {
  const limit = checkRateLimit(`knowledge:page:${clientIp(request)}`, RATE_LIMITS.knowledgeRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { ref } = await params
  const url = new URL(request.url)

  try {
    const page = await getKnowledgePage(ref, {
      country: url.searchParams.get('country') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
    })
    return ok({ page })
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/public/page] unexpected error:', error)
    return fail('Could not load the knowledge page', 'INTERNAL_ERROR', 500)
  }
}
