/**
 * GET /api/content/items?unit={slug|id}&country=&language= — public list of
 * the PUBLISHED representations of one knowledge unit (Master Plan §7: one
 * canonical record, many renderings; §22 knowledge-page layers; §35: only
 * languages the country configures; §14/§15 scope enforced server-side).
 * Content is ALWAYS served from the live revision — never the working copy.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getPublicContentItems,
  publicContentListQuerySchema,
  toContentErrorResponse,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`content:read:${clientIp(request)}`, RATE_LIMITS.contentRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = publicContentListQuerySchema.safeParse({
    unit: url.searchParams.get('unit') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getPublicContentItems(parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/public/list] unexpected error:', error)
    return fail('Could not load content', 'INTERNAL_ERROR', 500)
  }
}
