/**
 * GET /api/editorial/assignees — the §20 staff directory for task
 *   assignment. Editors only (content:publish — §18): ADMIN sees all active
 *   staff; COUNTRY_ADMIN sees own-country staff + platform admins. Each entry
 *   carries the explicit country/language scope so the UI can prevent
 *   incompatible assignments (the server re-validates on every write).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { listAssignableStaff, toEditorialErrorResponse } from '@/modules/editorial'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'content:publish')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`editorial:read:${clientIp(request)}`, RATE_LIMITS.editorialRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const staff = await listAssignableStaff(auth.actor)
    return ok({ staff })
  } catch (error) {
    const mapped = toEditorialErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[editorial/assignees] unexpected error:', error)
    return fail('Could not load the staff directory', 'INTERNAL_ERROR', 500)
  }
}
