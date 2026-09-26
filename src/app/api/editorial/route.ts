/**
 * GET  /api/editorial — the Editorial module index (§38 surface map, §37
 *   client-agnostic contracts). Lists the workspace endpoints + the §19
 *   workflow the module implements.
 */
import { ok } from '@/lib/api/response'

export const dynamic = 'force-dynamic'

export async function GET() {
  return ok({
    module: 'editorial',
    purpose: 'Editorial workspace: the §6 EditorialTask board with §18 role rules, §19 workflow wiring and §20 staff scopes',
    endpoints: [
      { method: 'GET', path: '/api/editorial/tasks', auth: 'editorial:work', description: 'Task board — scope-filtered list, status summary, type facets' },
      { method: 'POST', path: '/api/editorial/tasks', auth: 'editorial:work (editors)', description: 'Create a work item on a content object' },
      { method: 'GET', path: '/api/editorial/tasks/{id}', auth: 'editorial:work', description: 'Task detail' },
      { method: 'PATCH', path: '/api/editorial/tasks/{id}', auth: 'editorial:work (editors)', description: 'Edit task (title/notes/priority/due/assignee)' },
      { method: 'POST', path: '/api/editorial/tasks/{id}/transition', auth: 'editorial:work', description: 'start · claim · resolve · cancel · reopen (§18 role rules apply)' },
      { method: 'GET', path: '/api/editorial/assignees', auth: 'content:publish (editors)', description: 'Assignable staff directory (§20 scopes)' },
    ],
    workflow: {
      // §19 steps the board represents (2–6 review types; 7 lives on the
      // content state machine: publish/schedule; 8–10 are post-publish).
      taskTypes: ['EDITORIAL_REVIEW', 'FACT_CHECK', 'LOCALISATION_REVIEW', 'SEO_REVIEW', 'EXAM_MAPPING_REVIEW', 'CORRECTION', 'GENERAL'],
      autoWiring: [
        'submit_review → auto-opens an EDITORIAL_REVIEW task (§19 step 2)',
        'publish / schedule → resolves the item’s open tasks',
        'send_back → resolves the cycle (re-submit opens a fresh review)',
        'retire → cancels the item’s open tasks (§19 step 10)',
      ],
    },
  })
}
