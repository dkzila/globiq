/**
 * GET  /api/exams/admin/exams/{id}/versions/{versionId}/mappings — the
 * editorial console's mapping read (Master Plan §38): ANY version of a scoped
 * exam (staged/live/frozen), the §36 mapping-editability verdict (staged |
 * live | frozen | locked) and the full tree with per-node mappings.
 *
 * POST — map a knowledge unit to a syllabus node of this version (§6/§8/§13).
 * Writable while the version is `staged` (DRAFT exam / future version) or
 * `live` (current version — §12 lets current affairs attach mid-window);
 * superseded versions refuse writes (§36 history). exam:manage holders only
 * (§18/§20); unit scope is country-guarded server-side (§14).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  createExamMapping,
  createExamMappingSchema,
  getAdminVersionMappings,
  toMappingErrorResponse,
} from '@/modules/exam-mapping'

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
    const mappings = await getAdminVersionMappings(auth.actor, id, versionId)
    return ok({ mappings })
  } catch (error) {
    const mapped = toMappingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/mappings/read] unexpected error:', error)
    return fail('Could not load the exam mappings', 'INTERNAL_ERROR', 500)
  }
}

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

  const parsed = createExamMappingSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, versionId } = await params
  try {
    const mappings = await createExamMapping(auth.actor, id, versionId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ mappings }, { status: 201 })
  } catch (error) {
    const mapped = toMappingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/mappings/create] unexpected error:', error)
    return fail('Could not create the exam mapping', 'INTERNAL_ERROR', 500)
  }
}
