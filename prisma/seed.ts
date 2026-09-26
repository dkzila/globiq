/**
 * GlobIQ — P1-S1 + P1-S2 Seed
 * Master Plan §45 (Seed Data Strategy): intentionally small but structurally rich.
 *
 * P1-S1 scope: languages + countries (India = default root market, English default).
 * India's supported languages: English (default) + Hindi — matching the URL
 * architecture in §16/Appendix B ("/" for English, "/hi/" for Hindi).
 *
 * P1-S2 scope: one development admin account (§45 "sample editorial users with
 * scoped roles" begins here; full scoped staff seeding lands with the editorial
 * console in P2-S4/S5). Credentials are DEV-ONLY — never use in production.
 *
 * Run: bun run db:seed
 */
import { PrismaClient } from '@prisma/client'

import { hashPassword } from '../src/modules/identity-access/password'

const prisma = new PrismaClient()

// Dev-only admin credentials (documented in docs/sessions/P1-S2.md).
const DEV_ADMIN_EMAIL = 'admin@globiq.dev'
const DEV_ADMIN_PASSWORD = 'GlobIQ-Dev-Admin-1'

async function main() {
  // ---------- Languages ----------
  const en = await prisma.language.upsert({
    where: { code: 'en' },
    update: {},
    create: {
      code: 'en',
      name: 'English',
      nativeName: 'English',
      direction: 'LTR',
      status: 'ACTIVE',
    },
  })

  const hi = await prisma.language.upsert({
    where: { code: 'hi' },
    update: {},
    create: {
      code: 'hi',
      name: 'Hindi',
      nativeName: 'हिन्दी',
      direction: 'LTR',
      status: 'ACTIVE',
    },
  })

  const fr = await prisma.language.upsert({
    where: { code: 'fr' },
    update: {},
    create: {
      code: 'fr',
      name: 'French',
      nativeName: 'Français',
      direction: 'LTR',
      status: 'ACTIVE',
    },
  })

  // ---------- Countries ----------
  const india = await prisma.country.upsert({
    where: { isoCode: 'IN' },
    update: {
      name: 'India',
      slug: 'in',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      isDefault: true,
      defaultLanguageId: en.id,
    },
    create: {
      isoCode: 'IN',
      slug: 'in',
      name: 'India',
      timezone: 'Asia/Kolkata',
      status: 'ACTIVE',
      isDefault: true,
      defaultLanguageId: en.id,
    },
  })

  const uk = await prisma.country.upsert({
    where: { isoCode: 'GB' },
    update: {
      name: 'United Kingdom',
      slug: 'uk',
      timezone: 'Europe/London',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: en.id,
    },
    create: {
      isoCode: 'GB',
      slug: 'uk',
      name: 'United Kingdom',
      timezone: 'Europe/London',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: en.id,
    },
  })

  const france = await prisma.country.upsert({
    where: { isoCode: 'FR' },
    update: {
      name: 'France',
      slug: 'fr',
      timezone: 'Europe/Paris',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: fr.id,
    },
    create: {
      isoCode: 'FR',
      slug: 'fr',
      name: 'France',
      timezone: 'Europe/Paris',
      status: 'COMING_SOON',
      isDefault: false,
      defaultLanguageId: fr.id,
    },
  })

  // ---------- Supported languages per country (§35: only own configured languages) ----------
  const links: Array<{ countryId: string; languageId: string }> = [
    { countryId: india.id, languageId: en.id }, // India: English (default)
    { countryId: india.id, languageId: hi.id }, // India: Hindi → /hi/
    { countryId: uk.id, languageId: en.id }, // UK: English (default)
    { countryId: france.id, languageId: fr.id }, // France: French (default)
  ]

  for (const link of links) {
    await prisma.countryLanguage.upsert({
      where: {
        countryId_languageId: {
          countryId: link.countryId,
          languageId: link.languageId,
        },
      },
      update: {},
      create: link,
    })
  }

  // ---------- Dev admin (P1-S2, §45) ----------
  const admin = await prisma.user.upsert({
    where: { email: DEV_ADMIN_EMAIL },
    update: {}, // never overwrite a manually-changed password on re-seed
    create: {
      email: DEV_ADMIN_EMAIL,
      name: 'Dev Admin',
      passwordHash: await hashPassword(DEV_ADMIN_PASSWORD),
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: en.id,
    },
  })

  console.log(
    `Seed complete → languages: ${[en.code, hi.code, fr.code].join(', ')} | countries: ${[
      `${india.isoCode} (default)`,
      `${uk.isoCode} (coming soon)`,
      `${france.isoCode} (coming soon)`,
    ].join(', ')} | dev admin: ${admin.email} (ADMIN)`
  )
}

main()
  .catch((error) => {
    console.error('Seed failed:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
