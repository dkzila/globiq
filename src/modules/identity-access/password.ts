/**
 * GlobIQ — Identity & Access: password hashing
 * Master Plan §30 (Security): secure authentication without native dependencies.
 *
 * Uses Node's built-in scrypt (memory-hard KDF, OWASP-approved) — no external
 * crypto dependency, works identically in dev (Bun) and on Vercel.
 *
 * Stored format: `scrypt:<N>:<r>:<p>:<salt-b64>:<hash-b64>`
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number }
) => Promise<Buffer>

// OWASP-recommended interactive-login parameters (2024+).
const PARAMS = { N: 16384, r: 8, p: 1 } as const
const KEY_LENGTH = 64

/** Hash a plaintext password into the storage format. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS)
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join(':')
}

/** Constant-time verification of a plaintext password against a stored hash. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false

  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')

  const actual = await scrypt(password, salt, expected.length, { N, r, p })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
