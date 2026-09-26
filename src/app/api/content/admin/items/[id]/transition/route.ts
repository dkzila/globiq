/**
 * POST /api/content/admin/items/{id}/transition — lifecycle transition
 * (Master Plan §19 workflow, completed in P2-S4):
 *
 *   DRAFT ─submit_review→ IN_REVIEW ─┬─publish→ PUBLISHED ─retire→ RETIRED
 *              ▲   │ └─schedule→ SCHEDULED ─┬─publish (due / publish-now)─┐
 *              │   └──send_back──→ DRAFT    └──send_back (unschedule)     │
 *              └──────────────────────── retire ──→ RETIRED ←────────────┘
 *
 * `publish` snapshots the working copy into an immutable ContentRevision and
 * moves the live pointer. Re-publishing live content requires a changeSummary
 * (§25/§36 correction provenance) and refuses no-op publishes (NO_CHANGES).
 * Publishing requires the owning unit to be VERIFIED — a representation is
 * never more visible than its canonical record.
 * `schedule` (§19 step 7) requires a future `scheduledFor`; due SCHEDULED
 * items materialize to PUBLISHED lazily on read. publish/schedule/retire are
 * gated on `content:publish` — writers submit, editors release (§18).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  contentTransitionSchema,
  toContentErrorResponse,
  transitionContentItem,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`content:write:${clientIp(request)}`, RATE_LIMITS.contentWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = contentTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const item = await transitionContentItem(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ item })
  } catch (error) {
    const mapped = toContentErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/transition] unexpected error:', error)
    return fail('Could not transition the content item', 'INTERNAL_ERROR', 500)
  }
}
