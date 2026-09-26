/**
 * GET /api/locale/resolve — resolve and validate a locale context (§15/§16).
 *
 * Query params:
 *   path     — a URL path to resolve, e.g. /uk/fr/gk/topic/ (takes precedence)
 *   country  — country slug or ISO code (optional)
 *   language — language code (optional, must be configured for the country)
 *
 * Returns the resolved context with its canonical URL. Non-canonical inputs
 * (e.g. /en/, /in/, explicit default language) resolve with
 * `isCanonical: false` so callers (future middleware, mobile deep links) can
 * redirect to `canonicalUrl`.
 */
import { fail, ok, errors } from '@/lib/api/response'
import { resolveFromPath, resolveLocaleContext, toLocaleErrorResponse } from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const path = url.searchParams.get('path')
  const country = url.searchParams.get('country')
  const language = url.searchParams.get('language')

  if (!path && !country && !language) {
    return errors.badRequest('Provide ?path= or ?country= / ?language= to resolve')
  }

  try {
    const resolution = path
      ? await resolveFromPath(path)
      : await resolveLocaleContext({
          ...(country ? { country } : {}),
          ...(language ? { language } : {}),
        })
    return ok({ resolution })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[locale/resolve] unexpected error:', error)
    return fail('Could not resolve the locale context', 'INTERNAL_ERROR', 500)
  }
}
