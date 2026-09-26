/**
 * POST /api/knowledge/admin/units/{id}/transition — lifecycle transition
 * (Master Plan §36; the full editorial workflow with review roles lands in
 * P2-S4 — this is the KnowledgeUnit's own state machine):
 *
 *   DRAFT ─submit_review→ IN_REVIEW ─verify→ VERIFIED ─flag_outdated→ OUTDATED
 *     │                       │                    │                      │
 *     └───────────────────────┴──────archive───────┴──────archive────────┘
 *                                  → ARCHIVED (read-only, end-of-life)
 *
 * IN_REVIEW ─send_back→ DRAFT · OUTDATED ─reverify→ VERIFIED
 * flag_outdated requires a reason (§25/§36 correction provenance).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  knowledgeTransitionSchema,
  toKnowledgeErrorResponse,
  transitionKnowledgeUnit,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'knowledge:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`knowledge:write:${clientIp(request)}`, RATE_LIMITS.knowledgeWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = knowledgeTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const unit = await transitionKnowledgeUnit(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ unit })
  } catch (error) {
    const mapped = toKnowledgeErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[knowledge/admin/transition] unexpected error:', error)
    return fail('Could not transition the knowledge unit', 'INTERNAL_ERROR', 500)
  }
}
