/**
 * POST /api/exams/admin/exams/{id}/versions/{versionId}/import — bulk-replace
 * a STAGED tree from an indented outline (Master Plan §38 editorial console;
 * the primary way a team enters a syllabus from the official notification).
 * Two spaces or one tab per level; blank lines and `#` comments skipped; an
 * empty outline clears the staged tree. Frozen §36 versions are refused —
 * historical trees never change.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  importSyllabusOutline,
  importSyllabusOutlineSchema,
  toExamErrorResponse,
} from '@/modules/exams-syllabus'

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

  const parsed = importSyllabusOutlineSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, versionId } = await params
  try {
    const tree = await importSyllabusOutline(auth.actor, id, versionId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ tree })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/syllabus/import] unexpected error:', error)
    return fail('Could not import the syllabus outline', 'INTERNAL_ERROR', 500)
  }
}
