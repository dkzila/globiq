/**
 * GlobIQ — Shared permission layer (Master Plan §18, §20, §30, §37, §38)
 *
 * The single place that answers "may actor X do action Y on object Z".
 * Route guards and module services both funnel through these functions, so
 * scope rules are enforced server-side on EVERY protected operation (§20) —
 * never by hiding UI elements.
 *
 * Placement note (modular monolith): this file is the permission core of the
 * Identity & Access module, but lives in src/lib as a dependency leaf so that
 * country-locale and taxonomy services can enforce permissions without
 * creating a module import cycle (identity-access ↔ country-locale).
 *
 * Semantics:
 * - `can(actor, permission)` — category-level gate ("may enter this surface").
 * - `can(actor, permission, target)` — object-level decision. `target.countryId`
 *   is the country the target object belongs to; `null` means "not
 *   country-scoped" (global/platform object) and is admin-only to mutate.
 * - ADMIN: everything (§18 Global Admin).
 * - COUNTRY_ADMIN: country-scoped operations only, and only within the home
 *   country (§18/§20 — a Country A admin must never mutate Country B data).
 * - WRITER/READER: own sessions only in P1 (editorial scopes land with the
 *   editorial module, P2-S4).
 */

export type UserRole = 'READER' | 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'

/** Capability keys — the platform's RBAC vocabulary (§38). */
export type Permission =
  | 'taxonomy:manage' // create/update/retire taxonomy nodes (country-scoped for COUNTRY_ADMIN)
  | 'knowledge:manage' // create/edit/transition KnowledgeUnits (country-scoped for COUNTRY_ADMIN)
  | 'content:manage' // create/edit/publish ContentItems + revisions (country-scoped for COUNTRY_ADMIN; WRITER lands P2-S4)
  | 'country-config:manage' // platform country configuration (ADMIN only — §14/§38)
  | 'language:manage' // platform language registry (ADMIN only — §35)
  | 'audit:read' // read the accountability trail (ADMIN only in P1)
  | 'sessions:manage-own' // list/revoke own sessions (any active account)

/**
 * The actor every protected operation runs as. Built from the authenticated
 * user + resolved home country (see `actorFromUser` in identity-access).
 */
export interface Actor {
  userId: string
  email: string
  role: UserRole
  /** Home country id — the COUNTRY_ADMIN scope (null = no country scope). */
  countryId: string | null
}

/** What the actor is trying to act on. */
export interface PermissionTarget {
  /** Country the target object belongs to; null = global/platform object. */
  countryId?: string | null
}

export class PermissionDeniedError extends Error {
  readonly code = 'PERMISSION_DENIED'
  readonly status = 403
  readonly permission: Permission

  constructor(permission: Permission, message: string) {
    super(message)
    this.name = 'PermissionDeniedError'
    this.permission = permission
  }
}

/** Category-level grants per role (§18). Object-level narrowing happens in `can`. */
const ROLE_CATEGORY_GRANTS: Record<UserRole, Permission[]> = {
  ADMIN: [
    'taxonomy:manage',
    'knowledge:manage',
    'content:manage',
    'country-config:manage',
    'language:manage',
    'audit:read',
    'sessions:manage-own',
  ],
  COUNTRY_ADMIN: ['taxonomy:manage', 'knowledge:manage', 'content:manage', 'sessions:manage-own'],
  WRITER: ['sessions:manage-own'],
  READER: ['sessions:manage-own'],
}

/**
 * True when the actor holds the permission. With a `target`, country scoping
 * is applied: COUNTRY_ADMIN may only act on objects of their own country —
 * global objects (countryId null) are ADMIN-only (§13/§20/§38).
 */
export function can(
  actor: Pick<Actor, 'role' | 'countryId'>,
  permission: Permission,
  target?: PermissionTarget
): boolean {
  if (!ROLE_CATEGORY_GRANTS[actor.role].includes(permission)) return false
  if (actor.role === 'ADMIN') return true

  // COUNTRY_ADMIN: the country-scoped permissions — taxonomy (P1-S4), knowledge
  // (P2-S1) and content (P2-S2) follow the same object-level narrowing rule.
  if (
    actor.role === 'COUNTRY_ADMIN' &&
    (permission === 'taxonomy:manage' ||
      permission === 'knowledge:manage' ||
      permission === 'content:manage')
  ) {
    if (!target) return true // category gate — object checks still apply
    return target.countryId != null && target.countryId === actor.countryId
  }
  return false
}

/** `can` + throw — the service-boundary enforcement point (§37). */
export function assertCan(
  actor: Pick<Actor, 'role' | 'countryId'>,
  permission: Permission,
  target?: PermissionTarget,
  message?: string
): void {
  if (!can(actor, permission, target)) {
    throw new PermissionDeniedError(
      permission,
      message ?? `You do not have the "${permission}" permission for this operation`
    )
  }
}

/**
 * The caller's effective (category-level) permissions — surfaced via
 * /api/auth/me so clients render affordances from server truth (§37),
 * while the server re-checks every operation regardless.
 */
export function effectivePermissions(actor: Pick<Actor, 'role'>): Permission[] {
  return [...ROLE_CATEGORY_GRANTS[actor.role]]
}

/** Human-readable labels for UI rendering. */
export const PERMISSION_LABELS: Record<Permission, string> = {
  'taxonomy:manage': 'Manage taxonomy (own country)',
  'knowledge:manage': 'Manage knowledge units (own country)',
  'content:manage': 'Manage content items & revisions (own country)',
  'country-config:manage': 'Manage country configuration',
  'language:manage': 'Manage languages',
  'audit:read': 'Read audit trail',
  'sessions:manage-own': 'Manage own sessions',
}
