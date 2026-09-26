/**
 * GET   /api/exams/admin/exams/{id} — admin exam detail: full §36 version
 *   history, current version, editability + allowed transitions (§38).
 * PATCH /api/exams/admin/exams/{id} — update descriptive fields (name,
 *   organiser, level, description, notes). slug/code/country are immutable
 *   identity (§37); status changes go through /transition; RETIRED is
 *   read-only (§36).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminExam,
  toExamErrorResponse,
  updateExam,
  updateExamSchema,
} from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const exam = await getAdminExam(auth.actor, id)
    return ok({ exam })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/detail] unexpected error:', error)
    return fail('Could not load the exam', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(
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

  const parsed = updateExamSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const exam = await updateExam(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ exam })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/update] unexpected error:', error)
    return fail('Could not update the exam', 'INTERNAL_ERROR', 500)
  }
}
