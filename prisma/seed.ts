/**
 * GlobIQ — P1-S1 + P1-S2 + P1-S4 Seed
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
 * P1-S4 scope: a few structurally rich taxonomy branches (§45) — global domains,
 * country-scoped extensions (IN), nested branch→topic nodes, en/hi labels and
 * aliases — plus one dev COUNTRY_ADMIN (IN) to exercise scoped RBAC (§38).
 * Re-seeding never overwrites admin edits made through the CRUD APIs (§36).
 *
 * Run: bun run db:seed
 */
import { PrismaClient } from '@prisma/client'

import { hashPassword } from '../src/modules/identity-access/password'

const prisma = new PrismaClient()

// Dev-only admin credentials (documented in docs/sessions/P1-S2.md).
const DEV_ADMIN_EMAIL = 'admin@globiq.dev'
const DEV_ADMIN_PASSWORD = 'GlobIQ-Dev-Admin-1'
const DEV_IN_ADMIN_EMAIL = 'in-admin@globiq.dev'
const DEV_IN_ADMIN_PASSWORD = 'GlobIQ-Dev-INAdmin-1'

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

  // Dev country admin for India (P1-S4, §38/§45): exercises scoped RBAC.
  const inAdmin = await prisma.user.upsert({
    where: { email: DEV_IN_ADMIN_EMAIL },
    update: {},
    create: {
      email: DEV_IN_ADMIN_EMAIL,
      name: 'Dev India Admin',
      passwordHash: await hashPassword(DEV_IN_ADMIN_PASSWORD),
      role: 'COUNTRY_ADMIN',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: en.id,
    },
  })

  // ---------- Taxonomy branches (P1-S4, §13/§45) ----------
  // Configurable domains (never hard-coded in code) + country-scoped extensions.
  // upsert update: {} — re-seed must not overwrite live admin edits (§36).
  interface SeedTopic {
    slug: string
    canonicalName: string
    type: 'DOMAIN' | 'BRANCH' | 'TOPIC'
    scope: 'GLOBAL' | 'COUNTRY'
    countryId?: string
    parent?: string // parent slug (resolved after creation)
    orderIndex?: number
    description?: string
    labels?: Array<{ languageCode: string; name: string }>
    aliases?: Array<{ value: string; languageCode?: string }>
  }

  const topics: SeedTopic[] = [
    // Root domains — the global framework (§13)
    {
      slug: 'polity-governance',
      canonicalName: 'Polity & Governance',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 1,
      description: 'Constitutions, political systems, governance and public administration.',
      labels: [
        { languageCode: 'en', name: 'Polity & Governance' },
        { languageCode: 'hi', name: 'राजव्यवस्था और शासन' },
      ],
    },
    {
      slug: 'history',
      canonicalName: 'History',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 2,
      description: 'World and national history from ancient to modern times.',
      labels: [
        { languageCode: 'en', name: 'History' },
        { languageCode: 'hi', name: 'इतिहास' },
      ],
    },
    {
      slug: 'science-technology',
      canonicalName: 'Science & Technology',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 3,
      description: 'Physical sciences, life sciences, and technological progress.',
      labels: [
        { languageCode: 'en', name: 'Science & Technology' },
        { languageCode: 'hi', name: 'विज्ञान और प्रौद्योगिकी' },
      ],
    },
    {
      slug: 'current-affairs',
      canonicalName: 'Current Affairs',
      type: 'DOMAIN',
      scope: 'GLOBAL',
      orderIndex: 4,
      description: 'Ongoing events and developments with exam relevance.',
      labels: [
        { languageCode: 'en', name: 'Current Affairs' },
        { languageCode: 'hi', name: 'समकालीन घटनाएँ' },
      ],
    },
    // Polity branches
    {
      slug: 'constitutional-framework',
      canonicalName: 'Constitutional Framework',
      type: 'BRANCH',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'polity-governance',
      orderIndex: 1,
      description: 'The Constitution of India: structure, organs, and amendments.',
      labels: [
        { languageCode: 'en', name: 'Constitutional Framework' },
        { languageCode: 'hi', name: 'संवैधानिक ढाँचा' },
      ],
    },
    {
      slug: 'fundamental-rights',
      canonicalName: 'Fundamental Rights',
      type: 'TOPIC',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'constitutional-framework',
      orderIndex: 1,
      description: 'Part III of the Constitution: Articles 12–35 and landmark judgments.',
      labels: [
        { languageCode: 'en', name: 'Fundamental Rights' },
        { languageCode: 'hi', name: 'मौलिक अधिकार' },
      ],
      aliases: [
        { value: 'FR' },
        { value: 'Fundamental Rights in India' },
        { value: 'मौलिक अधिकार', languageCode: 'hi' },
      ],
    },
    {
      slug: 'international-organisations',
      canonicalName: 'International Organisations',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'polity-governance',
      orderIndex: 2,
      description: 'UN, WTO, IMF, World Bank and other global bodies.',
      labels: [
        { languageCode: 'en', name: 'International Organisations' },
        { languageCode: 'hi', name: 'अंतर्राष्ट्रीय संगठन' },
      ],
    },
    {
      slug: 'united-nations',
      canonicalName: 'United Nations',
      type: 'TOPIC',
      scope: 'GLOBAL',
      parent: 'international-organisations',
      orderIndex: 1,
      description: 'UN structure, principal organs, agencies, and peacekeeping.',
      labels: [
        { languageCode: 'en', name: 'United Nations' },
        { languageCode: 'hi', name: 'संयुक्त राष्ट्र' },
      ],
      aliases: [{ value: 'UN' }],
    },
    // History branches
    {
      slug: 'ancient-india',
      canonicalName: 'Ancient India',
      type: 'BRANCH',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'history',
      orderIndex: 1,
      description: 'Indus Valley civilisation through the early medieval period.',
      labels: [
        { languageCode: 'en', name: 'Ancient India' },
        { languageCode: 'hi', name: 'प्राचीन भारत' },
      ],
    },
    {
      slug: 'mauryan-empire',
      canonicalName: 'Mauryan Empire',
      type: 'TOPIC',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'ancient-india',
      orderIndex: 1,
      description: 'Chandragupta, Bindusara, Ashoka and Mauryan administration.',
      labels: [
        { languageCode: 'en', name: 'Mauryan Empire' },
        { languageCode: 'hi', name: 'मौर्य साम्राज्य' },
      ],
    },
    {
      slug: 'world-history',
      canonicalName: 'World History',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'history',
      orderIndex: 2,
      description: 'Revolutions, world wars, and global transformations.',
      labels: [
        { languageCode: 'en', name: 'World History' },
        { languageCode: 'hi', name: 'विश्व इतिहास' },
      ],
    },
    // Science & Technology branches
    {
      slug: 'space-technology',
      canonicalName: 'Space Technology',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'science-technology',
      orderIndex: 1,
      description: 'Launch systems, satellites, deep-space missions, and agencies.',
      labels: [
        { languageCode: 'en', name: 'Space Technology' },
        { languageCode: 'hi', name: 'अंतरिक्ष प्रौद्योगिकी' },
      ],
    },
    {
      slug: 'isro-programmes',
      canonicalName: 'ISRO Programmes',
      type: 'TOPIC',
      scope: 'COUNTRY',
      countryId: india.id,
      parent: 'space-technology',
      orderIndex: 1,
      description: 'Chandrayaan, Mangalyaan, Gaganyaan, PSLV/GSLV and ISRO history.',
      labels: [
        { languageCode: 'en', name: 'ISRO Programmes' },
        { languageCode: 'hi', name: 'इसरो कार्यक्रम' },
      ],
    },
    // Current affairs branch
    {
      slug: 'awards-honours',
      canonicalName: 'Awards & Honours',
      type: 'BRANCH',
      scope: 'GLOBAL',
      parent: 'current-affairs',
      orderIndex: 1,
      description: 'National and international awards, prizes, and honours.',
      labels: [
        { languageCode: 'en', name: 'Awards & Honours' },
        { languageCode: 'hi', name: 'पुरस्कार और सम्मान' },
      ],
    },
  ]

  const languageIdByCode = new Map([
    ['en', en.id],
    ['hi', hi.id],
    ['fr', fr.id],
  ])

  const topicIdBySlug = new Map<string, string>()
  for (const seed of topics) {
    const created = await prisma.topic.upsert({
      where: { slug: seed.slug },
      update: {},
      create: {
        slug: seed.slug,
        canonicalName: seed.canonicalName,
        description: seed.description ?? null,
        type: seed.type,
        status: 'ACTIVE',
        scope: seed.scope,
        countryId: seed.scope === 'COUNTRY' ? (seed.countryId ?? india.id) : null,
        parentId: seed.parent ? (topicIdBySlug.get(seed.parent) ?? null) : null,
        orderIndex: seed.orderIndex ?? 0,
      },
    })
    topicIdBySlug.set(seed.slug, created.id)

    for (const label of seed.labels ?? []) {
      await prisma.topicLabel.upsert({
        where: {
          topicId_languageId: {
            topicId: created.id,
            languageId: languageIdByCode.get(label.languageCode)!,
          },
        },
        update: {},
        create: {
          topicId: created.id,
          languageId: languageIdByCode.get(label.languageCode)!,
          name: label.name,
        },
      })
    }

    for (const alias of seed.aliases ?? []) {
      await prisma.topicAlias.upsert({
        where: {
          topicId_value: {
            topicId: created.id,
            value: alias.value,
          },
        },
        update: {},
        create: {
          topicId: created.id,
          value: alias.value,
          languageId: alias.languageCode ? (languageIdByCode.get(alias.languageCode) ?? null) : null,
        },
      })
    }
  }

  console.log(
    `Seed complete → languages: ${[en.code, hi.code, fr.code].join(', ')} | countries: ${[
      `${india.isoCode} (default)`,
      `${uk.isoCode} (coming soon)`,
      `${france.isoCode} (coming soon)`,
    ].join(', ')} | dev admin: ${admin.email} (ADMIN) | dev IN admin: ${inAdmin.email} (COUNTRY_ADMIN) | taxonomy: ${topicIdBySlug.size} nodes`
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
