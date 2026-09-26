/**
 * GET /api/exams/admin/exams/{id}/versions/{versionId}/syllabus — the
 * editorial console's tree read (Master Plan §38). ANY version of a scoped
 * exam, including staged/future trees; carries the §36 editability verdict
 * (staged | frozen | locked) so the UI can render affordances from server
 * truth. exam:manage holders only (§18/§20 — writers never manage syllabi).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getAdminVersionTree, toExamErrorResponse } from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`exams:write:${clientIp(request)}`, RATE_LIMITS.examsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id, versionId } = await params
  try {
    const tree = await getAdminVersionTree(auth.actor, id, versionId)
    return ok({ tree })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/syllabus/tree] unexpected error:', error)
    return fail('Could not load the syllabus tree', 'INTERNAL_ERROR', 500)
  }
}
