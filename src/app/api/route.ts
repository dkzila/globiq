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
      // Identity & Access (P1-S2)
      { path: '/api/auth/register', method: 'POST', description: 'Create an account → Bearer token' },
      { path: '/api/auth/login', method: 'POST', description: 'Email + password → Bearer token' },
      { path: '/api/auth/me', method: 'GET', description: 'Current user for the presented token (auth)' },
      { path: '/api/auth/logout', method: 'POST', description: 'Revoke the current session (auth)' },
      { path: '/api/auth/sessions', method: 'GET', description: 'List active sessions (auth)' },
      { path: '/api/auth/sessions/[id]', method: 'DELETE', description: 'Revoke a session (auth)' },
      // Country & Locale (P1-S3)
      { path: '/api/countries', method: 'GET', description: 'Public country list with per-country languages & canonical URLs' },
      { path: '/api/countries', method: 'POST', description: 'Create a country (admin)' },
      { path: '/api/countries/[iso]', method: 'GET', description: 'Country detail by ISO code or slug' },
      { path: '/api/countries/[iso]', method: 'PATCH', description: 'Update country configuration (admin)' },
      { path: '/api/countries/[iso]/languages', method: 'PUT', description: 'Replace a country’s language set (admin)' },
      { path: '/api/languages', method: 'GET', description: 'Platform language table (admin)' },
      { path: '/api/languages', method: 'POST', description: 'Create a language (admin)' },
      { path: '/api/languages/[code]', method: 'PATCH', description: 'Update a language (admin, code immutable)' },
      { path: '/api/locale/resolve', method: 'GET', description: 'Resolve & validate a locale context (?path= or ?country=&language=) with canonical URL' },
    ],
  })
}
