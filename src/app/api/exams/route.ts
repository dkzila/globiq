/**
 * GET /api/exams — public exam directory (Master Plan §38 public app, §14/§15
 * server-side country scope, §37 pagination + deterministic sorting).
 * ACTIVE exams of one ACTIVE country; ?country= defaults to the root market
 * (India). Cross-country browsing is a deliberate country-context switch
 * (§15) — the scope is enforced here, never by hiding UI.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicExams, publicExamListQuerySchema, toExamErrorResponse } from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`exams:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = publicExamListQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getPublicExams(parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/public/list] unexpected error:', error)
    return fail('Could not load exams', 'INTERNAL_ERROR', 500)
  }
}
