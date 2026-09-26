/**
 * GET /api/taxonomy/admin/tree — full admin tree (all statuses).
 * ADMIN sees everything; COUNTRY_ADMIN sees global nodes + own-country
 * extensions (Master Plan §38 scoped surfaces).
 */
import { NextResponse } from 'next/server'

import { fail, ok } from '@/lib/api/response'
import { requireRole } from '@/lib/api/guard'
import { getAdminTree, topicActorFromAuth, toTaxonomyErrorResponse } from '@/modules/taxonomy'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireRole(request, ['ADMIN', 'COUNTRY_ADMIN'])
  if (auth instanceof NextResponse) return auth

  try {
    const actor = await topicActorFromAuth(auth.user)
    const tree = await getAdminTree(actor)
    const count = (nodes: typeof tree): number =>
      nodes.reduce((total, node) => total + 1 + count(node.children), 0)
    return ok({ actorRole: actor.role, scope: actor.role === 'ADMIN' ? 'global' : actor.countryId, nodeCount: count(tree), tree })
  } catch (error) {
    const mapped = toTaxonomyErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[taxonomy/admin/tree] unexpected error:', error)
    return fail('Could not load the admin tree', 'INTERNAL_ERROR', 500)
  }
}
