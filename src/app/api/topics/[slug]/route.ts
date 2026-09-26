/**
 * GET /api/topics/{slug} — the §16/§33 topic landing page composition
 * (Master Plan §33 evergreen landing surfaces with topic clusters + internal
 * links, §13 country-aware visibility, §14/§15 server-side scope, §35 label
 * resolution with honest fallback, §8/§36 exams aggregated from in-effect
 * requirement rows, §37 paginated units + explicit errors, §38 public app).
 * Query: ?country=&language=&page=&pageSize=.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getTopicLanding,
  toSeoErrorResponse,
  topicLandingQuerySchema,
  topicRefSchema,
} from '@/modules/seo'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const limit = checkRateLimit(`discovery:read:${clientIp(request)}`, RATE_LIMITS.discoveryRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  // Next.js 16: route params are a Promise — await before use.
  const { slug } = await params

  const ref = topicRefSchema.safeParse(slug)
  if (!ref.success) {
    return errors.badRequest('Invalid topic reference', ref.error.flatten().fieldErrors)
  }

  const url = new URL(request.url)
  const parsed = topicLandingQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid topic landing parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const landing = await getTopicLanding(ref.data, parsed.data)
    return ok(landing)
  } catch (error) {
    const mapped = toSeoErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[seo/topic-landing] unexpected error:', error)
    return fail('Topic landing composition failed', 'LANDING_FAILED', 500)
  }
}
