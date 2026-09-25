/**
 * GlobIQ — Platform Configuration
 * Single source of truth for platform-level constants (Master Plan §0, §14, §34).
 * India is the default root market; English is India's default language —
 * neither appears in default URLs (§16, Appendix B).
 */
export const PLATFORM = {
  name: 'GlobIQ',
  tagline: 'Next-Gen Global GK & Current Affairs Platform',
  description:
    'One unified, multilingual, personalised knowledge system for general learners and exam aspirants — replacing GK books, magazines and GK-only coaching.',
  version: '0.1.0',
  spec: {
    document: 'GlobIQ_Master_Plan.md',
    version: '2.0',
  },
  database: {
    provider: 'PostgreSQL',
    host: 'Supabase',
    region: 'ap-south-1 (Mumbai)',
  },
  /** Default market — served at "/" with no country or language URL segment (§16). */
  defaultMarket: {
    country: 'India',
    isoCode: 'IN',
    language: 'English',
    languageCode: 'en',
  },
} as const

export type Platform = typeof PLATFORM
