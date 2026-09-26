/**
 * GlobIQ — Identity & Access module (Master Plan §28, §43 P1-S2)
 *
 * Public interface of the module. Other modules and route handlers import
 * from here only — internal files may change without notice (modular
 * monolith rule: explicit interfaces, §28).
 */
export {
  AuthError,
  registerUser,
  loginWithPassword,
  authenticateRequest,
  actorFromUser,
  listSessions,
  revokeSessionById,
  revokeCurrentSession,
  toPublicUser,
  toAuthErrorResponse,
} from './service'
export type { AuthRequestMeta } from './service'
export { hashPassword, verifyPassword } from './password'
export {
  generateToken,
  hashToken,
  sessionExpiry,
  TOKEN_PREFIX,
  SESSION_TTL_DAYS,
} from './token'
export { registerSchema, loginSchema, fieldErrors } from './validation'
export type { RegisterInput, LoginInput } from './validation'
export type { PublicUser, PublicSession, TokenGrant, AuthContext } from './types'
