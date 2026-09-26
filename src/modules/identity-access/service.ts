/**
 * GlobIQ — Identity & Access: domain service
 * Master Plan §6 (User), §20 (login & access), §30 (security), §37 (API
 * principles), §39 (token-based from Phase 1), §43 (P1-S2 scope).
 *
 * All auth logic lives here (modular monolith rule — route handlers stay thin).
 * The service never touches HTTP directly except `authenticateRequest`, which
 * reads the standard `Authorization: Bearer` header any client can send.
 */
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { Actor } from '@/lib/permissions'
import {
  AUDIT_ACTIONS,
  AUDIT_OBJECT_TYPES,
  recordAudit,
  type AuditActorRef,
} from '@/modules/audit'
import {
  findActiveCountryByIso,
  findActiveLanguageByCode,
  isLanguageConfiguredForCountry,
} from '@/modules/country-locale'

import { hashPassword, verifyPassword } from './password'
import { generateToken, hashToken, sessionExpiry } from './token'
import type { AuthContext, PublicSession, PublicUser, TokenGrant } from './types'
import type { LoginInput, RegisterInput } from './validation'

// ---------- Typed domain errors (mapped to HTTP by route handlers) ----------

export type AuthErrorCode =
  | 'EMAIL_TAKEN'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'INVALID_COUNTRY'
  | 'INVALID_LANGUAGE'
  | 'LANGUAGE_NOT_AVAILABLE_IN_COUNTRY'
  | 'SESSION_NOT_FOUND'

const ERROR_STATUS: Record<AuthErrorCode, number> = {
  EMAIL_TAKEN: 409,
  INVALID_CREDENTIALS: 401,
  ACCOUNT_NOT_ACTIVE: 403,
  INVALID_COUNTRY: 400,
  INVALID_LANGUAGE: 400,
  LANGUAGE_NOT_AVAILABLE_IN_COUNTRY: 400,
  SESSION_NOT_FOUND: 404,
}

export class AuthError extends Error {
  readonly code: AuthErrorCode
  readonly status: number

  constructor(code: AuthErrorCode, message: string) {
    super(message)
    this.name = 'AuthError'
    this.code = code
    this.status = ERROR_STATUS[code]
  }
}

// ---------- Serialization ----------

type UserWithRelations = Prisma.UserGetPayload<{
  include: { homeCountry: true, preferredLanguage: true, languageScope: true }
}>

function toPublicUser(user: UserWithRelations): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    authMethod: user.authMethod,
    emailVerified: user.emailVerifiedAt !== null,
    homeCountry: user.homeCountry
      ? { isoCode: user.homeCountry.isoCode, name: user.homeCountry.name }
      : null,
    preferredLanguage: user.preferredLanguage
      ? { code: user.preferredLanguage.code, name: user.preferredLanguage.name }
      : null,
    languageScope: user.languageScope
      ? { code: user.languageScope.code, name: user.languageScope.name }
      : null,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  }
}

function toPublicSession(
  session: Prisma.AuthSessionGetPayload<Record<string, never>>,
  isCurrent = false
): PublicSession {
  return {
    id: session.id,
    label: session.label ?? 'Unnamed session',
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    revoked: session.revokedAt !== null,
    ...(isCurrent ? { isCurrent: true } : {}),
  }
}

// ---------- Session label ----------

function deriveLabel(userAgent: string | null, provided?: string): string {
  if (provided) return provided
  const ua = userAgent?.toLowerCase() ?? ''
  if (ua.includes('iphone') || ua.includes('android') || ua.includes('mobile')) {
    return 'Mobile device'
  }
  if (ua.includes('curl') || ua.includes('node') || ua.includes('bun')) {
    return 'API client'
  }
  return 'Web browser'
}

// ---------- Request context (audit trail, §30) ----------

export interface AuthRequestMeta {
  userAgent: string | null
  ip?: string | null
}

/** Builds the shared permission actor (P1-S5): role + resolved home country. */
export async function actorFromUser(user: PublicUser): Promise<Actor> {
  const iso = user.homeCountry?.isoCode
  const country = iso ? await findActiveCountryByIso(iso) : null
  // §18/§20: resolve the explicit staff language scope (null = no narrowing).
  let languageScopeId: string | null = null
  if (user.languageScope?.code) {
    const language = await findActiveLanguageByCode(user.languageScope.code)
    languageScopeId = language?.id ?? null
  }
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    countryId: country?.id ?? null,
    languageScopeId,
  }
}

