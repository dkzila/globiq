/**
 * POST /api/editorial/tasks/{id}/transition — the board's own state machine
 *   (§19): start · claim · resolve · cancel · reopen. §18 role rules are
 *   enforced server-side: writers may claim unassigned in-scope tasks and
 *   start/resolve THEIR tasks; cancel/reopen are editor-only; a writer can
 *   never resolve the review of their own submission (separation of duties).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  editorialTaskTransitionSchema,
  toEditorialErrorResponse,
  transitionEditorialTask,
} from '@/modules/editorial'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'editorial:work')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`editorial:write:${clientIp(request)}`, RATE_LIMITS.editorialWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = editorialTaskTransitionSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const task = await transitionEditorialTask(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ task })
  } catch (error) {
    const mapped = toEditorialErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[editorial/tasks/transition] unexpected error:', error)
    return fail('Could not update the work item', 'INTERNAL_ERROR', 500)
  }
}
