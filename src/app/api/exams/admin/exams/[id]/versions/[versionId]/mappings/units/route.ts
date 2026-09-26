/**
 * GET /api/exams/admin/exams/{id}/versions/{versionId}/mappings/units?q= —
 * the console mapping picker's unit search (Master Plan §8/§14): knowledge
 * units visible to this exam's country (GLOBAL or its own), never ARCHIVED,
 * each carrying its existing mappings across the SAME country's exams (all
 * versions) — the cross-exam context that surfaces the Appendix A "same
 * unit, different depth" pattern while mapping. exam:manage holders only
 * (§18/§20); the search rides the exam's scope, checked server-side.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { mappingUnitSearchSchema, searchUnitsForMapping, toMappingErrorResponse } from '@/modules/exam-mapping'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`exams:write:${clientIp(request)}`, RATE_LIMITS.examsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = mappingUnitSearchSchema.safeParse({ q: url.searchParams.get('q') ?? '' })
  if (!parsed.success) {
    return errors.badRequest('Type at least 2 characters to search units', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const result = await searchUnitsForMapping(auth.actor, id, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toMappingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/mappings/units] unexpected error:', error)
    return fail('Could not search knowledge units', 'INTERNAL_ERROR', 500)
  }
}
