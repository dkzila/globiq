/**
 * GET /api/search/admin — index statistics for the §38 admin console:
 * document counts by type and language, engine identity (§29), the live
 * language→FTS-config resolution (§17), and the last indexing time.
 * ADMIN only (the index is a platform-wide derived projection).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { getIndexStats, toSearchErrorResponse } from '@/modules/search'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'search:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`search:admin:${clientIp(request)}`, RATE_LIMITS.searchWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  try {
    const stats = await getIndexStats()
    return ok(stats)
  } catch (error) {
    const mapped = toSearchErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[search/admin/stats] unexpected error:', error)
    return fail('Could not load index statistics', 'INTERNAL_ERROR', 500)
  }
}