/** Records a failed login attempt (security signal for admins — §30). */
async function noteLoginFailure(
  attemptedEmail: string,
  reason: string,
  meta: AuthRequestMeta
): Promise<void> {
  await recordAudit({
    actor: null,
    action: AUDIT_ACTIONS.userLoginFailed,
    objectType: AUDIT_OBJECT_TYPES.user,
    objectLabel: attemptedEmail,
    metadata: { attemptedEmail, reason },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })
}

// ---------- Registration ----------

export async function registerUser(
  input: RegisterInput,
  meta: AuthRequestMeta = { userAgent: null }
): Promise<{ user: PublicUser; grant: TokenGrant }> {
  const existing = await db.user.findUnique({ where: { email: input.email } })
  if (existing) {
    throw new AuthError('EMAIL_TAKEN', 'An account with this email already exists')
  }

  // Optional scoping dimensions (§14): resolved & validated server-side via
  // the country-locale module (single source of locale truth since P1-S3).
  let homeCountryId: string | undefined
  if (input.homeCountryIso) {
    const iso = input.homeCountryIso.toUpperCase()
    const country = await findActiveCountryByIso(iso)
    if (!country) {
      throw new AuthError('INVALID_COUNTRY', `Country "${iso}" is not available on GlobIQ yet`)
    }
    homeCountryId = country.id
  }

  let preferredLanguageId: string | undefined
  if (input.preferredLanguageCode) {
    const code = input.preferredLanguageCode.toLowerCase()
    const language = await findActiveLanguageByCode(code)
    if (!language) {
      throw new AuthError('INVALID_LANGUAGE', `Language "${code}" is not available`)
    }
    preferredLanguageId = language.id

    // §35: languages are configured per country — never a global free-for-all.
    if (homeCountryId && !(await isLanguageConfiguredForCountry(homeCountryId, language.id))) {
      throw new AuthError(
        'LANGUAGE_NOT_AVAILABLE_IN_COUNTRY',
        `Language "${code}" is not available in the selected country`
      )
    }
  }

  const passwordHash = await hashPassword(input.password)
  const { user, token, session } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email,
        name: input.name,
        passwordHash,
        homeCountryId,
        preferredLanguageId,
      },
      include: { homeCountry: true, preferredLanguage: true, languageScope: true },
    })

    const token = generateToken()
    const session = await tx.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        label: deriveLabel(meta.userAgent, input.label),
        expiresAt: sessionExpiry(),
      },
    })
    return { user, token, session }
  })

  const publicUser = toPublicUser(user)
  await recordAudit({
    actor: { userId: user.id, email: user.email, role: user.role },
    action: AUDIT_ACTIONS.userRegister,
    objectType: AUDIT_OBJECT_TYPES.user,
    objectId: user.id,
    objectLabel: user.email,
    after: publicUser,
    metadata: {
      homeCountryIso: input.homeCountryIso ?? null,
      preferredLanguageCode: input.preferredLanguageCode ?? null,
      sessionId: session.id,
    },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return {
    user: publicUser,
    grant: buildGrant(token, session),
  }
}

// ---------- Login ----------

export async function loginWithPassword(
  input: LoginInput,
  meta: AuthRequestMeta = { userAgent: null }
): Promise<{ user: PublicUser; grant: TokenGrant }> {
  const user = await db.user.findUnique({
    where: { email: input.email },
    include: { homeCountry: true, preferredLanguage: true, languageScope: true },
  })

  // Uniform error for unknown email / wrong password (§30 — no user enumeration).
  if (!user || user.status === 'DELETED' || !user.passwordHash) {
    await noteLoginFailure(input.email, 'UNKNOWN_ACCOUNT', meta)
    throw new AuthError('INVALID_CREDENTIALS', 'Incorrect email or password')
  }
  if (user.status === 'SUSPENDED') {
    await noteLoginFailure(input.email, 'ACCOUNT_SUSPENDED', meta)
    throw new AuthError('ACCOUNT_NOT_ACTIVE', 'This account is suspended. Contact support.')
  }
  if (!(await verifyPassword(input.password, user.passwordHash))) {
    await noteLoginFailure(input.email, 'WRONG_PASSWORD', meta)
    throw new AuthError('INVALID_CREDENTIALS', 'Incorrect email or password')
  }

  const token = generateToken()
  const [session] = await db.$transaction([
    db.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        label: deriveLabel(meta.userAgent, input.label),
        expiresAt: sessionExpiry(),
      },
    }),
    db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
  ])

  const publicUser = toPublicUser({ ...user, lastLoginAt: new Date() })
  await recordAudit({
    actor: { userId: user.id, email: user.email, role: user.role },
    action: AUDIT_ACTIONS.userLogin,
    objectType: AUDIT_OBJECT_TYPES.user,
    objectId: user.id,
    objectLabel: user.email,
    after: { lastLoginAt: publicUser.lastLoginAt },
    metadata: { method: 'password', sessionLabel: session.label },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent,
  })

  return {
    user: publicUser,
    grant: buildGrant(token, session),
  }
}

