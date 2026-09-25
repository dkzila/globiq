/**
 * GET /api/health — Platform & database health (P1-S1 foundation check).
 * Returns service identity, database connectivity, seed snapshot and latency.
 */
import { db } from '@/lib/db'
import { ok, errors } from '@/lib/api/response'
import { PLATFORM } from '@/config/platform'

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  try {
    await db.$queryRaw`SELECT 1`

    const [countries, languages] = await Promise.all([
      db.country.findMany({
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: {
          isoCode: true,
          name: true,
          slug: true,
          status: true,
          isDefault: true,
          timezone: true,
          defaultLanguage: { select: { code: true } },
          supported: { select: { language: { select: { code: true } } } },
        },
      }),
      db.language.findMany({
        orderBy: { code: 'asc' },
        select: { code: true, name: true, nativeName: true, status: true },
      }),
    ])

    return ok({
      service: {
        name: PLATFORM.name,
        version: PLATFORM.version,
        spec: `${PLATFORM.spec.document} v${PLATFORM.spec.version}`,
      },
      database: {
        connected: true,
        provider: PLATFORM.database.provider,
        host: PLATFORM.database.host,
        region: PLATFORM.database.region,
      },
      seed: {
        countries: countries.map((country) => ({
          isoCode: country.isoCode,
          name: country.name,
          slug: country.slug,
          status: country.status,
          isDefault: country.isDefault,
          timezone: country.timezone,
          defaultLanguage: country.defaultLanguage?.code ?? null,
          languages: country.supported.map((link) => link.language.code),
        })),
        languages: languages.map((language) => ({
          code: language.code,
          name: language.name,
          nativeName: language.nativeName,
          status: language.status,
        })),
      },
      latencyMs: Date.now() - startedAt,
    })
  } catch {
    return errors.serviceUnavailable('Database connection failed')
  }
}
