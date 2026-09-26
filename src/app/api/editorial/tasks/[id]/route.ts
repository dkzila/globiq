/**
 * GET   /api/editorial/tasks/{id} — task detail (scope-checked §20).
 * PATCH /api/editorial/tasks/{id} — editors only (§18): edit title/notes/
 *   priority/dueAt or reassign (assignee validated against §20 staff scopes;
 *   null clears the assignment back to the unclaimed pool).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getEditorialTask,
  toEditorialErrorResponse,
  updateEditorialTask,
  updateEditorialTaskSchema,
} from '@/modules/editorial'

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(request, 'editorial:work')
  if (auth instanceof NextResponse) return auth

  const { id } = await params

  try {
    const task = await getEditorialTask(auth.actor, id)
    return ok({ task })
  } catch (error) {
    const mapped = toEditorialErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[editorial/tasks/detail] unexpected error:', error)
    return fail('Could not load the work item', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(
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

  const parsed = updateEditorialTaskSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const task = await updateEditorialTask(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ task })
  } catch (error) {
    const mapped = toEditorialErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[editorial/tasks/update] unexpected error:', error)
    return fail('Could not update the work item', 'INTERNAL_ERROR', 500)
  }
}
