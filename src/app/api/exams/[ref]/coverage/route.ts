/**
 * GET /api/exams/{ref}/coverage — the knowledge an exam needs today (Master
 * Plan §38 public app; §11 step 3's public data contract, consumed by the
 * P3-S4 union engine and P3-S5 exam-facing pages). Returns the CURRENT
 * version's ExamMappings expanded into VERIFIED, country-visible canonical
 * units, grouped by SyllabusNode (only mapping-bearing branches); `?version=`
 * reads a STARTED version's coverage historically (§36 old mappings remain
 * queryable; future/staged versions are never public). ACTIVE exams of ACTIVE
 * countries, inside their owning country's context (§14). Each mapped unit
 * carries its §8 requirement fields (depth, priority, relevance, likelihood,
 * scope, effective period) and its §16 knowledge-page path as data.
 */
import { errors, fail, ok } from '@/lib/api/response'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getPublicExamCoverage, toMappingErrorResponse } from '@/modules/exam-mapping'

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
    const coverage = await getPublicExamCoverage(ref, {
      country: url.searchParams.get('country') ?? undefined,
      language: url.searchParams.get('language') ?? undefined,
      version: url.searchParams.get('version') ?? undefined,
    })
    return ok({ coverage })
  } catch (error) {
    const mapped = toMappingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/public/coverage] unexpected error:', error)
    return fail('Could not load the exam coverage', 'INTERNAL_ERROR', 500)
  }
}
