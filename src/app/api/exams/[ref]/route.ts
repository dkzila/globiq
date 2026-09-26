/**
 * GET /api/exams/{ref} — public exam detail (slug or id, Master Plan §38).
 * ACTIVE exams only, inside their owning country's context (§14): requesting
 * another country's exam under ?country=IN is a clean 404 — the exam simply
 * is not part of that market's scope. Includes the full §36 version history
 * with the currently effective version resolved (§11 step 2) and the §16
 * canonical exam path.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicExam, toExamErrorResponse } from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ref: string }> }
) {
  const limit = checkRateLimit(`exams:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const { ref } = await params
  try {
    const exam = await getPublicExam(ref, {
      country: url.searchParams.get('country') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
    })
    return ok({ exam })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/public/detail] unexpected error:', error)
    return fail('Could not load the exam', 'INTERNAL_ERROR', 500)
  }
}
