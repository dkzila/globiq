/**
 * GlobIQ — P1-S1 + P1-S2 + P1-S4 + P2-S1 + P2-S2 + P2-S3 Seed
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
 *
 * P2-S1 scope: structurally rich knowledge units (§45) — types, difficulties,
 * scopes, lifecycle statuses (one DRAFT for the transition demo).
 *
 * P2-S2 scope: ContentItems + revisions — multiple formats (§23), languages
 * (en/hi, §35), a two-revision correction (§36 preservation + provenance) and
 * one DRAFT for the lifecycle demo.
 *
 * P2-S3 scope: Sources + provenance links (§24) — verification states (one
 * UNRELIABLE for the trust demo), claim/content-level attribution, and one
 * AI-assisted DRAFT CURRENT_EVENT_UPDATE (§26 provenance flag + the
 * source-backed-update format the P2-S2 handoff called for).
 *
 * P3-S1 scope: Exams + ExamVersions (§6/§14/§36) — India gets the full demo
 * matrix (three ACTIVE + one DRAFT exam, NATIONAL/STATE levels, historical
 * superseded + current + upcoming future-dated windows); UK (COMING_SOON)
 * carries one DRAFT exam to exercise §14 country scoping.
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
// P2-S4 (§18/§20): dev WRITER accounts — one all-language, one Hindi-scoped.
const DEV_WRITER_IN_EMAIL = 'writer-in@globiq.dev'
const DEV_WRITER_IN_PASSWORD = 'GlobIQ-Dev-Writer-1'
const DEV_WRITER_HI_EMAIL = 'writer-hi@globiq.dev'
const DEV_WRITER_HI_PASSWORD = 'GlobIQ-Dev-Writer-Hi-1'

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

  // ---------- P2-S4: editorial staff (Master Plan §18/§20/§45) ----------
  // Writers create/edit/submit content but never publish (§18); scopes are
  // explicit country (+ optionally language) and enforced server-side (§20).
  const writerIn = await prisma.user.upsert({
    where: { email: DEV_WRITER_IN_EMAIL },
    update: {}, // never overwrite live role/scope edits
    create: {
      email: DEV_WRITER_IN_EMAIL,
      name: 'Dev Writer (IN, all languages)',
      passwordHash: await hashPassword(DEV_WRITER_IN_PASSWORD),
      role: 'WRITER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: en.id,
      // languageScopeId null = all languages within the IN scope
    },
  })
  const writerHi = await prisma.user.upsert({
    where: { email: DEV_WRITER_HI_EMAIL },
    update: {},
    create: {
      email: DEV_WRITER_HI_EMAIL,
      name: 'Dev Writer (IN, Hindi-scoped)',
      passwordHash: await hashPassword(DEV_WRITER_HI_PASSWORD),
      role: 'WRITER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      homeCountryId: india.id,
      preferredLanguageId: hi.id,
      languageScopeId: hi.id, // §20 explicit language scope — Hindi only
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

  // ---------- P2-S2: ContentItems + revisions (Master Plan §45) ----------
  // Structurally rich representations (§7): multiple formats (§23), languages
  // (§35 — Hindi demo), statuses, and one two-revision correction (§36 — the
  // previous version is preserved with provenance). Seed writes never
  // overwrite live edits made through the CRUD APIs (§36).

  interface RevisionSeed {
    title: string
    body: string
    changeSummary?: string
    publishedAt?: Date
  }

  interface ContentSeed {
    unitSlug: string
    languageCode: string
    format:
      | 'FACT_CARD'
      | 'EXPLAINER'
      | 'REVISION_NOTE'
      | 'CURRENT_EVENT_UPDATE'
      | 'TIMELINE'
      | 'PROFILE'
      | 'COMPARISON'
    status: 'DRAFT' | 'IN_REVIEW' | 'SCHEDULED' | 'PUBLISHED' | 'RETIRED'
    /** §19 step 7: required when status = SCHEDULED (future release time). */
    scheduledForAt?: Date
    /** Working-copy overrides for items without revisions. */
    title?: string
    body?: string
    revisions: RevisionSeed[] // empty for never-published items
  }

  const contentItems: ContentSeed[] = [
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'EXPLAINER',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Fundamental Rights (Articles 12–35) — Complete Explainer',
          body: 'Fundamental Rights, enshrined in Part III of the Constitution of India (Articles 12–35), are justiciable guarantees available against the State as defined by Article 12. Article 13 adds teeth: any law inconsistent with these rights is void. The six rights — Equality (14–18), Freedom (19–22), Against Exploitation (23–24), Freedom of Religion (25–28), Cultural & Educational (29–30) and Constitutional Remedies (32) — are enforceable through the writ jurisdiction of the Supreme Court and the High Courts. Landmark expansions include Maneka Gandhi v. Union of India (1978), which read Article 21\'s "right to life and personal liberty" expansively to include dignity and due process. For exams, anchor on the article ranges, the writs (habeas corpus, mandamus, prohibition, certiorari, quo warranto), and the distinction between Fundamental Rights and Directive Principles.',
          publishedAt: new Date('2025-06-10T09:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'FACT_CARD',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Fundamental Rights — Quick Facts',
          body: 'Part III, Articles 12–35: six Fundamental Rights — Equality, Freedom, Against Exploitation, Religion, Cultural & Educational, Constitutional Remedies. Article 32 (writ jurisdiction) was called the "heart and soul" of the Constitution by Dr B R Ambedkar.',
          publishedAt: new Date('2025-06-10T09:30:00Z'),
        },
      ],
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'hi',
      format: 'EXPLAINER',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'मौलिक अधिकार (अनुच्छेद 12–35) — व्याख्या',
          body: 'भारतीय संविधान के भाग III (अनुच्छेद 12–35) में अंतर्निहित मौलिक अधिकार न्यायोचित गारंटियाँ हैं, जो अनुच्छेद 12 में परिभाषित "राज्य" के विरुद्ध प्राप्त करने योग्य हैं। छह अधिकार हैं: समता (14–18), स्वतंत्रता (19–22), शोषण के विरुद्ध (23–24), धार्मिक स्वतंत्रता (25–28), सांस्कृतिक और शैक्षिक (29–30), तथा संवैधानिक उपचार (32)। डॉ. बी. आर. अंबेडकर ने अनुच्छेद 32 को संविधान का "हृदय और आत्मा" कहा, क्योंकि बिना उपचार के अधिकार अर्थहीन हैं। मनेका गांधी बनाम भारत संघ (1978) ने अनुच्छेद 21 को व्यापक रूप से पढ़ा। परीक्षा के लिए अनुच्छेद सीमाएँ, रिट (बंदी प्रत्यक्षीकरण, परमादेश, निषेध, प्रतिकूल आदेश, अधिकार पृच्छा) और मौलिक अधिकार बनाम नीति निदेशक तत्वों का अंतर याद रखें।',
          publishedAt: new Date('2025-07-01T10:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'EXPLAINER',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'The UN Security Council and the P5 — Explainer',
          body: 'The United Nations Security Council (UNSC) is the UN organ with primary responsibility for international peace and security, established by Chapter V of the UN Charter in 1945. It has 15 members: the five permanent members (P5 — China, France, Russia, the United Kingdom and the United States), holding veto power over substantive resolutions, and ten non-permanent members elected for two-year terms without immediate re-election. Substantive decisions need nine affirmative votes including no P5 veto. Reform debates — including India\'s long-standing claim to a permanent seat, supported by the G4 (Brazil, Germany, India, Japan) — run through the Intergovernmental Negotiations (IGN) process. For exams, remember: 15 members, 5 permanent, 10 elected, 9 votes needed, one veto blocks.',
          publishedAt: new Date('2025-06-15T08:00:00Z'),
        },
      ],
    },
    {
      // P2-S5 (§23/§45): the PROFILE format — structured "key: value" fields
      // rendered by the canonical reading page's format-aware renderer.
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'PROFILE',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'UN Security Council — Profile',
          body: 'Established: 1945 (Chapter V, UN Charter)\nHeadquarters: United Nations, New York\nTotal members: 15 (5 permanent, 10 non-permanent)\nPermanent members (P5): China, France, Russia, United Kingdom, United States\nNon-permanent members: elected by the General Assembly for two-year terms, no immediate re-election\nVoting on substantive matters: 9 of 15 affirmative votes, including no P5 veto\nPresident: rotates monthly in alphabetical order of member names\nSubsidiary bodies: sanctions committees, peacekeeping mandates, working groups on documentation and counter-terrorism\nReform track: Intergovernmental Negotiations (IGN); India\'s permanent-seat claim is backed by the G4',
          publishedAt: new Date('2025-06-15T08:30:00Z'),
        },
      ],
    },
    {
      // P2-S5 (§23/§45): the COMPARISON format — "axis | left | right" rows,
      // the classic FR-vs-DPSP exam distinction on the same canonical record.
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'COMPARISON',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Fundamental Rights vs Directive Principles — Comparison',
          body: 'Enshrined in | Part III (Articles 12–35) | Part IV (Articles 36–51)\nNature | Justiciable — enforceable by courts | Non-justiciable — not enforceable by courts\nAim | Political democracy and individual liberty | Social and economic welfare\nSource | Bill of Rights tradition (US) | Irish Constitution (1937)\nConflict doctrine | prevail if a law is irreconcilable with both | must yield to Fundamental Rights; harmonious construction preferred otherwise\nBorrowed features | largely colonial-era rights recast | Directive Principles of State Policy\nLandmark reading | Minerva Mills (1980): balance is part of the basic structure | Champakam Dorairajan (1951) framed the harmony rule',
          publishedAt: new Date('2025-06-11T09:00:00Z'),
        },
      ],
    },
    {
      // P2-S5 (§23/§45): the TIMELINE format on its natural unit — the Berlin
      // Wall record (type TIMELINE), "date — event" lines per §23 convention.
      unitSlug: 'fall-of-the-berlin-wall-1989',
      languageCode: 'en',
      format: 'TIMELINE',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'The Berlin Wall — Key Milestones',
          body: '13 August 1961 — The German Democratic Republic seals the border and begins building the Wall, stopping the exodus to West Berlin.\n26 June 1963 — President John F. Kennedy declares "Ich bin ein Berliner" at Rudolph Wilde Platz.\n1961–1989 — The Wall divides Berlin for 28 years; at least 140 people die trying to cross.\n9 November 1989 — After a botched Schabowski press conference, the crossings open; the Wall falls.\n3 October 1990 — Germany is formally reunified.\n1990 — East and West Germany sign the Unification Treaty; Soviet troops begin withdrawal.',
          publishedAt: new Date('2025-06-18T14:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'FACT_CARD',
      status: 'PUBLISHED',
      revisions: [
        {
          title: 'Chandrayaan-3 Landing — Fact Card',
          // Rev 1 carries a deliberate factual slip, corrected in rev 2 — the
          // §25/§36 correction demo (previous version preserved with provenance).
          body: 'Chandrayaan-3 soft-landed near the lunar south pole on 23 August 2023, making India the third country to land on the Moon. The landing site is named "Shiv Shakti Point", and 23 August is observed as National Space Day.',
          publishedAt: new Date('2025-06-20T12:00:00Z'),
        },
        {
          title: 'Chandrayaan-3 Landing — Fact Card',
          body: 'Chandrayaan-3 soft-landed its Vikram lander near the lunar south pole on 23 August 2023, making India the FOURTH country to achieve a Moon soft landing (after the USSR, USA and China) and the first near the south pole. Launched 14 July 2023 on LVM3-M4, the landing site is "Shiv Shakti Point", and 23 August is observed as National Space Day.',
          changeSummary: 'Corrected: India was the fourth country to soft-land on the Moon (after USSR, USA, China), not the third. Added launch date and vehicle.',
          publishedAt: new Date('2025-09-15T11:00:00Z'),
        },
      ],
    },
    {
      unitSlug: 'ashoka-kalinga-war-261-bce',
      languageCode: 'en',
      format: 'REVISION_NOTE',
      status: 'DRAFT', // lifecycle demo — publish through the admin console
      revisions: [],
    },
    {
      // P2-S4 §19 step 7: a reviewed item approved for a FUTURE release —
      // demonstrates the SCHEDULED state (locked working copy, goes-live
      // badge, publish-now / send-back affordances, lazy materialization).
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'TIMELINE',
      status: 'SCHEDULED',
      scheduledForAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // +2 days
      title: 'Chandrayaan programme — key milestones',
      body: '22 October 2008 — Chandrayaan-1 launches; the Moon Impact Probe strikes near Shackleton crater.\n15 July 2019 — Chandrayaan-2 launches; its orbiter continues high-resolution mapping.\n14 July 2023 — Chandrayaan-3 launches on LVM3-M4.\n23 August 2023 — Vikram soft-lands near the lunar south pole (Shiv Shakti Point); India becomes the fourth country to soft-land on the Moon.\n23 August 2024 — the first National Space Day commemorates the landing anniversary.',
      revisions: [],
    },
  ]

  let contentSeeded = 0
  for (const seed of contentItems) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    if (!unit || !languageId) {
      console.warn(`[seed] skipping content for "${seed.unitSlug}/${seed.languageCode}": unit or language missing`)
      continue
    }

    // Never overwrite live edits (§36) — only create when absent.
    const existing = await prisma.contentItem.findUnique({
      where: { knowledgeUnitId_languageId_format: { knowledgeUnitId: unit.id, languageId, format: seed.format } },
      select: { id: true },
    })
    if (existing) continue

    const lastRevision = seed.revisions[seed.revisions.length - 1]
    const item = await prisma.contentItem.create({
      data: {
        knowledgeUnitId: unit.id,
        languageId,
        format: seed.format,
        status: seed.status,
        ...(seed.scheduledForAt ? { scheduledForAt: seed.scheduledForAt } : {}),
        title: lastRevision?.title ?? seed.title ?? 'Untitled draft',
        body:
          lastRevision?.body ??
          seed.body ??
          'Draft revision notes for the Kalinga War: 261 BCE, third regnal year of Ashoka; 13th Rock Edict records 100,000 killed and 150,000 deported; the remorse led to Dhamma Vijaya; Kalinga = present-day coastal Odisha. Editable draft — publish through the admin console.',
        createdById: admin.id,
      },
    })

    let lastRevisionId: string | null = null
    for (const [index, revision] of seed.revisions.entries()) {
      const created = await prisma.contentRevision.create({
        data: {
          contentItemId: item.id,
          revisionNumber: index + 1,
          title: revision.title,
          body: revision.body,
          changeSummary: revision.changeSummary ?? null,
          publishedById: admin.id,
          publishedAt: revision.publishedAt ?? new Date(),
        },
      })
      lastRevisionId = created.id
    }
    if (seed.status === 'PUBLISHED' && lastRevisionId) {
      await prisma.contentItem.update({
        where: { id: item.id },
        data: { publishedRevisionId: lastRevisionId },
      })
    }
    contentSeeded += 1
  }

  // ---------- P2-S3: Sources + provenance links (Master Plan §24/§26/§45) ----------
  // Structurally rich evidence: categories (OFFICIAL/NEWS_MEDIA/INSTITUTIONAL),
  // verification states (VERIFIED + one UNVERIFIED + one UNRELIABLE trust-revoked
  // demo), claim-level AND content-level attribution (§24), and one AI-assisted
  // DRAFT CURRENT_EVENT_UPDATE (§26 flag + the source-backed-update format).
  // Seed writes never overwrite live edits (§36); sources dedup by URL.

  interface SourceSeed {
    title: string
    publisher: string
    url: string
    type: 'OFFICIAL' | 'NEWS_MEDIA' | 'INSTITUTIONAL' | 'ACADEMIC' | 'DATA' | 'OTHER'
    verification: 'UNVERIFIED' | 'VERIFIED' | 'UNRELIABLE'
    publishedAt?: Date
    retrievedAt?: Date
    verifiedAt?: Date
    notes?: string
  }

  const sources: SourceSeed[] = [
    {
      title: 'ISRO — Chandrayaan-3 soft-landing announcement',
      publisher: 'ISRO',
      url: 'https://www.isro.gov.in/Chandrayaan3.html',
      type: 'OFFICIAL',
      verification: 'VERIFIED',
      publishedAt: new Date('2023-08-23T00:00:00Z'),
      retrievedAt: new Date('2025-06-18T00:00:00Z'),
      verifiedAt: new Date('2025-06-18T00:00:00Z'),
      notes: 'Primary official record of the Vikram landing — the canonical evidence for the mission facts.',
    },
    {
      title: 'Chandrayaan-3 lands near lunar south pole, making India fourth nation to soft-land on Moon',
      publisher: 'The Hindu',
      url: 'https://www.thehindu.com/science/chandrayaan-3-soft-lands-on-moon/',
      type: 'NEWS_MEDIA',
      verification: 'VERIFIED',
      publishedAt: new Date('2023-08-23T00:00:00Z'),
      retrievedAt: new Date('2025-06-18T00:00:00Z'),
      verifiedAt: new Date('2025-06-19T00:00:00Z'),
    },
    {
      title: 'Charter of the United Nations — Chapter V (Security Council)',
      publisher: 'United Nations',
      url: 'https://www.un.org/en/about-us/un-charter/chapter-5',
      type: 'INSTITUTIONAL',
      verification: 'VERIFIED',
      publishedAt: new Date('1945-06-26T00:00:00Z'),
      retrievedAt: new Date('2025-06-14T00:00:00Z'),
      verifiedAt: new Date('2025-06-14T00:00:00Z'),
      notes: 'The primary source for UNSC composition and voting rules.',
    },
    {
      title: 'Constitution of India — Part III (Fundamental Rights)',
      publisher: 'Government of India',
      url: 'https://www.india.gov.in/my-government/constitution-india',
      type: 'OFFICIAL',
      verification: 'VERIFIED',
      publishedAt: new Date('1950-01-26T00:00:00Z'),
      retrievedAt: new Date('2025-06-08T00:00:00Z'),
      verifiedAt: new Date('2025-06-08T00:00:00Z'),
    },
    {
      title: 'PIB release — National Space Day notification',
      publisher: 'Press Information Bureau',
      url: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1950000',
      type: 'OFFICIAL',
      verification: 'UNVERIFIED', // recent record — awaiting the editorial verification pass (§24)
      publishedAt: new Date('2025-10-04T00:00:00Z'),
      retrievedAt: new Date('2025-11-20T00:00:00Z'),
      notes: 'Registered but not yet editor-checked — demonstrates the UNVERIFIED state and the verify workflow.',
    },
    {
      title: '“India becomes THIRD country to land on Moon” (retracted)',
      publisher: 'Space Insider Daily',
      url: 'https://spaceinsider-daily.example.com/india-third-country-moon-landing',
      type: 'NEWS_MEDIA',
      verification: 'UNRELIABLE', // trust revoked (§24) — factual error, retracted by the publisher
      publishedAt: new Date('2023-08-23T00:00:00Z'),
      retrievedAt: new Date('2025-06-18T00:00:00Z'),
      verifiedAt: new Date('2025-06-18T00:00:00Z'),
      notes: 'Trust-revoked demo: the “third country” error this outlet published is exactly what revision 1 of the Chandrayaan-3 fact card corrected (§36). Kept as preserved provenance history — never deleted, never attachable to new content.',
    },
  ]

  const sourceIdByUrl = new Map<string, string>()
  for (const seed of sources) {
    const created = await prisma.source.upsert({
      where: { url: seed.url },
      update: {}, // never overwrite live editorial edits on re-seed (§36)
      create: {
        title: seed.title,
        publisher: seed.publisher,
        url: seed.url,
        type: seed.type,
        verification: seed.verification,
        publishedAt: seed.publishedAt ?? null,
        retrievedAt: seed.retrievedAt ?? new Date(),
        verifiedAt: seed.verifiedAt ?? null,
        notes: seed.notes ?? null,
        createdById: admin.id,
      },
    })
    sourceIdByUrl.set(seed.url, created.id)
  }

  // One AI-assisted DRAFT CURRENT_EVENT_UPDATE (§26 + the P2-S2 handoff's
  // source-backed-update rendering) — staged provenance on an unpublished item.
  const chandrayaanUnit = await prisma.knowledgeUnit.findUnique({
    where: { slug: 'chandrayaan-3-landing-2023' },
  })
  let aiDraftSeeded = false
  if (chandrayaanUnit) {
    const existingUpdate = await prisma.contentItem.findUnique({
      where: {
        knowledgeUnitId_languageId_format: {
          knowledgeUnitId: chandrayaanUnit.id,
          languageId: en.id,
          format: 'CURRENT_EVENT_UPDATE',
        },
      },
      select: { id: true },
    })
    if (!existingUpdate) {
      await prisma.contentItem.create({
        data: {
          knowledgeUnitId: chandrayaanUnit.id,
          languageId: en.id,
          format: 'CURRENT_EVENT_UPDATE',
          status: 'DRAFT',
          title: 'National Space Day — update on Chandrayaan-3 legacy',
          body: 'Update: Following the Chandrayaan-3 soft landing on 23 August 2023, the Government of India notified 23 August as National Space Day. The landing site — “Shiv Shakti Point” — and the mission’s south-polar first have become standard exam anchors. This update summarizes the notification and links it to the canonical mission record. (AI-assisted draft: compiled by the AI layer from the cited PIB release and the ISRO record, pending editorial review — §26.)',
          aiAssisted: true,
          createdById: admin.id,
        },
      })
      aiDraftSeeded = true
    }
  }

  // Provenance links (§24): content-level and claim-level attribution.
  interface LinkSeed {
    unitSlug: string
    languageCode: string
    format:
      | 'FACT_CARD'
      | 'EXPLAINER'
      | 'REVISION_NOTE'
      | 'CURRENT_EVENT_UPDATE'
      | 'TIMELINE'
      | 'PROFILE'
      | 'COMPARISON'
    sourceUrl: string
    claim?: string
  }

  const provenanceLinks: LinkSeed[] = [
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'FACT_CARD',
      sourceUrl: 'https://www.isro.gov.in/Chandrayaan3.html',
      // content-level: the official record backs the whole card
    },
    {
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'FACT_CARD',
      sourceUrl: 'https://www.thehindu.com/science/chandrayaan-3-soft-lands-on-moon/',
      claim: 'India is the FOURTH country to soft-land on the Moon (after USSR, USA, China) and the first near the south pole — the claim corrected in revision 2 (§36).',
    },
    {
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'EXPLAINER',
      sourceUrl: 'https://www.un.org/en/about-us/un-charter/chapter-5',
    },
    {
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'EXPLAINER',
      sourceUrl: 'https://www.india.gov.in/my-government/constitution-india',
    },
    {
      // Staged provenance on the AI-assisted DRAFT (§26): visible in the admin
      // link manager, public only once the item passes review + publish.
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      sourceUrl: 'https://pib.gov.in/PressReleasePage.aspx?PRID=1950000',
      claim: 'The National Space Day notification (23 August).',
    },
  ]

  let linksSeeded = 0
  for (const seed of provenanceLinks) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    const sourceId = sourceIdByUrl.get(seed.sourceUrl)
    if (!unit || !languageId || !sourceId) {
      console.warn(`[seed] skipping source link for "${seed.unitSlug}/${seed.languageCode}/${seed.format}": prerequisite missing`)
      continue
    }
    const item = await prisma.contentItem.findUnique({
      where: { knowledgeUnitId_languageId_format: { knowledgeUnitId: unit.id, languageId, format: seed.format } },
      select: { id: true },
    })
    if (!item) continue
    const existing = await prisma.contentSourceLink.findUnique({
      where: { contentItemId_sourceId: { contentItemId: item.id, sourceId } },
      select: { id: true },
    })
    if (existing) continue
    await prisma.contentSourceLink.create({
      data: {
        contentItemId: item.id,
        sourceId,
        claim: seed.claim ?? null,
      },
    })
    linksSeeded += 1
  }

  // ---------- P2-S4: Editorial workspace (Master Plan §6/§19/§45) ----------
  // A representative board: an unclaimed localisation review (claimable by the
  // Hindi-scoped writer), an in-progress fact check, a §25 correction request
  // on GLOBAL-unit content (ADMIN-only board — §38 parity), and one resolved
  // item for board variety. Seed never overwrites live task edits (§36).
  interface TaskSeed {
    type: 'EDITORIAL_REVIEW' | 'FACT_CHECK' | 'LOCALISATION_REVIEW' | 'SEO_REVIEW' | 'CORRECTION'
    unitSlug: string
    languageCode: string
    format: string
    title: string
    notes?: string
    priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
    status?: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CANCELLED'
    assignee?: 'writer-in' | 'writer-hi' | 'in-admin'
    dueInHours?: number
    resolutionNote?: string
  }

  const editorialTasks: TaskSeed[] = [
    {
      type: 'LOCALISATION_REVIEW',
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'hi',
      format: 'EXPLAINER',
      title: 'Review the Hindi Fundamental Rights explainer',
      notes: 'Check terminology consistency (मौलिक अधिकार) against the taxonomy labels and tighten the intro.',
      priority: 'HIGH',
      // unassigned — the unclaimed pool (claimable by writer-hi, §20 scope)
    },
    {
      type: 'FACT_CHECK',
      unitSlug: 'chandrayaan-3-landing-2023',
      languageCode: 'en',
      format: 'CURRENT_EVENT_UPDATE',
      title: 'Fact-check the National Space Day update',
      notes: 'Verify the 23 August notification against the PIB release before the next revision.',
      priority: 'MEDIUM',
      status: 'IN_PROGRESS',
      assignee: 'writer-in',
      dueInHours: 48,
    },
    {
      type: 'CORRECTION',
      unitSlug: 'un-security-council-permanent-members',
      languageCode: 'en',
      format: 'EXPLAINER',
      title: 'Correction report — UNSC membership phrasing',
      notes: 'Reader-flagged: the phrasing on permanent membership vs veto powers needs a precise correction cycle (§25 — public feedback wiring lands P8-S3).',
      priority: 'URGENT',
      // GLOBAL unit → countryId null → platform task (ADMIN-only board, §38)
    },
    {
      type: 'SEO_REVIEW',
      unitSlug: 'fundamental-rights-articles-12-35',
      languageCode: 'en',
      format: 'FACT_CARD',
      title: 'SEO pass on the Fundamental Rights fact card',
      notes: 'Title length + internal links to the explainer.',
      priority: 'LOW',
      status: 'RESOLVED',
      assignee: 'in-admin',
      resolutionNote: 'Titles within bounds; cross-links added with the explainer revision.',
    },
  ]

  const assigneesById: Record<string, string> = {
    'writer-in': writerIn.id,
    'writer-hi': writerHi.id,
    'in-admin': inAdmin.id,
  }

  let tasksSeeded = 0
  for (const seed of editorialTasks) {
    const unit = await prisma.knowledgeUnit.findUnique({ where: { slug: seed.unitSlug } })
    const languageId = languageIdByCode.get(seed.languageCode)
    if (!unit || !languageId) {
      console.warn(`[seed] skipping task for "${seed.unitSlug}/${seed.languageCode}": prerequisite missing`)
      continue
    }
    const item = await prisma.contentItem.findUnique({
      where: {
        knowledgeUnitId_languageId_format: {
          knowledgeUnitId: unit.id,
          languageId,
          format: seed.format as
            | 'FACT_CARD'
            | 'EXPLAINER'
            | 'REVISION_NOTE'
            | 'CURRENT_EVENT_UPDATE'
            | 'TIMELINE'
            | 'PROFILE'
            | 'COMPARISON',
        },
      },
      select: { id: true },
    })
    if (!item) {
      console.warn(`[seed] skipping task "${seed.title}": content item missing`)
      continue
    }
    const existing = await prisma.editorialTask.findFirst({
      where: { objectType: 'ContentItem', objectId: item.id, type: seed.type, title: seed.title },
      select: { id: true },
    })
    if (existing) continue

    const status = seed.status ?? 'OPEN'
    await prisma.editorialTask.create({
      data: {
        type: seed.type,
        status,
        priority: seed.priority ?? 'MEDIUM',
        // §6/§14: the task inherits the work object's scope — GLOBAL units
        // produce platform (global) tasks visible on the ADMIN board only.
        countryId: unit.scope === 'COUNTRY' ? unit.countryId : null,
        languageId,
        objectType: 'ContentItem',
        objectId: item.id,
        objectLabel: `${unit.slug}/${seed.languageCode}/${seed.format}`,
        title: seed.title,
        notes: seed.notes ?? null,
        assigneeId: seed.assignee ? assigneesById[seed.assignee] : null,
        createdById: admin.id,
        ...(seed.dueInHours ? { dueAt: new Date(Date.now() + seed.dueInHours * 60 * 60 * 1000) } : {}),
        ...(status === 'IN_PROGRESS' ? { startedAt: new Date() } : {}),
        ...(status === 'RESOLVED'
          ? {
              resolvedAt: new Date(),
              resolvedById: seed.assignee ? assigneesById[seed.assignee] : null,
              resolutionNote: seed.resolutionNote ?? null,
            }
          : {}),
      },
    })
    tasksSeeded += 1
  }

  // ---------- P3-S1: Exams + versions (§45 structurally rich, §6/§14/§36) ----------
  // India (ACTIVE) gets the full demo matrix: lifecycle statuses, levels
  // (NATIONAL/STATE), version windows (historical superseded + current +
  // upcoming future-dated), and one DRAFT exam with no versions yet. UK
  // (COMING_SOON) carries one DRAFT exam to exercise §14 country scoping —
  // it is invisible publicly and untouchable by the IN country admin.
  const now = new Date()
  const year = now.getUTCFullYear()
  const jan1 = (y: number): Date => new Date(Date.UTC(y, 0, 1))
  const dec31 = (y: number): Date => new Date(Date.UTC(y, 11, 31))

  interface ExamSeed {
    slug: string
    code: string
    name: string
    organiser: string
    level: 'NATIONAL' | 'STATE' | 'REGIONAL'
    status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'RETIRED'
    countryId: string
    description: string
    versions: Array<{
      label: string
      effectiveFrom: Date
      effectiveTo?: Date | null
      source: string
      notes?: string
    }>
  }

  const examSeeds: ExamSeed[] = [
    {
      slug: 'upsc-civil-services',
      code: 'UPSC-CSE',
      name: 'UPSC Civil Services Examination',
      organiser: 'Union Public Service Commission',
      level: 'NATIONAL',
      status: 'ACTIVE',
      countryId: india.id,
      description:
        'India\'s premier national recruitment examination for the Indian Administrative Service (IAS), Indian Foreign Service (IFS), Indian Police Service (IPS) and other Group A central services — Prelims, Mains and Personality Test.',
      versions: [
        {
          label: `${year - 1} syllabus (superseded)`,
          effectiveFrom: jan1(year - 1),
          effectiveTo: new Date(Date.UTC(year, 5 - 1, 31)), // closed by the current version (§36 auto-close)
          source: `UPSC ${year - 1} Examination Notification — https://upsc.gov.in`,
          notes: 'Historical window preserved for old mappings (§36 old versions stay queryable).',
        },
        {
          label: `${year} syllabus`,
          effectiveFrom: new Date(Date.UTC(year, 5, 1)), // Jun 1 this year
          effectiveTo: null,
          source: `UPSC ${year} Examination Notification — https://upsc.gov.in`,
        },
      ],
    },
    {
      slug: 'ssc-cgl',
      code: 'SSC-CGL',
      name: 'SSC Combined Graduate Level Examination',
      organiser: 'Staff Selection Commission',
      level: 'NATIONAL',
      status: 'ACTIVE',
      countryId: india.id,
      description:
        'Nationwide graduate-level recruitment examination for Group B and Group C posts in ministries, departments and organisations of the Government of India.',
      versions: [
        {
          label: `${year} syllabus`,
          effectiveFrom: jan1(year),
          effectiveTo: dec31(year), // auto-closed by the upcoming version
          source: `SSC ${year} Calendar & Notification — https://ssc.gov.in`,
        },
        {
          label: `${year + 1} syllabus (upcoming)`,
          effectiveFrom: jan1(year + 1),
          effectiveTo: null,
          source: `SSC ${year + 1} Examination Calendar — https://ssc.gov.in`,
          notes: 'Future-dated: demonstrates the UPCOMING state and the pre-effective correction path.',
        },
      ],
    },
    {
      slug: 'mp-police-constable',
      code: 'MP-POLICE-CONSTABLE',
      name: 'MP Police Constable Recruitment Examination',
      organiser: 'Madhya Pradesh Employees Selection Board',
      level: 'STATE',
      status: 'ACTIVE',
      countryId: india.id,
      description:
        'State-level police constable recruitment examination conducted by MP ESB (formerly Vyapam) for the Madhya Pradesh Police Department.',
      versions: [
        {
          label: `${year - 1} recruitment syllabus`,
          effectiveFrom: new Date(Date.UTC(year - 1, 6, 1)), // Jul 1 last year
          effectiveTo: null,
          source: `MP ESB Police Constable Recruitment Rules ${year - 1} — https://esb.mp.gov.in`,
        },
      ],
    },
    {
      slug: 'upsc-engineering-services',
      code: 'UPSC-ESE',
      name: 'UPSC Engineering Services Examination',
      organiser: 'Union Public Service Commission',
      level: 'NATIONAL',
      status: 'DRAFT',
      countryId: india.id,
      description:
        'Recruitment examination for engineering services under the Government of India (preparation in progress — no syllabus version published yet).',
      versions: [], // DRAFT demo: no version yet (P3-S2 attaches SyllabusNodes to versions)
    },
    {
      slug: 'uk-civil-service-fast-stream',
      code: 'UK-FAST-STREAM',
      name: 'Civil Service Fast Stream',
      organiser: 'Cabinet Office (UK Government)',
      level: 'NATIONAL',
      status: 'DRAFT',
      countryId: uk.id,
      description:
        'UK graduate leadership development programme (market not launched yet — exercises §14 country scoping: invisible publicly, untouchable by IN staff).',
      versions: [],
    },
  ]

  let examsSeeded = 0
  let examVersionsSeeded = 0
  for (const seed of examSeeds) {
    const existing = await prisma.exam.findUnique({ where: { slug: seed.slug }, select: { id: true } })
    if (existing) continue
    await prisma.exam.create({
      data: {
        slug: seed.slug,
        code: seed.code,
        name: seed.name,
        organiser: seed.organiser,
        level: seed.level,
        status: seed.status,
        countryId: seed.countryId,
        description: seed.description,
        createdById: admin.id,
        versions: {
          create: seed.versions.map((version) => ({
            label: version.label,
            effectiveFrom: version.effectiveFrom,
            effectiveTo: version.effectiveTo ?? null,
            source: version.source,
            notes: version.notes ?? null,
            createdById: admin.id,
          })),
        },
      },
    })
    examsSeeded += 1
    examVersionsSeeded += seed.versions.length
  }

  console.log(
    `Seed complete → languages: ${[en.code, hi.code, fr.code].join(', ')} | countries: ${[
      `${india.isoCode} (default)`,
      `${uk.isoCode} (coming soon)`,
      `${france.isoCode} (coming soon)`,
    ].join(', ')} | dev admin: ${admin.email} (ADMIN) | dev IN admin: ${inAdmin.email} (COUNTRY_ADMIN) | dev writers: ${writerIn.email} + ${writerHi.email} (Hindi-scoped) | taxonomy: ${topicIdBySlug.size} nodes | knowledge units: ${knowledgeSeeded} | content items: ${contentSeeded} | sources: ${sourceIdByUrl.size} (${linksSeeded} links${aiDraftSeeded ? ', +1 AI-assisted draft update' : ''}) | editorial tasks: ${tasksSeeded} | exams: ${examsSeeded} (${examVersionsSeeded} versions)`
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
