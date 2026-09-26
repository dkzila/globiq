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
      { path: '/api/auth/register', method: 'POST', description: 'Create an account → Bearer token (P1-S2)' },
      { path: '/api/auth/login', method: 'POST', description: 'Email + password → Bearer token (P1-S2)' },
      { path: '/api/auth/me', method: 'GET', description: 'Current user for the presented token (auth)' },
      { path: '/api/auth/logout', method: 'POST', description: 'Revoke the current session (auth)' },
      { path: '/api/auth/sessions', method: 'GET', description: 'List active sessions (auth)' },
      { path: '/api/auth/sessions/[id]', method: 'DELETE', description: 'Revoke a session (auth)' },
    ],
  })
}
