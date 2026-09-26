/**
 * GET /api/taxonomy — endpoint index for the taxonomy module (Master Plan §37).
 */
import { ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const ENDPOINTS = [
  { method: 'GET', path: '/api/taxonomy/tree', auth: null, purpose: 'Public taxonomy tree for a country/language context (§13)' },
  { method: 'GET', path: '/api/taxonomy/nodes/{slug}', auth: null, purpose: 'Public topic detail with path, labels, aliases' },
  { method: 'GET', path: '/api/taxonomy/search', auth: null, purpose: 'Search topics by name, slug, label or alias' },
  { method: 'GET', path: '/api/taxonomy/admin/tree', auth: 'ADMIN | COUNTRY_ADMIN', purpose: 'Full admin tree (all statuses, scoped)' },
  { method: 'POST', path: '/api/taxonomy/admin/nodes', auth: 'ADMIN | COUNTRY_ADMIN', purpose: 'Create a taxonomy node' },
  { method: 'GET', path: '/api/taxonomy/admin/nodes/{id}', auth: 'ADMIN | COUNTRY_ADMIN', purpose: 'Admin node detail (editing state)' },
  { method: 'PATCH', path: '/api/taxonomy/admin/nodes/{id}', auth: 'ADMIN | COUNTRY_ADMIN', purpose: 'Update name/description/order/status or move node' },
  { method: 'DELETE', path: '/api/taxonomy/admin/nodes/{id}', auth: 'ADMIN | COUNTRY_ADMIN', purpose: 'Retire (soft-delete, §36 migration-safe)' },
  { method: 'PUT', path: '/api/taxonomy/admin/nodes/{id}/labels', auth: 'ADMIN | COUNTRY_ADMIN', purpose: 'Replace language labels (§13)' },
  { method: 'PUT', path: '/api/taxonomy/admin/nodes/{id}/aliases', auth: 'ADMIN | COUNTRY_ADMIN', purpose: 'Replace aliases (§13)' },
] as const

export async function GET() {
  return ok({
    module: 'taxonomy',
    spec: 'Master Plan §13 (one global framework, country extensions), §36 (migration-safe)',
    endpoints: ENDPOINTS,
  })
}
