/**
 * GET  /api/editorial/tasks?status=&type=&priority=&assignee=&country=&q= —
 *   the §6/§19 task board, scope-filtered (§20): ADMIN sees everything
 *   (global + every country); COUNTRY_ADMIN sees their country workspace;
 *   WRITER sees their country + language scope. Payload includes a
 *   filter-coherent status summary + type facets.
 * POST /api/editorial/tasks — editors only (§18): create a work item on a
 *   ContentItem (the §6 object_id). The task inherits the content's country
 *   and language scope; assignees are validated against §20 staff scopes.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  createEditorialTask,
  createEditorialTaskSchema,
  editorialTaskListQuerySchema,
  getEditorialTasks,
  toEditorialErrorResponse,
} from '@/modules/editorial'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'editorial:work')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`editorial:read:${clientIp(request)}`, RATE_LIMITS.editorialRead)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const url = new URL(request.url)
  const parsed = editorialTaskListQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    type: url.searchParams.get('type') ?? undefined,
    priority: url.searchParams.get('priority') ?? undefined,
    assignee: url.searchParams.get('assignee') ?? undefined,
    country: url.searchParams.get('country') ?? undefined,
    q: url.searchParams.get('q') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return errors.badRequest('Invalid workspace query parameters', parsed.error.flatten().fieldErrors)
  }

  try {
    const result = await getEditorialTasks(auth.actor, parsed.data)
    return ok(result)
  } catch (error) {
    const mapped = toEditorialErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[editorial/tasks/list] unexpected error:', error)
    return fail('Could not load the editorial board', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission(request, 'editorial:work')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`editorial:write:${clientIp(request)}`, RATE_LIMITS.editorialWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createEditorialTaskSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  try {
    const task = await createEditorialTask(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ task }, { status: 201 })
  } catch (error) {
    const mapped = toEditorialErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[editorial/tasks/create] unexpected error:', error)
    return fail('Could not create the work item', 'INTERNAL_ERROR', 500)
  }
}
