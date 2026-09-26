/**
 * GlobIQ — API auth guards (Master Plan §20, §30, §37, §38)
 *
 * Thin helpers that bridge identity-access authentication and the shared
 * permission layer with the API error envelope. Route handlers call these
 * before touching module services; services re-assert at their boundary
 * (§37 — authorization checks at the service boundary, defense in depth).
 *
 * P1-S5: `requirePermission` is the single route-level choke point. Every
 * denial is audited (§30) — including who attempted a privileged operation
 * and was rejected.
 */
import { NextResponse } from 'next/server'

import { errors } from '@/lib/api/response'
import {
  can,
  type Actor,
  type Permission,
  type PermissionTarget,
} from '@/lib/permissions'
import { clientIp } from '@/lib/rate-limit'
import { AUDIT_ACTIONS, AUDIT_OBJECT_TYPES, recordAudit } from '@/modules/audit'
import { actorFromUser, authenticateRequest } from '@/modules/identity-access'
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

/** Authenticated context + resolved permission actor (P1-S5). */
export interface AuthGuard {
  user: PublicUser
  session: AuthContext['session']
  /** Role + home-country scope — pass to module services for object checks. */
  actor: Actor
}

/**
 * Returns the authenticated context when the caller holds `permission`
 * (optionally narrowed by `target` scope), otherwise a 401/403 response.
 * Denials are recorded in the audit trail (§30).
 */
export async function requirePermission(
  request: Request,
  permission: Permission,
  target?: PermissionTarget
): Promise<AuthGuard | NextResponse> {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized()

  const actor = await actorFromUser(context.user)
  if (!can(actor, permission, target)) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.accessDenied,
      objectType: AUDIT_OBJECT_TYPES.permission,
      objectId: permission,
      objectLabel: permission,
      metadata: {
        permission,
        method: request.method,
        path: new URL(request.url).pathname,
        reason: 'PERMISSION_DENIED',
      },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return errors.forbidden(`This operation requires the "${permission}" permission`)
  }

  return { user: context.user, session: context.session, actor }
}

/**
 * Authenticated context when the caller holds ANY of `permissions` (e.g. the
 * §38 language table serves both taxonomy and content staff). Denials are
 * audited like requirePermission (§30).
 */
export async function requireAnyPermission(
  request: Request,
  permissions: Permission[]
): Promise<AuthGuard | NextResponse> {
  const context = await authenticateRequest(request)
  if (!context) return errors.unauthorized()

  const actor = await actorFromUser(context.user)
  const held = permissions.find((permission) => can(actor, permission))
  if (!held) {
    await recordAudit({
      actor: { userId: actor.userId, email: actor.email, role: actor.role },
      action: AUDIT_ACTIONS.accessDenied,
      objectType: AUDIT_OBJECT_TYPES.permission,
      objectId: permissions[0] ?? 'permission',
      objectLabel: permissions.join(' | '),
      metadata: {
        permissions,
        method: request.method,
        path: new URL(request.url).pathname,
        reason: 'PERMISSION_DENIED',
      },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return errors.forbidden(
      `This operation requires one of: ${permissions.join(', ')}`
    )
  }

  return { user: context.user, session: context.session, actor }
}
