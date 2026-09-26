/**
 * GlobIQ — Identity & Access: bearer token utilities
 * Master Plan §4/§39 (token-based from Phase 1 — apps cannot rely on cookies).
 *
 * Design: opaque high-entropy tokens (not JWTs). Only the SHA-256 hash is
 * stored (AuthSession.tokenHash); the raw token is returned exactly once and
 * lives solely with the client. This keeps sessions revocable server-side
 * (§30) — impossible with stateless JWTs — and stays client-agnostic.
 */
import { createHash, randomBytes } from 'node:crypto'

/** Prefix makes GlobIQ tokens recognizable in logs and credential scanners. */
export const TOKEN_PREFIX = 'globiq_'

/** Session lifetime. Refresh/renewal strategy is intentionally deferred (§41). */
export const SESSION_TTL_DAYS = 30

/** Generates a new raw token, e.g. `globiq_9f3a…` (256 bits of entropy). */
export function generateToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url')
}

/** SHA-256 hex digest of the raw token — the only value ever persisted. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function sessionExpiry(from = new Date()): Date {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)
}
