/**
 * GET /api/auth/me — current user + session for the presented Bearer token.
 * Master Plan §37 (client-agnostic), §39 (apps authenticate identically).
 */
import { errors, ok } from '@/lib/api/response'
import { authenticateRequest } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  return ok({ user: context.user, session: context.session })
}
