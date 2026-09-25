/**
 * GlobIQ — API Response Conventions
 * Master Plan §37 (API Principles): client-agnostic, explicit validation errors,
 * stable envelope. All /api routes use these helpers so the future mobile app
 * can consume identical responses (§4, §39).
 */
import { NextResponse } from 'next/server'

export interface ApiMeta {
  timestamp: string
}

export interface ApiSuccess<T> {
  status: 'ok'
  data: T
  meta: ApiMeta
}

export interface ApiErrorBody {
  status: 'error'
  error: {
    code: string
    message: string
    details?: unknown
  }
  meta: ApiMeta
}

function meta(): ApiMeta {
  return { timestamp: new Date().toISOString() }
}

/** Success envelope: `{ status: 'ok', data, meta }`. */
export function ok<T>(data: T, init?: ResponseInit): NextResponse<ApiSuccess<T>> {
  return NextResponse.json({ status: 'ok', data, meta: meta() }, init)
}

/** Error envelope: `{ status: 'error', error: { code, message }, meta }`. */
export function fail(
  message: string,
  code = 'INTERNAL_ERROR',
  status = 500,
  details?: unknown
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { status: 'error', error: { code, message, details }, meta: meta() },
    { status }
  )
}

/** Common error factories (explicit, actionable messages — §37). */
export const errors = {
  badRequest: (message: string, details?: unknown) => fail(message, 'BAD_REQUEST', 400, details),
  notFound: (what: string) => fail(`${what} not found`, 'NOT_FOUND', 404),
  serviceUnavailable: (message: string) => fail(message, 'SERVICE_UNAVAILABLE', 503),
} as const