function buildGrant(token: string, session: Prisma.AuthSessionGetPayload<Record<string, never>>): TokenGrant {
  return {
    token,
    tokenType: 'Bearer',
    expiresAt: session.expiresAt.toISOString(),
    session: toPublicSession(session, true),
  }
}

// ---------- Request authentication (used by every protected route) ----------

const THROTTLE_LAST_USED_MS = 60_000

export async function authenticateRequest(request: Request): Promise<AuthContext | null> {
  const header = request.headers.get('authorization') ?? ''
  const [scheme, token] = header.split(' ')
  if (scheme?.toLowerCase() !== 'bearer' || !token?.startsWith('globiq_')) return null

  const session = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { homeCountry: true, preferredLanguage: true, languageScope: true } } },
  })
  if (!session || session.revokedAt || session.expiresAt <= new Date()) return null
  if (session.user.status !== 'ACTIVE') return null

  // Touch the session at most once a minute — avoids a write on every request.
  if (Date.now() - session.lastUsedAt.getTime() > THROTTLE_LAST_USED_MS) {
    await db.authSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    })
    session.lastUsedAt = new Date()
  }

  return {
    user: toPublicUser(session.user),
    session: toPublicSession(session, true),
    isCurrentSession: true,
  }
}

// ---------- Session management ----------

export async function listSessions(userId: string, currentSessionId: string): Promise<PublicSession[]> {
  const sessions = await db.authSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: 'desc' },
  })
  return sessions.map((s) => toPublicSession(s, s.id === currentSessionId))
}

export async function revokeSessionById(
  userId: string,
  sessionId: string,
  actor?: AuditActorRef
): Promise<PublicSession> {
  const session = await db.authSession.findFirst({
    where: { id: sessionId, userId, revokedAt: null, expiresAt: { gt: new Date() } },
  })
  if (!session) {
    throw new AuthError('SESSION_NOT_FOUND', 'Active session not found')
  }
  const revoked = await db.authSession.update({
    where: { id: session.id },
    data: { revokedAt: new Date() },
  })
  await recordAudit({
    actor: actor ?? null,
    action: AUDIT_ACTIONS.sessionRevoke,
    objectType: AUDIT_OBJECT_TYPES.authSession,
    objectId: session.id,
    objectLabel: session.label ?? 'Unnamed session',
    before: { label: session.label, lastUsedAt: session.lastUsedAt.toISOString() },
    after: { revokedAt: revoked.revokedAt?.toISOString() ?? null },
  })
  return toPublicSession(revoked)
}

/** Logout: revoke the session that presented the current Bearer token. */
export async function revokeCurrentSession(
  sessionId: string,
  actor?: AuditActorRef,
  meta: { ip?: string | null; userAgent?: string | null } = {}
): Promise<void> {
  const session = await db.authSession.findUnique({ where: { id: sessionId } })
  await db.authSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  })
  await recordAudit({
    actor: actor ?? null,
    action: AUDIT_ACTIONS.userLogout,
    objectType: AUDIT_OBJECT_TYPES.authSession,
    objectId: sessionId,
    objectLabel: session?.label ?? 'Unnamed session',
    before: { label: session?.label ?? null, revoked: false },
    after: { revoked: true },
    ip: meta.ip ?? null,
    userAgent: meta.userAgent ?? null,
  })
}

// Re-export for consumers of the module's public interface.
export { toPublicUser, toPublicSession }

/** Maps a thrown AuthError to the standard API error envelope (§37). */
export function toAuthErrorResponse(error: unknown): { message: string; code: AuthErrorCode; status: number } | null {
  if (error instanceof AuthError) {
    return { message: error.message, code: error.code, status: error.status }
  }
  return null
}
