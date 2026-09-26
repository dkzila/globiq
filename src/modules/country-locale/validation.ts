/**
 * GlobIQ — Country & Locale: admin write validation
 * Master Plan §37 (explicit validation errors), §16 (URL space is reserved —
 * slugs may never collide with route words or the default market's languages).
 */
import { z } from 'zod'

/** Route words that can never become country slugs (§16 URL space). */
export const RESERVED_SLUGS = [
  'api', 'admin', 'editor', 'auth', 'account', 'login', 'signup', 'settings',
  'search', 'saved', 'notifications', 'gk', 'exams', 'current-affairs',
  'mock-tests', 'quizzes', 'topics', 'sitemap', 'robots', 'wp-admin',
] as const

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters')
  .max(24, 'Slug must be at most 24 characters')
  .regex(/^[a-z][a-z0-9-]*$/, 'Slug must be lowercase letters, digits and hyphens, starting with a letter')
  .refine((slug) => !RESERVED_SLUGS.includes(slug as (typeof RESERVED_SLUGS)[number]), {
    message: 'This slug is reserved for platform routes',
  })

const isoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, 'ISO code must be exactly 2 letters')
  .regex(/^[A-Z]{2}$/, 'ISO code must be letters only (ISO 3166-1 alpha-2)')

const languageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Language code must be at least 2 characters')
  .max(8, 'Language code must be at most 8 characters')
  .regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'Use a BCP-47 style code, e.g. "en", "hi", "pt-br"')

const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine((tz) => tz === '' || /^([A-Za-z_]+\/[A-Za-z_+-]+|UTC)$/.test(tz), {
    message: 'Use an IANA timezone, e.g. "Asia/Kolkata"',
  })

export const countryStatusSchema = z.enum(['ACTIVE', 'COMING_SOON', 'INACTIVE'])
export const languageStatusSchema = z.enum(['ACTIVE', 'INACTIVE'])
export const directionSchema = z.enum(['LTR', 'RTL'])

/** POST /api/countries */
export const createCountrySchema = z.object({
  isoCode: isoSchema,
  slug: slugSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
  timezone: timezoneSchema.optional(),
  status: countryStatusSchema.default('COMING_SOON'),
  defaultLanguageCode: languageCodeSchema,
})

/** PATCH /api/countries/[iso] */
export const updateCountrySchema = z
  .object({
    slug: slugSchema.optional(),
    name: z.string().trim().min(2).max(80).optional(),
    timezone: timezoneSchema.optional(),
    status: countryStatusSchema.optional(),
    defaultLanguageCode: languageCodeSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' })

/** PUT /api/countries/[iso]/languages */
export const setCountryLanguagesSchema = z.object({
  languageCodes: z
    .array(languageCodeSchema)
    .min(1, 'A country needs at least its default language')
    .max(20, 'At most 20 languages per country'),
})

/** POST /api/languages */
export const createLanguageSchema = z.object({
  code: languageCodeSchema,
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80, 'Name is too long'),
  nativeName: z.string().trim().min(1).max(80).nullable().optional(),
  direction: directionSchema.default('LTR'),
  status: languageStatusSchema.default('ACTIVE'),
})

/** PATCH /api/languages/[code] */
export const updateLanguageSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    nativeName: z.string().trim().min(1).max(80).nullable().optional(),
    direction: directionSchema.optional(),
    status: languageStatusSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: 'Provide at least one field to update' })

export type CreateCountryInput = z.infer<typeof createCountrySchema>
export type UpdateCountryInput = z.infer<typeof updateCountrySchema>
export type SetCountryLanguagesInput = z.infer<typeof setCountryLanguagesSchema>
export type CreateLanguageInput = z.infer<typeof createLanguageSchema>
export type UpdateLanguageInput = z.infer<typeof updateLanguageSchema>
