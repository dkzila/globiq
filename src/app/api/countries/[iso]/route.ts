/**
 * GET   /api/countries/[iso] — public country detail (accepts ISO code or
 *   slug). 404 for unknown or INACTIVE markets.
 * PATCH /api/countries/[iso] — admin: update country configuration. The
 *   default root market (India, served at "/") is immutable in slug/status
 *   (Master Plan §14/§16).
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import {
  getPublicCountry,
  toLocaleErrorResponse,
  updateCountry,
  updateCountrySchema,
} from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ iso: string }> }) {
  const { iso } = await params
  try {
    const country = await getPublicCountry(iso)
    if (!country) return errors.notFound(`Country "${iso}"`)
    return ok({ country })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/get] unexpected error:', error)
    return fail('Could not load the country', 'INTERNAL_ERROR', 500)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ iso: string }> }) {
  const auth = await requirePermission(request, 'country-config:manage')
  if (auth instanceof NextResponse) return auth

  const { iso } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateCountrySchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const country = await updateCountry(auth.actor, iso, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ country })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[countries/update] unexpected error:', error)
    return fail('Could not update the country', 'INTERNAL_ERROR', 500)
  }
}
