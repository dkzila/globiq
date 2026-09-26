/**
 * POST /api/auth/login — exchange email + password for a Bearer token.
 * Master Plan §4/§39 (token-based auth), §30 (no user enumeration, rate limited).
 */
import { fail, ok, errors } from '@/lib/api/response'
import { effectivePermissions } from '@/lib/permissions'
import { RATE_LIMITS, checkRateLimit, clientIp } from '@/lib/rate-limit'
import { loginSchema, loginWithPassword, toAuthErrorResponse, fieldErrors } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const limit = checkRateLimit(`login:${clientIp(request)}`, RATE_LIMITS.login)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = loginSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const { user, grant } = await loginWithPassword(parsed.data, {
      userAgent: request.headers.get('user-agent'),
      ip: clientIp(request),
    })
    return ok({ user, grant, permissions: effectivePermissions({ role: user.role }) })
  } catch (error) {
    const mapped = toAuthErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[auth/login] unexpected error:', error)
    return fail('Sign-in failed. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
