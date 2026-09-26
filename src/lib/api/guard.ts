/**
 * GlobIQ — API auth guards (Master Plan §30, §37, §38)
 *
 * Thin helpers that bridge identity-access authentication with the API error
 * envelope. Route handlers call these before touching module services.
 * Full permission/scope enforcement (per-country scopes, audit) lands in P1-S5.
 */
import { NextResponse } from 'next/server'

import { errors } from '@/lib/api/response'
import { authenticateRequest } from '@/modules/identity-access'
import type { AuthContext, PublicUser } from '@/modules/identity-access'

/**
 * Returns the authenticated context, or a ready-to-return 401 response.
 * Usage: `const auth = await requireAuth(request); if (auth instanceof NextResponse) return auth;`
 */
export async function requireAuth(request: Request): Promise<AuthContext | NextResponse> {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized()
  return context
}

/**
 * Returns the authenticated context when the user's role is in `roles`,
 * otherwise a 401/403 response. Roles are platform-level (§6); scoped
 * authorization is enforced per-operation from P1-S5 onward.
 */
export async function requireRole(
  request: Request,
  roles: ReadonlyArray<PublicUser['role']>
): Promise<AuthContext | NextResponse> {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized()
  if (!roles.includes(context.user.role)) {
    return errors.forbidden('This operation requires a higher role')
  }
  return context
}
