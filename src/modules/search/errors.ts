/**
 * GlobIQ — Search module: typed errors (P4-S1)
 * Master Plan §37 (explicit, actionable errors; client-agnostic mapping) —
 * the same pattern every module follows.
 */

export type SearchErrorCode =
  | 'COUNTRY_NOT_FOUND'
  | 'LANGUAGE_NOT_FOUND'
  | 'EXAM_NOT_FOUND'
  | 'SEARCH_FAILED'

const STATUS_BY_CODE: Record<SearchErrorCode, number> = {
  COUNTRY_NOT_FOUND: 404,
  LANGUAGE_NOT_FOUND: 404,
  EXAM_NOT_FOUND: 404,
  SEARCH_FAILED: 500,
}

export class SearchError extends Error {
  readonly code: SearchErrorCode
  readonly status: number

  constructor(code: SearchErrorCode, message: string) {
    super(message)
    this.name = 'SearchError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
  }
}

/** Maps a thrown error to the §37 API envelope payload, or null. */
export function toSearchErrorResponse(
  error: unknown
): { code: string; message: string; status: number } | null {
  if (error instanceof SearchError) {
    return { code: error.code, message: error.message, status: error.status }
  }
  return null
}
