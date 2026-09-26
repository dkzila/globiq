/**
 * GET /api/exams/{ref}/syllabus — the syllabus a reader sees today (Master
 * Plan §38 public app, §11 step 2/3). Returns the CURRENT version's
 * SyllabusNode tree by default; `?version=` reads an explicitly requested
 * version that has STARTED (§36 old versions stay historically queryable —
 * staged/future trees are not public). ACTIVE exams of ACTIVE countries,
 * inside their owning country's context (§14). Topic-linked nodes carry the
 * resolved §35 label and the §16 syllabus-topic path (`…/exams/{exam}/
 * syllabus/{topic}/`) as data.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicExamSyllabus, toExamErrorResponse } from '@/modules/exams-syllabus'

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
    const syllabus = await getPublicExamSyllabus(ref, {
      country: url.searchParams.get('country') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
      version: url.searchParams.get('version') ?? undefined,
    })
    return ok({ syllabus })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/public/syllabus] unexpected error:', error)
    return fail('Could not load the syllabus', 'INTERNAL_ERROR', 500)
  }
}
