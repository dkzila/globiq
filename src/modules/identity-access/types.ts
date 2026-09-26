/**
 * GlobIQ — Identity & Access: public DTOs
 * Master Plan §37: client-agnostic shapes; never leak internal secrets
 * (passwordHash, tokenHash) or raw tokens in user/session payloads.
 */

export interface PublicUser {
  id: string
  email: string
  name: string | null
  role: 'READER' | 'WRITER' | 'COUNTRY_ADMIN' | 'ADMIN'
  status: 'ACTIVE' | 'SUSPENDED' | 'DELETED'
  authMethod: 'PASSWORD'
  emailVerified: boolean
  homeCountry: { isoCode: string; name: string } | null
  preferredLanguage: { code: string; name: string } | null
  /** §18/§20 staff language scope (WRITER narrowing; null = unset/READER). */
  languageScope: { code: string; name: string } | null
  createdAt: string
  lastLoginAt: string | null
}

export interface PublicSession {
  id: string
  label: string
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  revoked: boolean
  /** Present only when the session belongs to the caller's presented token. */
  isCurrent?: boolean
}

/** Returned exactly once by register/login — the client must store it. */
export interface TokenGrant {
  token: string
  tokenType: 'Bearer'
  expiresAt: string
  session: PublicSession
}

export interface AuthContext {
  user: PublicUser
  session: PublicSession
  /** True when the request was made with the session whose token was presented. */
  isCurrentSession: true
}
