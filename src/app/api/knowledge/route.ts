/**
 * GET /api/knowledge — endpoint index for the knowledge module (Master Plan §37).
 */
import { ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const ENDPOINTS = [
  { method: 'GET', path: '/api/knowledge/units?topic=', auth: null, purpose: 'Public VERIFIED units under one visible topic (§7 canonical record, §14 country scope)' },
  { method: 'GET', path: '/api/knowledge/units/{slug}', auth: null, purpose: 'Public unit detail: canonical fact + body + topic path (§22)' },
  { method: 'GET', path: '/api/knowledge/page/{slug}?country=&language=', auth: null, purpose: 'The assembled §22 knowledge page: quick fact, deeper representations by format, sources, related concepts, exam-coverage placeholder, canonical path + translations (P2-S5)' },
  { method: 'GET', path: '/api/knowledge/admin/units', auth: 'knowledge:manage', purpose: 'Admin list (all lifecycle statuses, scoped)' },
  { method: 'POST', path: '/api/knowledge/admin/units', auth: 'knowledge:manage', purpose: 'Create a unit (enters DRAFT; dedup by canonical identity §11)' },
  { method: 'GET', path: '/api/knowledge/admin/units/{id}', auth: 'knowledge:manage', purpose: 'Admin unit detail (editing state + allowed transitions)' },
  { method: 'PATCH', path: '/api/knowledge/admin/units/{id}', auth: 'knowledge:manage', purpose: 'Update fields (editability per status — §36 VERIFIED body locked)' },
  { method: 'POST', path: '/api/knowledge/admin/units/{id}/transition', auth: 'knowledge:manage', purpose: 'Lifecycle transition (DRAFT→IN_REVIEW→VERIFIED→…→ARCHIVED)' },
] as const

export async function GET() {
  return ok({
    module: 'knowledge',
    spec: 'Master Plan §7 (Knowledge Unit vs Content Item), §11 (dedup), §14 (country scope), §22 (knowledge page), §36 (lifecycle)',
    lifecycle: ['DRAFT', 'IN_REVIEW', 'VERIFIED', 'OUTDATED', 'ARCHIVED'],
    publicVisibility: 'VERIFIED only',
    readingPage: '§22 layers: quickFact → representations (format-aware) → sources → related → examCoverage (P3 placeholder)',
    endpoints: ENDPOINTS,
  })
}
