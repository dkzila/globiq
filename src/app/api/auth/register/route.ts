/**
 * POST /api/auth/register — create an account and receive a Bearer token.
 * Master Plan §4/§39 (token-based auth from Phase 1), §37 (API principles).
 */
import { fail, ok, errors } from '@/lib/api/response'
import { effectivePermissions } from '@/lib/permissions'
import { RATE_LIMITS, checkRateLimit, clientIp } from '@/lib/rate-limit'
import { registerSchema, registerUser, toAuthErrorResponse, fieldErrors } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const limit = checkRateLimit(`register:${clientIp(request)}`, RATE_LIMITS.register)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const { user, grant } = await registerUser(parsed.data, {
      userAgent: request.headers.get('user-agent'),
      ip: clientIp(request),
    })
    return ok({ user, grant, permissions: effectivePermissions({ role: user.role }) }, { status: 201 })
  } catch (error) {
    const mapped = toAuthErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[auth/register] unexpected error:', error)
    return fail('Registration failed. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
