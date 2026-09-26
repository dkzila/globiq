/**
 * POST /api/taxonomy/admin/nodes — create a taxonomy node.
 * ADMIN: any node (incl. root domains). COUNTRY_ADMIN: only own-country
 * extensions, never roots (Master Plan §13 country extensions, §38 scoping).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireRole } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import { createTopic, createTopicSchema, topicActorFromAuth, toTaxonomyErrorResponse } from '@/modules/taxonomy'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const auth = await requireRole(request, ['ADMIN', 'COUNTRY_ADMIN'])
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`taxonomy:write:${clientIp(request)}`, RATE_LIMITS.taxonomyWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createTopicSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const actor = await topicActorFromAuth(auth.user)
    const topic = await createTopic(actor, parsed.data)
    return ok({ topic }, { status: 201 })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/admin/create] unexpected error:', error)
    return fail('Could not create the node', 'INTERNAL_ERROR', 500)
  }
}
