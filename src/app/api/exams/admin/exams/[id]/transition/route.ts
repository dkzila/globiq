/**
 * POST /api/exams/admin/exams/{id}/transition — exam lifecycle (§36):
 *
 *   DRAFT ─activate→ ACTIVE ⇄ deactivate/reactivate ⇄ INACTIVE
 *     │                    │
 *     └──retire──→ RETIRED ←┘ (read-only end-of-life; reason required)
 *
 * Exams are configuration, not content — no §19 review workflow. Every
 * transition is audited; retire requires a reason (§36 provenance).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  examTransitionSchema,
  toExamErrorResponse,
  transitionExam,
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

  const parsed = examTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const exam = await transitionExam(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ exam })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/transition] unexpected error:', error)
    return fail('Could not transition the exam', 'INTERNAL_ERROR', 500)
  }
}
