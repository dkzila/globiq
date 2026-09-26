/**
 * POST /api/exams/admin/exams/{id}/versions — create a new ExamVersion
 * (Master Plan §36: "Exam syllabus changes create a new ExamVersion"). The
 * window [effectiveFrom, effectiveTo] is day-granular, non-overlapping and
 * immutable after create; the currently open version is auto-closed at
 * (newFrom − 1 day). Old versions remain historically queryable — this is
 * the anchor SyllabusNode (P3-S2) and ExamMapping (P3-S3) attach to.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  createExamVersion,
  createExamVersionSchema,
  toExamErrorResponse,
} from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`exams:write:${clientIp(request)}`, RATE_LIMITS.examsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createExamVersionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const exam = await createExamVersion(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ exam }, { status: 201 })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/versions/create] unexpected error:', error)
    return fail('Could not create the exam version', 'INTERNAL_ERROR', 500)
  }
}
