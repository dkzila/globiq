/**
 * GET /api/auth/sessions — list the caller's active sessions (devices/apps).
 * Master Plan §30 (session management) — users can audit every token issued.
 */
import { errors, ok } from '@/lib/api/response'
import { authenticateRequest, listSessions } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  const sessions = await listSessions(context.user.id, context.session.id)
  return ok({ sessions, currentSessionId: context.session.id })
}
