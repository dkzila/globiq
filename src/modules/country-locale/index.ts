/**
 * GlobIQ — Country & Locale module (Master Plan §28, §43 P1-S3)
 *
 * Public interface. Other modules and route handlers import from here only.
 */
export {
  LocaleError,
  toLocaleErrorResponse,
  listPublicCountries,
  getPublicCountry,
  resolveLocaleContext,
  resolveFromPath,
  findActiveCountryByIso,
  findActiveLanguageByCode,
  isLanguageConfiguredForCountry,
  createCountry,
  updateCountry,
  setCountryLanguages,
  listAdminLanguages,
  createLanguage,
  updateLanguage,
} from './service'
export type { LocaleRequestMeta } from './service'
export { buildCanonicalUrl } from './url'
export { RESERVED_SLUGS } from './validation'
export {
  createCountrySchema,
  updateCountrySchema,
  setCountryLanguagesSchema,
  createLanguageSchema,
  updateLanguageSchema,
} from './validation'
export type {
  CreateCountryInput,
  UpdateCountryInput,
  SetCountryLanguagesInput,
  CreateLanguageInput,
  UpdateLanguageInput,
} from './validation'
export type {
  AdminLanguage,
  CountryStatusPublic,
  LanguageDirectionPublic,
  LanguageStatusPublic,
  LocaleResolution,
  PublicCountry,
  PublicLanguageRef,
} from './types'
