/**
 * DELETE /api/auth/sessions/[id] — revoke one of the caller's sessions.
 * Revoking the current session is allowed (equivalent to signing out).
 * Master Plan §30 (session management), §37 (stable resource identifiers).
 */
import { fail, errors, ok } from '@/lib/api/response'
import { authenticateRequest, revokeSessionById, toAuthErrorResponse } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const { id } = await params
  try {
    const session = await revokeSessionById(context.user.id, id, {
      userId: context.user.id,
      email: context.user.email,
      role: context.user.role,
    })
    const revokedCurrent = session.id === context.session.id
    return ok({ session, revokedCurrent, signedOut: revokedCurrent })
  } catch (error) {
    const mapped = toAuthErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[auth/sessions/delete] unexpected error:', error)
    return fail('Could not revoke the session. Please try again.', 'INTERNAL_ERROR', 500)
  }
}
