/**
 * PUT /api/countries/[iso]/languages — admin: replace the full set of
 * languages a country exposes (§35: each country exposes ONLY its own
 * configured languages; the default language must stay in the set).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  setCountryLanguages,
  setCountryLanguagesSchema,
  toLocaleErrorResponse,
} from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function PUT(request: Request, { params }: { params: Promise<{ iso: string }> }) {
  const auth = await requirePermission(request, 'country-config:manage')
  if (auth instanceof NextResponse) return auth

  const { iso } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = setCountryLanguagesSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const country = await setCountryLanguages(auth.actor, iso, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ country })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/set-languages] unexpected error:', error)
    return fail('Could not configure the country languages', 'INTERNAL_ERROR', 500)
  }
}
