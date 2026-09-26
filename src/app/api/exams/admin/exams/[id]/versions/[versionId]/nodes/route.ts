/**
 * POST /api/exams/admin/exams/{id}/versions/{versionId}/nodes — add one
 * SyllabusNode to a STAGED tree (Master Plan §6, §36). The service refuses
 * frozen/locked trees: a version whose window has started on a non-DRAFT
 * exam is §36 history — changes go into a new ExamVersion. Parent must live
 * in the same version; topicId must be GLOBAL or the exam's own country's
 * (§13/§14).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { createSyllabusNode, createSyllabusNodeSchema, toExamErrorResponse } from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
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

  const parsed = createSyllabusNodeSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, versionId } = await params
  try {
    const tree = await createSyllabusNode(auth.actor, id, versionId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ tree }, { status: 201 })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/syllabus/create-node] unexpected error:', error)
    return fail('Could not create the syllabus node', 'INTERNAL_ERROR', 500)
  }
}
