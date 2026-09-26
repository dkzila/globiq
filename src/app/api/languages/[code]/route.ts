/**
 * PATCH /api/languages/[code] — admin: update a language. Codes are stable
 * resource identifiers (§37) and therefore immutable. Deactivation is blocked
 * while any country still configures the language.
 */
import { NextResponse } from 'next/server'

import { fail, ok, errors } from '@/lib/api/response'
import { requirePermission } from '@/lib/api/guard'
import { clientIp } from '@/lib/rate-limit'
import { fieldErrors } from '@/lib/validation'
import { toLocaleErrorResponse, updateLanguage, updateLanguageSchema } from '@/modules/country-locale'

export const dynamic = 'force-dynamic'

export async function PATCH(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const auth = await requirePermission(request, 'language:manage')
  if (auth instanceof NextResponse) return auth

  const { code } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errors.badRequest('Request body must be valid JSON')
  }

  const parsed = updateLanguageSchema.safeParse(body)
  if (!parsed.success) {
    return errors.badRequest('Please fix the highlighted fields', fieldErrors(parsed.error))
  }

  try {
    const language = await updateLanguage(auth.actor, code, parsed.data, {
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    return ok({ language })
  } catch (error) {
    const mapped = toLocaleErrorResponse(error)
    if (mapped) return fail(mapped.message, mapped.code, mapped.status)
    console.error('[languages/update] unexpected error:', error)
    return fail('Could not update the language', 'INTERNAL_ERROR', 500)
  }
}
