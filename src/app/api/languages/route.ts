/**
 * GET  /api/languages — privileged staff: platform language table (§38 admin
 *   surface; public consumers must discover languages via /api/countries,
 *   never a global list — §35). Anyone who can manage taxonomy (ADMIN +
 *   COUNTRY_ADMIN, for label editing since P1-S4) may read; writes stay
 *   ADMIN-only (`language:manage`).
 * POST /api/languages — admin: add a language to the platform.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  createLanguage,
  createLanguageSchema,
  listAdminLanguages,
  toLocaleErrorResponse,
} from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const auth = await requirePermission(request, 'taxonomy:manage')
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
  const auth = await requirePermission(request, 'language:manage')
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
    const language = await createLanguage(auth.actor, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ language }, { status: 201 })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[languages/create] unexpected error:', error)
    return fail('Could not create the language', 'INTERNAL_ERROR', 500)
  }
}
