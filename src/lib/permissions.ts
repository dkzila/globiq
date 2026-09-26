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
 *   `target.languageId` carries the object's language for WRITER narrowing.
 * - ADMIN: everything (§18 Global Admin).
 * - COUNTRY_ADMIN: country-scoped operations only, and only within the home
 *   country (§18/§20 — a Country A admin must never mutate Country B data).
 *   Platform-level exceptions are listed below per permission.
 * - WRITER (P2-S4, §18 "create/edit assigned content but cannot publish"):
 *   content:manage + editorial:work within the home country, narrowed to
 *   `languageScopeId` when set (§20 explicit country/language scopes);
 *   source:manage (platform evidence registry); NEVER content:publish.
 * - READER: own sessions only.
 */

export type UserRole = 'READER' | 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'

/** Capability keys — the platform's RBAC vocabulary (§38). */
export type Permission =
  | 'taxonomy:manage' // create/update/retire taxonomy nodes (country-scoped for COUNTRY_ADMIN)
  | 'knowledge:manage' // create/edit/transition KnowledgeUnits (country-scoped for COUNTRY_ADMIN)
  | 'content:manage' // create/edit/submit content items + revisions (country-scoped for COUNTRY_ADMIN; WRITER: own country + language scope)
  | 'content:publish' // publish/schedule/retire content — the editorial gate (§18 "cannot publish unless granted"): ADMIN + COUNTRY_ADMIN, never WRITER
  | 'source:manage' // create/edit/verify Source evidence records (§24 — platform-level registry; link/unlink rides content:manage on the item)
  | 'editorial:work' // work the editorial task board (P2-S4 §19): ADMIN + COUNTRY_ADMIN manage; WRITER claims/works assigned tasks in scope
  | 'country-config:manage' // platform country configuration (ADMIN only — §14/§38)
  | 'language:manage' // platform language registry (ADMIN only — §35)
  | 'audit:read' // read the accountability trail (ADMIN only in P1)
  | 'sessions:manage-own' // list/revoke own sessions (any active account)

/**
 * The actor every protected operation runs as. Built from the authenticated
 * user + resolved home country/language scope (see `actorFromUser` in
 * identity-access).
 */
export interface Actor {
  userId: string
  email: string
  role: UserRole
  /** Home country id — the COUNTRY_ADMIN/WRITER scope (null = no country scope). */
  countryId: string | null
  /** §18/§20 staff language scope — narrows WRITER content/task operations
   * to one language when set (null = all languages within the country). */
  languageScopeId: string | null
}

/** What the actor is trying to act on. */
export interface PermissionTarget {
  /** Country the target object belongs to; null = global/platform object. */
  countryId?: string | null
  /** Language of the target object (e.g. a ContentItem's language) — used by
   * the WRITER language-scope narrowing (§20). */
  languageId?: string | null
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
    'content:publish',
    'source:manage',
    'editorial:work',
    'country-config:manage',
    'language:manage',
    'audit:read',
    'sessions:manage-own',
  ],
  // Sources are platform-level shared evidence (§24) — the record itself is
  // never country-scoped. Country scope is enforced on the LINK (which content
  // may cite it), which rides content:manage + the item's unit-country target.
  COUNTRY_ADMIN: [
    'taxonomy:manage',
    'knowledge:manage',
    'content:manage',
    'content:publish',
    'source:manage',
    'editorial:work',
    'sessions:manage-own',
  ],
  // §18 Writer: "create/edit assigned content but cannot publish unless
  // granted" — publish-class transitions need content:publish (never granted
  // at role level). Writers also register/verify evidence (source:manage,
  // platform-level per §24) and work the editorial board in scope.
  WRITER: ['content:manage', 'source:manage', 'editorial:work', 'sessions:manage-own'],
  READER: ['sessions:manage-own'],
}

/** Permissions whose object checks narrow by country for COUNTRY_ADMIN. */
const COUNTRY_NARROWED: ReadonlySet<Permission> = new Set([
  'taxonomy:manage',
  'knowledge:manage',
  'content:manage',
  'content:publish',
  'editorial:work',
])

/** Permissions WRITER may hold, narrowed by country AND language scope. */
const WRITER_NARROWED: ReadonlySet<Permission> = new Set([
  'content:manage',
  'editorial:work',
])

/**
 * True when the actor holds the permission. With a `target`, country scoping
 * is applied: COUNTRY_ADMIN may only act on objects of their own country —
 * global objects (countryId null) are ADMIN-only (§13/§20/§38). WRITER adds
 * the language-scope narrowing (§20): when `actor.languageScopeId` is set and
 * the target carries a language, they must match.
 */
export function can(
  actor: Pick<Actor, 'role' | 'countryId' | 'languageScopeId'>,
  permission: Permission,
  target?: PermissionTarget
): boolean {
  if (!ROLE_CATEGORY_GRANTS[actor.role].includes(permission)) return false
  if (actor.role === 'ADMIN') return true

  // Platform-level permission: the §24 Source registry has no country
  // dimension — the category grant passes WITHOUT object-level narrowing.
  // (Country scope applies on the LINK — a content-item operation gated by
  // content:manage + the item's unit country.)
  if (permission === 'source:manage') return true

  if (actor.role === 'COUNTRY_ADMIN' && COUNTRY_NARROWED.has(permission)) {
    if (!target) return true // category gate — object checks still apply
    return target.countryId != null && target.countryId === actor.countryId
  }

  if (actor.role === 'WRITER' && WRITER_NARROWED.has(permission)) {
    if (!target) return true // category gate — object checks still apply
    // Same country rule as COUNTRY_ADMIN: global objects are ADMIN-only.
    if (target.countryId == null || target.countryId !== actor.countryId) return false
    // §20 explicit language scope: a Hindi-scoped writer cannot touch
    // representations in other languages. Targets without a language
    // dimension (languageId null) remain workable.
    if (actor.languageScopeId && target.languageId != null && target.languageId !== actor.languageScopeId) {
      return false
    }
    return true
  }

  return false
}

/** `can` + throw — the service-boundary enforcement point (§37). */
export function assertCan(
  actor: Pick<Actor, 'role' | 'countryId' | 'languageScopeId'>,
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
  'content:manage': 'Create & edit content (own scope)',
  'content:publish': 'Publish, schedule & retire content',
  'source:manage': 'Manage source evidence & verification (§24)',
  'editorial:work': 'Work the editorial task board (own scope)',
  'country-config:manage': 'Manage country configuration',
  'language:manage': 'Manage languages',
  'audit:read': 'Read audit trail',
  'sessions:manage-own': 'Manage own sessions',
}
