/**
 * /api/taxonomy/admin/nodes/{id} — admin node operations:
 *   GET    → full editing state (labels, aliases, path, permissions)
 *   PATCH  → update canonicalName/description/orderIndex/status or move (§36)
 *   DELETE → retire (soft-delete; leaf-first, reversible)
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requireRole } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  getAdminTopic,
  retireTopic,
  topicActorFromAuth,
  toTaxonomyErrorResponse,
  updateTopic,
  updateTopicSchema,
} from '@/modules/taxonomy'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['ADMIN', 'COUNTRY_ADMIN'])
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const actor = await topicActorFromAuth(auth.user)
    const topic = await getAdminTopic(actor, id)
    return ok({ topic })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/admin/get] unexpected error:', error)
    return fail('Could not load the node', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  const parsed = updateTopicSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  const { id } = await params
  try {
    const actor = await topicActorFromAuth(auth.user)
    const topic = await updateTopic(actor, id, parsed.data)
    return ok({ topic })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/admin/update] unexpected error:', error)
    return fail('Could not update the node', 'INTERNAL_ERROR', 500)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole(request, ['ADMIN', 'COUNTRY_ADMIN'])
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`taxonomy:write:${clientIp(request)}`, RATE_LIMITS.taxonomyWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  const { id } = await params
  try {
    const actor = await topicActorFromAuth(auth.user)
    const topic = await retireTopic(actor, id)
    return ok({ topic })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/admin/retire] unexpected error:', error)
    return fail('Could not retire the node', 'INTERNAL_ERROR', 500)
  }
}
