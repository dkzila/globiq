/**
 * PATCH  /api/exams/admin/exams/{id}/versions/{versionId} — metadata-only
 *   edits (label, source, notes). The effective window is IMMUTABLE after
 *   create (§36 append-only history) — corrections are a new version.
 * DELETE /api/exams/admin/exams/{id}/versions/{versionId} — pre-effective
 *   correction path: allowed only while the version is still future-dated,
 *   is the latest, and carries no references (SyllabusNode/ExamMapping
 *   guards extend this in P3-S2/S3). Reopens the predecessor it auto-closed.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  removeExamVersion,
  toExamErrorResponse,
  updateExamVersion,
  updateExamVersionSchema,
} from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function PATCH(
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

  const parsed = updateExamVersionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, versionId } = await params
  try {
    const exam = await updateExamVersion(auth.actor, id, versionId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ exam })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/versions/update] unexpected error:', error)
    return fail('Could not update the exam version', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`exams:write:${clientIp(request)}`, RATE_LIMITS.examsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id, versionId } = await params
  try {
    const exam = await removeExamVersion(auth.actor, id, versionId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ exam })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/versions/remove] unexpected error:', error)
    return fail('Could not remove the exam version', 'INTERNAL_ERROR', 500)
  }
}
