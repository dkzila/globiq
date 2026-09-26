/**
 * POST /api/content/admin/sources/{id}/verify — the §24 editor verification
 *   workflow: verify (UNVERIFIED → VERIFIED, sets verifiedAt), reject
 *   (→ UNRELIABLE — trust revoked, links preserved as provenance history),
 *   recheck (VERIFIED/UNRELIABLE → UNVERIFIED — back under assessment).
 *   `source:manage`; every transition audited with before/after.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  sourceVerificationSchema,
  toSourceErrorResponse,
  transitionSourceVerification,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'source:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`source:write:${clientIp(request)}`, RATE_LIMITS.sourceWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = sourceVerificationSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const source = await transitionSourceVerification(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ source })
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[sources/admin/verify] unexpected error:', error)
    return fail('Could not transition the source verification', 'INTERNAL_ERROR', 500)
  }
}
