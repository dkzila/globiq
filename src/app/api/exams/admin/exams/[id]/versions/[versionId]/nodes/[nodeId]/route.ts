/**
 * PATCH /api/exams/admin/exams/{id}/versions/{versionId}/nodes/{nodeId} —
 * edit and/or move a SyllabusNode on a STAGED tree (§6/§36). parentId carries
 * the move (same-version parent, no cycles — the service walks the ancestor
 * chain); topicId relinks the canonical taxonomy anchor (§13).
 *
 * DELETE — remove a leaf node (children must go first: NODE_HAS_CHILDREN).
 * Staged trees only; frozen §36 history refuses both verbs.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  removeSyllabusNode,
  toExamErrorResponse,
  updateSyllabusNode,
  updateSyllabusNodeSchema,
} from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string; nodeId: string }> }
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

  const parsed = updateSyllabusNodeSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, versionId, nodeId } = await params
  try {
    const tree = await updateSyllabusNode(auth.actor, id, versionId, nodeId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ tree })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/syllabus/update-node] unexpected error:', error)
    return fail('Could not update the syllabus node', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string; nodeId: string }> }
) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`exams:write:${clientIp(request)}`, RATE_LIMITS.examsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id, versionId, nodeId } = await params
  try {
    const tree = await removeSyllabusNode(auth.actor, id, versionId, nodeId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ tree })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/syllabus/remove-node] unexpected error:', error)
    return fail('Could not remove the syllabus node', 'INTERNAL_ERROR', 500)
  }
}
