/**
 * POST /api/auth/logout — revoke the session that presented the Bearer token.
 * Master Plan §30 (session management), §39 (token-based).
 */
import { fail, ok, errors } from '@/lib/api/response'
import { authenticateRequest, revokeCurrentSession } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required to sign out')

  try {
    await revokeCurrentSession(context.session.id)
    return ok({ signedOut: true })
  } catch (error) {
    console.error('[auth/logout] unexpected error:', error)
    return fail('Sign-out failed. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
