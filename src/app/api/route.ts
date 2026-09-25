/**
 * GET /api — API surface index (client-agnostic discovery, Master Plan §37).
 */
import { ok } from '@/lib/api/response'
import { PLATFORM } from '@/config/platform'

export const dynamic = 'force-dynamic'

export function GET() {
  return ok({
    service: `${PLATFORM.name} API`,
    version: PLATFORM.version,
    endpoints: [
      { path: '/api/health', method: 'GET', description: 'Platform & database health with seed snapshot' },
    ],
  })
}
