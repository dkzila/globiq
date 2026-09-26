/**
 * GET /api/exams/combined — the §11 multi-exam combination engine (Master
 * Plan §43 P3-S4). The COMPUTED combined-exam view across an explicit exam
 * set: union of canonical KnowledgeUnits (deduplicated strictly by canonical
 * identity — never by title), each unit ONCE at the MAXIMUM required depth
 * across its covering exams, with the covering-exam set for the "Covers:
 * Exam A + Exam B" badge (Appendix A) and the base §11 step 7 ranking
 * (priority → question likelihood → freshness; mastery/revision land in P7).
 *
 * Single-exam mode is the same endpoint with one ref — no additional data
 * modeling (§11). Nothing is stored (§46.3). Until P5-S1 wires follows, the
 * client passes the set: `?exams=upsc-civil-services,ssc-cgl` (comma-
 * separated and/or repeated). ACTIVE exams of the request's ACTIVE country
 * only (§14 enforced server-side — out-of-country or non-ACTIVE refs are
 * uniform 404s). Public read, examsRead rate bucket.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  combinedQueueQuerySchema,
  getCombinedExamView,
  parseCombinedExamRefs,
  toMappingErrorResponse,
} from '@/modules/exam-mapping'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const limit = checkRateLimit(`exams:read:${clientIp(request)}`, RATE_LIMITS.examsRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = combinedQueueQuerySchema.safeParse({
    country: url.searchParams.get('country') ?? undefined,
    language: url.searchParams.get('language') ?? undefined,
    exams: parseCombinedExamRefs(url.searchParams.getAll('exams')),
  })
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const combined = await getCombinedExamView(parsed.data)
    return ok({ combined })
  } catch (error) {
    const mapped = toMappingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/public/combined] unexpected error:', error)
    return fail('Could not compute the combined exam view', 'INTERNAL_ERROR', 500)
  }
}
