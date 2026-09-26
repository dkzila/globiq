/**
 * GET /api/auth/me — current user + session + effective permissions for the
 * presented Bearer token. Master Plan §37 (client-agnostic), §39 (apps
 * authenticate identically), §20 (server re-checks every operation — the
 * permission list is for UI affordances only, never for enforcement).
 */
import { errors, ok } from '@/lib/api/response'
import { effectivePermissions } from '@/lib/permissions'
import { authenticateRequest } from '@/modules/identity-access'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized('A valid Bearer token is required')

  return ok({
    user: context.user,
    session: context.session,
    permissions: effectivePermissions({ role: context.user.role }),
  })
}
