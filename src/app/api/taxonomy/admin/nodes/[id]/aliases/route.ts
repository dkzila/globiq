/**
 * PUT /api/taxonomy/admin/nodes/{id}/aliases — replace the node's aliases
 * (Master Plan §13 "aliases" — alternate search terms, optionally per language).
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireRole } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  setTopicAliases,
  setTopicAliasesSchema,
  topicActorFromAuth,
  toTaxonomyErrorResponse,
} from '@/modules/taxonomy'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = setTopicAliasesSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  const { id } = await params
  try {
    const actor = await topicActorFromAuth(auth.user)
    const topic = await setTopicAliases(actor, id, parsed.data)
    return ok({ topic })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/admin/aliases] unexpected error:', error)
    return fail('Could not update the aliases', 'INTERNAL_ERROR', 500)
  }
}
