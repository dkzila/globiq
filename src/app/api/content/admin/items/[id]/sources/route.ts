/**
 * GET  /api/content/admin/items/{id}/sources — the evidence attached to one
 *   content item (§24 provenance links: claim/content-level attribution).
 *   Read access follows the module's read/manage split: COUNTRY_ADMIN views
 *   global items' citations read-only (content parity, §38).
 * POST /api/content/admin/items/{id}/sources — attach evidence
 *   ({ source: <id>, claim? }). `content:manage` on the item's unit-country
 *   scope (§14/§20 — country admins may only manage their own market's
 *   content); UNRELIABLE evidence cannot be attached to new content.
 */
import { NextResponse } from 'next/server'

import { errors, fail, ok } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { checkRateLimit, clientIp, RATE_LIMITS } from '@/lib/rate-limit'
import {
  linkSourceSchema,
  linkSourceToItem,
  listContentSources,
  toSourceErrorResponse,
} from '@/modules/knowledge'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const { id } = await params
  try {
    const result = await listContentSources(auth.actor, id)
    return ok(result)
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/sources/list] unexpected error:', error)
    return fail('Could not load the item sources', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission(request, 'content:manage')
  if (auth instanceof NextResponse) return auth

  const limit = checkRateLimit(`source:write:${clientIp(request)}`, RATE_LIMITS.sourceWrite)
  if (!limit.allowed) return errors.rateLimited(limit.retryAfterSec)

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = linkSourceSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', parsed.error.flatten().fieldErrors)
  }

  const { id } = await params
  try {
    const link = await linkSourceToItem(auth.actor, id, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ link }, { status: 201 })
  } catch (error) {
    const mapped = toSourceErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[content/admin/sources/link] unexpected error:', error)
    return fail('Could not attach the source', 'INTERNAL_ERROR', 500)
  }
}
