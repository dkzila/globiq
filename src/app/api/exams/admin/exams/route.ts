/**
 * GET  /api/exams/admin/exams — admin list (all lifecycle statuses).
 *   ADMIN: every country's exams (optionally ?country= filtered).
 *   COUNTRY_ADMIN: own country ONLY — exams are always country-owned (§14),
 *   there is no global fallback (unlike knowledge units).
 * POST /api/exams/admin/exams — create an exam (enters DRAFT; §18 exam
 *   operations are Country Admin / Admin work).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  adminExamListQuerySchema,
  createExam,
  createExamSchema,
  getAdminExams,
  toExamErrorResponse,
} from '@/modules/exams-syllabus'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const url = new URL(request.url)
  const parsed = adminExamListQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    level: url.searchParams.get('level') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid admin query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getAdminExams(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/list] unexpected error:', error)
    return fail('Could not load exams', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
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

  const parsed = createExamSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const exam = await createExam(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ exam }, { status: 201 })
  } catch (error) {
    const mapped = toExamErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/create] unexpected error:', error)
    return fail('Could not create the exam', 'INTERNAL_ERROR', 500)
  }
}
