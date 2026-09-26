/**
 * GET /api/content — endpoint index for the content + provenance layers of the
 * knowledge module (Master Plan §37). ContentItems are publishable
 * representations of a KnowledgeUnit (§7): one language × one format each,
 * with immutable published revisions (§36). Sources are the §24 evidence
 * registry: provenance records with an editor verification workflow, cited by
 * content objects via claim/content-level links.
 */
import { ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

const ENDPOINTS = [
  { method: 'GET', path: '/api/content/items?unit=', auth: null, purpose: 'Public PUBLISHED representations of one unit (live revisions only — §7/§22)' },
  { method: 'GET', path: '/api/content/items/{id}', auth: null, purpose: 'Public content detail — live revision snapshot + §24 provenance (sources, aiAssisted)' },
  { method: 'GET', path: '/api/content/admin/items', auth: 'content:manage', purpose: 'Admin list (all statuses, scoped; working copy + live revision)' },
  { method: 'POST', path: '/api/content/admin/items', auth: 'content:manage', purpose: 'Create a representation (DRAFT; one per unit+language+format — §7)' },
  { method: 'GET', path: '/api/content/admin/items/{id}', auth: 'content:manage', purpose: 'Admin item detail (editing state + affordances)' },
  { method: 'PATCH', path: '/api/content/admin/items/{id}', auth: 'content:manage', purpose: 'Edit the working copy (staged for published items — §19)' },
  { method: 'POST', path: '/api/content/admin/items/{id}/transition', auth: 'content:manage', purpose: 'Lifecycle transition (publish appends an immutable revision — §36)' },
  { method: 'GET', path: '/api/content/admin/items/{id}/revisions', auth: 'content:manage', purpose: 'Full revision history — the preserved versions (§36)' },
  { method: 'GET', path: '/api/content/admin/items/{id}/sources', auth: 'content:manage', purpose: 'Evidence attached to an item (§24 claim/content-level links)' },
  { method: 'POST', path: '/api/content/admin/items/{id}/sources', auth: 'content:manage', purpose: 'Attach evidence to an item (UNRELIABLE sources refused — §24)' },
  { method: 'PATCH', path: '/api/content/admin/items/{id}/sources/{linkId}', auth: 'content:manage', purpose: 'Edit a citation\u2019s claim-level attribution (§24)' },
  { method: 'DELETE', path: '/api/content/admin/items/{id}/sources/{linkId}', auth: 'content:manage', purpose: 'Detach evidence (link removed + audited; Source record preserved — §36)' },
  { method: 'GET', path: '/api/content/admin/sources?q=&type=&verification=', auth: 'source:manage', purpose: 'Evidence registry with verification summary (§24)' },
  { method: 'POST', path: '/api/content/admin/sources', auth: 'source:manage', purpose: 'Register evidence (one canonical record per normalized URL)' },
  { method: 'GET', path: '/api/content/admin/sources/{id}', auth: 'source:manage', purpose: 'Evidence detail + where it is cited (scope-filtered, §20)' },
  { method: 'PATCH', path: '/api/content/admin/sources/{id}', auth: 'source:manage', purpose: 'Metadata corrections (audited; never deleted — §36)' },
  { method: 'POST', path: '/api/content/admin/sources/{id}/verify', auth: 'source:manage', purpose: 'Verification workflow: verify / reject / recheck (§24)' },
] as const

export async function GET() {
  return ok({
    module: 'knowledge/content',
    spec: 'Master Plan §7 (representation of a canonical record), §19 (immutable at revision level), §23 (formats), §24 (sources & trust), §35 (per-country languages), §36 (revisions)',
    lifecycle: ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'RETIRED'],
    formats: ['FACT_CARD', 'EXPLAINER', 'REVISION_NOTE', 'CURRENT_EVENT_UPDATE', 'TIMELINE', 'PROFILE', 'COMPARISON'],
    sourceTypes: ['OFFICIAL', 'NEWS_MEDIA', 'INSTITUTIONAL', 'ACADEMIC', 'DATA', 'OTHER'],
    sourceVerification: ['UNVERIFIED', 'VERIFIED', 'UNRELIABLE'],
    publicVisibility: 'PUBLISHED items of VERIFIED units (live revision only; sources ride the same chain)',
    endpoints: ENDPOINTS,
  })
}
