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

  // ---------- P2-S1: Knowledge Units (Master Plan §45) ----------
  // Structurally rich: multiple types (§23), difficulties, scopes (§14) and
  // lifecycle statuses — one DRAFT unit exercises the transition demo. Seed
  // writes never overwrite live edits made through the CRUD APIs (§36).

  interface KnowledgeSeed {
    slug: string
    canonicalName: string
    canonicalSummary: string
    canonicalBody: string
    type:
      | 'FACT'
      | 'CONCEPT'
      | 'TIMELINE'
      | 'PERSON_PROFILE'
      | 'PLACE_PROFILE'
      | 'ORGANISATION_PROFILE'
      | 'COMPARISON'
    status: 'DRAFT' | 'IN_REVIEW' | 'VERIFIED' | 'OUTDATED' | 'ARCHIVED'
    difficulty: 'BASIC' | 'INTERMEDIATE' | 'ADVANCED'
    scope: 'GLOBAL' | 'COUNTRY'
    topicSlug: string
    validFrom?: Date
    orderIndex?: number
  }

  const knowledgeUnits: KnowledgeSeed[] = [
    {
      slug: 'fundamental-rights-articles-12-35',
      canonicalName: 'Fundamental Rights — Articles 12–35',
      canonicalSummary:
        'Part III of the Constitution guarantees six Fundamental Rights, enforceable against the State under Article 32.',
      canonicalBody:
        'Fundamental Rights are enshrined in Part III of the Constitution of India, Articles 12–35. Article 12 defines "the State" broadly (legislature, executive, local authorities, statutory bodies), and Article 13 bars laws inconsistent with Fundamental Rights. The six rights are: Equality (14–18), Freedom (19–22), Against Exploitation (23–24), Freedom of Religion (25–28), Cultural & Educational (29–30), and Constitutional Remedies (32). Dr B R Ambedkar called Article 32 — the right to move the Supreme Court directly — the "heart and soul" of the Constitution. Key land laws and judgments that shaped these rights include Maneka Gandhi v. Union of India (1978), which read Article 21 expansively.',
      type: 'CONCEPT',
      status: 'VERIFIED',
      difficulty: 'INTERMEDIATE',
      scope: 'COUNTRY',
      topicSlug: 'fundamental-rights',
      orderIndex: 1,
    },
    {
      slug: 'right-to-constitutional-remedies-article-32',
      canonicalName: 'Right to Constitutional Remedies — Article 32',
      canonicalSummary:
        'Article 32 lets citizens move the Supreme Court directly to enforce Fundamental Rights; Ambedkar called it the heart and soul of the Constitution.',
      canonicalBody:
        'Article 32 of the Constitution provides the right to move the Supreme Court by appropriate proceedings for the enforcement of Fundamental Rights, making those rights justiciable rather than declaratory. The Supreme Court may issue writs of habeas corpus, mandamus, prohibition, certiorari and quo warranto. Dr B R Ambedkar described Article 32 as "the very soul of the Constitution and the very heart of it" because a right without a remedy is meaningless. The Article cannot be suspended except during a Emergency as provided by the Constitution (Article 359).',
      type: 'CONCEPT',
      status: 'VERIFIED',
      difficulty: 'ADVANCED',
      scope: 'COUNTRY',
      topicSlug: 'fundamental-rights',
      orderIndex: 2,
    },
    {
      slug: 'ashoka-kalinga-war-261-bce',
      canonicalName: "Ashoka's Kalinga War — 261 BCE",
      canonicalSummary:
        'The Kalinga War (c. 261 BCE) turned Emperor Ashoka from conquest to Dhamma; its death toll is recorded in his 13th Rock Edict.',
      canonicalBody:
        'The Kalinga War, fought c. 261 BCE in the third year of Ashoka\'s reign, was the decisive turning point of Mauryan history. Ashoka\'s 13th Rock Edict records that 100,000 were killed, 150,000 deported and many more died afterwards. The remorse Ashoka expressed led him to embrace Buddhism and pursue "conquest by Dhamma" (Dhamma Vijaya) instead of war. Kalinga corresponds to present-day coastal Odisha. The war is a favourite exam anchor for Mauryan history questions.',
      type: 'FACT',
      status: 'VERIFIED',
      difficulty: 'BASIC',
      scope: 'COUNTRY',
      topicSlug: 'mauryan-empire',
      orderIndex: 1,
    },
    {
      slug: 'un-security-council-permanent-members',
      canonicalName: 'UN Security Council — Permanent Members',
      canonicalSummary:
        'The P5 — China, France, Russia, the UK and the US — hold permanent seats and veto power on the 15-member Security Council.',
      canonicalBody:
        'The United Nations Security Council has 15 members: five permanent (the P5 — China, France, Russia, the United Kingdom and the United States, the victors of the Second World War institutionalised in 1945) and ten non-permanent members elected for two-year terms without immediate re-election. Decisions on substantive matters require nine affirmative votes including no veto from any permanent member (Chapter V of the UN Charter). Reform of the Council — including India\'s long-standing bid for a permanent seat — is debated under the Intergovernmental Negotiations process.',
      type: 'CONCEPT',
      status: 'VERIFIED',
      difficulty: 'BASIC',
      scope: 'GLOBAL',
      topicSlug: 'united-nations',
      orderIndex: 1,
    },
    {
      slug: 'fall-of-the-berlin-wall-1989',
      canonicalName: 'Fall of the Berlin Wall — 1989',
      canonicalSummary:
        'On 9 November 1989 the Berlin Wall fell after 28 years, catalysing German reunification (1990) and the collapse of the Eastern Bloc.',
      canonicalBody:
        'The Berlin Wall, erected on 13 August 1961 by the German Democratic Republic to stop the exodus to West Berlin, fell on the night of 9 November 1989 after a botched press conference by Günter Schabowski opened the crossings. The Wall had stood for 28 years. Its fall catalysed the reunification of Germany on 3 October 1990 and accelerated the collapse of communist regimes across the Eastern Bloc. Timeline anchors for exams: construction 1961, Kennedy\'s "Ich bin ein Berliner" 1963, fall 1989, reunification 1990.',
      type: 'TIMELINE',
      status: 'VERIFIED',
      difficulty: 'INTERMEDIATE',
      scope: 'GLOBAL',
      topicSlug: 'world-history',
      orderIndex: 1,
    },
    {
      slug: 'chandrayaan-3-landing-2023',
      canonicalName: 'Chandrayaan-3 Landing — 23 August 2023',
      canonicalSummary:
        'Chandrayaan-3 made India the fourth country to soft-land on the Moon and the first near the lunar south pole.',
      canonicalBody:
        'ISRO\'s Chandrayaan-3 mission soft-landed its Vikram lander near the lunar south pole on 23 August 2023, making India the fourth country to achieve a Moon soft landing (after the USSR, USA and China) and the first to land in the southern polar region. The mission was launched on 14 July 2023 aboard LVM3-M4. The Pragyan rover conducted in-situ experiments before lunar night. The landing site was named "Shiv Shakti Point", and 23 August is now observed as National Space Day in India.',
      type: 'FACT',
      status: 'VERIFIED',
      difficulty: 'INTERMEDIATE',
      scope: 'COUNTRY',
      topicSlug: 'isro-programmes',
      validFrom: new Date('2023-08-23T00:00:00Z'),
      orderIndex: 1,
    },
    {
      slug: 'attorney-general-of-india',
      canonicalName: 'Attorney General of India',
      canonicalSummary:
        'Article 76 creates the Attorney General, the Union\'s chief legal adviser and senior advocate; a DRAFT seed unit for the lifecycle demo.',
      canonicalBody:
        'The Attorney General for India is the Government of India\'s chief legal adviser, appointed by the President under Article 76 of the Constitution. The appointee must be qualified to be a Supreme Court judge. The Attorney General has the right of audience in all courts in India and takes part in parliamentary proceedings (without a vote). This seed unit starts in DRAFT to exercise the lifecycle transitions (submit_review → verify) end-to-end.',
      type: 'CONCEPT',
      status: 'DRAFT',
      difficulty: 'ADVANCED',
      scope: 'COUNTRY',
      topicSlug: 'constitutional-framework',
      orderIndex: 1,
    },
  ]

  let knowledgeSeeded = 0
  for (const seed of knowledgeUnits) {
    const topicId = topicIdBySlug.get(seed.topicSlug)
    if (!topicId) {
      console.warn(`[seed] skipping knowledge unit "${seed.slug}": topic "${seed.topicSlug}" not found`)
      continue
    }
    await prisma.knowledgeUnit.upsert({
      where: { slug: seed.slug },
      update: {},
      create: {
        slug: seed.slug,
        canonicalName: seed.canonicalName,
        canonicalSummary: seed.canonicalSummary,
        canonicalBody: seed.canonicalBody,
        type: seed.type,
        status: seed.status,
        difficulty: seed.difficulty,
        scope: seed.scope,
        countryId: seed.scope === 'COUNTRY' ? india.id : null,
        topicId,
        validFrom: seed.validFrom ?? null,
        orderIndex: seed.orderIndex ?? 0,
        createdById: admin.id,
      },
    })
    knowledgeSeeded += 1
  }

  console.log(
    `Seed complete → languages: ${[en.code, hi.code, fr.code].join(', ')} | countries: ${[
      `${india.isoCode} (default)`,
      `${uk.isoCode} (coming soon)`,
      `${france.isoCode} (coming soon)`,
    ].join(', ')} | dev admin: ${admin.email} (ADMIN) | dev IN admin: ${inAdmin.email} (COUNTRY_ADMIN) | taxonomy: ${topicIdBySlug.size} nodes | knowledge units: ${knowledgeSeeded}`
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
