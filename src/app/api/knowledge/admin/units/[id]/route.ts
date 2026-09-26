/**
 * /api/knowledge/admin/units/{id} — admin unit operations:
 *   GET   → full editing state (canonical fields, validity, allowed transitions)
 *   PATCH → update fields. Editability is per status (§36): full in
 *           DRAFT/IN_REVIEW/OUTDATED; metadata-only in VERIFIED (corrections
 *           go through flag_outdated → edit → reverify); none in ARCHIVED.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminKnowledgeUnit,
  toKnowledgeErrorResponse,
  updateKnowledgeUnit,
  updateKnowledgeUnitSchema,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'knowledge:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const unit = await getAdminKnowledgeUnit(auth.actor, id)
    return ok({ unit })
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/admin/get] unexpected error:', error)
    return fail('Could not load the knowledge unit', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'knowledge:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`knowledge:write:${clientIp(request)}`, RATE_LIMITS.knowledgeWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateKnowledgeUnitSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const unit = await updateKnowledgeUnit(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ unit })
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/admin/update] unexpected error:', error)
    return fail('Could not update the knowledge unit', 'INTERNAL_ERROR', 500)
  }
}
