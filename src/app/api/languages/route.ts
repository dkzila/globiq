/**
 * GET  /api/languages — privileged staff: platform language table (§38 admin
 *   surface; public consumers must discover languages via /api/countries,
 *   never a global list — §35). COUNTRY_ADMIN needs the read for taxonomy
 *   label editing (P1-S4); writes stay ADMIN-only.
 * POST /api/languages — admin: add a language to the platform.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requireRole } from '@/lib/api/guard'
import { fieldErrors } from '@/lib/validation'
import {
  createLanguage,
  createLanguageSchema,
  listAdminLanguages,
  toLocaleErrorResponse,
} from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requireRole(request, ['ADMIN', 'COUNTRY_ADMIN'])
  if (auth instanceof NextResponse) return auth

  try {
    const languages = await listAdminLanguages()
    return ok({ languages })
  } catch (error) {
    console.error('[languages/list] unexpected error:', error)
    return fail('Could not load languages', 'INTERNAL_ERROR', 500)
  }
}

export async function POST(request: Request) {
  const auth = await requireRole(request, ['ADMIN'])
  if (auth instanceof NextResponse) return auth

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = createLanguageSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const language = await createLanguage(parsed.data)
    return ok({ language }, { status: 201 })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[languages/create] unexpected error:', error)
    return fail('Could not create the language', 'INTERNAL_ERROR', 500)
  }
}
