/**
 * GET /api/home — the §34 country homepage composition (Master Plan §33/§34,
 * §14/§15 server-side country scope — COMING_SOON markets resolve with their
 * launch state, §35 only the country's own languages, §16 canonical paths,
 * §36 lifecycle-aware reads, §37 client-agnostic payload, §38 public app).
 * Query: ?country=&language= (both optional — India + English defaults).
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getCountryHomepage, homepageQuerySchema, toSeoErrorResponse } from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`discovery:read:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = homepageQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid homepage parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const homepage = await getCountryHomepage(parsed.data)
    return ok(homepage)
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/homepage] unexpected error:', error)
    return fail('Homepage composition failed', 'HOMEPAGE_FAILED', 500)
  }
}
