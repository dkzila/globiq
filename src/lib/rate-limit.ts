/**
 * GlobIQ — In-memory rate limiting (Master Plan §30: rate limiting).
 *
 * Deliberately simple sliding-window counters keyed by route + client IP.
 * Sufficient for the single-instance dev/preview stage; §29 (Infrastructure
 * Evolution) replaces this with a shared store when we scale out — the
 * `checkRateLimit` signature stays stable for that swap.
 */

interface RateLimitOptions {
  /** Max allowed requests within the window. */
  limit: number
  /** Window length in milliseconds. */
  windowMs: number
}

interface RateLimitResult {
  allowed: boolean
  /** Remaining requests in the current window (never negative). */
  remaining: number
  /** Seconds until the oldest request leaves the window (0 = retry now). */
  retryAfterSec: number
}

const buckets = new Map<string, number[]>()
const MAX_BUCKETS = 10_000

function sweepIfNeeded(now: number, windowMs: number): void {
  if (buckets.size <= MAX_BUCKETS) return
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((t) => now - t < windowMs)
    if (fresh.length === 0) buckets.delete(key)
    else buckets.set(key, fresh)
  }
}

/** Extracts the caller IP from standard proxy headers (Vercel/Caddy). */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

export function checkRateLimit(key: string, { limit, windowMs }: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  sweepIfNeeded(now, windowMs)

  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)

  if (hits.length >= limit) {
    const retryAfterMs = windowMs - (now - hits[0]!)
    return {
      allowed: false,
      remaining: 0,
      retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    }
  }

  hits.push(now)
  buckets.set(key, hits)
  return { allowed: true, remaining: limit - hits.length, retryAfterSec: 0 }
}

/** Auth endpoint limits (§30): generous for humans, hostile to brute force. */
export const RATE_LIMITS = {
  register: { limit: 5, windowMs: 60 * 60 * 1000 }, // 5/hour per IP
  login: { limit: 10, windowMs: 15 * 60 * 1000 }, // 10/15min per IP
  taxonomyRead: { limit: 60, windowMs: 60 * 1000 }, // public tree/detail/search per IP
  taxonomyWrite: { limit: 30, windowMs: 60 * 1000 }, // admin taxonomy mutations per IP
  auditRead: { limit: 60, windowMs: 60 * 1000 }, // admin audit trail reads per IP
  knowledgeRead: { limit: 60, windowMs: 60 * 1000 }, // public knowledge list/detail per IP
  knowledgeWrite: { limit: 30, windowMs: 60 * 1000 }, // admin knowledge mutations per IP
} as const
