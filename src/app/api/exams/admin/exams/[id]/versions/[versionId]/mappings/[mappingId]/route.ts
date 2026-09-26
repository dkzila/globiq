/**
 * PATCH  /api/exams/admin/exams/{id}/versions/{versionId}/mappings/{mappingId}
 * DELETE — edit / remove one §8 requirement mapping. Anchors (unit + node)
 * are immutable identity: re-anchoring means remove + re-create (both
 * audited). Writable only while the version is `staged` or `live` (§36 +
 * §12); superseded versions and retired exams refuse writes. exam:manage
 * holders only (§18/§20).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  removeExamMapping,
  toMappingErrorResponse,
  updateExamMapping,
  updateExamMappingSchema,
} from '@/modules/exam-mapping'

export const dynamic = 'force-dynamic'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string; mappingId: string }> }
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

  const parsed = updateExamMappingSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id, versionId, mappingId } = await params
  try {
    const mappings = await updateExamMapping(auth.actor, id, versionId, mappingId, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ mappings })
  } catch (error) {
    const mapped = toMappingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/mappings/update] unexpected error:', error)
    return fail('Could not update the exam mapping', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string; mappingId: string }> }
) {
  const auth = await requirePermission(request, 'exam:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`exams:write:${clientIp(request)}`, RATE_LIMITS.examsWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id, versionId, mappingId } = await params
  try {
    const mappings = await removeExamMapping(auth.actor, id, versionId, mappingId, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ mappings })
  } catch (error) {
    const mapped = toMappingErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[exams/admin/mappings/remove] unexpected error:', error)
    return fail('Could not remove the exam mapping', 'INTERNAL_ERROR', 500)
  }
}
