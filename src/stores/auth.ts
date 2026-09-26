'use client'

/**
 * GlobIQ — client auth state (P1-S2)
 *
 * The website consumes the exact same token-based /api/auth endpoints a future
 * mobile app will use (Master Plan §4, §37, §39). The Bearer token is kept in
 * localStorage via zustand persist; user/session state is always re-verified
 * against the server — the client never trusts its own cache for identity.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { PublicSession, PublicUser } from '@/modules/identity-access/types'

// ---------- API envelope (mirrors src/lib/api/response.ts) ----------

interface Envelope<T> {
  status: 'ok' | 'error'
  data?: T
  error?: { code: string; message: string; details?: unknown }
}

async function api<T>(path: string, init: RequestInit & { token?: string | null } = {}): Promise<Envelope<T>> {
  const { token, headers, ...rest } = init
  try {
    const response = await fetch(path, {
      ...rest,
      headers: {
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      cache: 'no-store',
    })
    return (await response.json()) as Envelope<T>
  } catch {
    return { status: 'error', error: { code: 'NETWORK', message: 'Network error — please retry.' } }
  }
}

// ---------- Store ----------

export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated'

interface Grant {
  token: string
  expiresAt: string
  session: PublicSession
}

interface AuthStore {
  token: string | null
  user: PublicUser | null
  session: PublicSession | null
  status: AuthStatus
  error: string | null
  /** Re-validates a persisted token against /api/auth/me. */
  initialize: () => Promise<void>
  signIn: (email: string, password: string) => Promise<boolean>
  signUp: (input: { email: string; password: string; name?: string }) => Promise<boolean>
  signOut: () => Promise<void>
  listSessions: () => Promise<PublicSession[] | null>
  revokeSession: (id: string) => Promise<{ signedOut: boolean } | null>
  clearError: () => void
}

export const useAuth = create<AuthStore>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      session: null,
      status: 'idle',
      error: null,

      initialize: async () => {
        const token = get().token
        if (!token) {
          set({ status: 'unauthenticated', user: null, session: null })
          return
        }
        set({ status: 'loading', error: null })
        const result = await api<{ user: PublicUser; session: PublicSession }>('/api/auth/me', { token })
        if (result.status === 'ok' && result.data) {
          set({ user: result.data.user, session: result.data.session, status: 'authenticated' })
        } else {
          // Token expired/revoked server-side — drop it (§30).
          set({ token: null, user: null, session: null, status: 'unauthenticated' })
        }
      },

      signIn: async (email, password) => {
        set({ error: null })
        const result = await api<{ user: PublicUser; grant: Grant }>('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        })
        if (result.status === 'ok' && result.data) {
          set({
            token: result.data.grant.token,
            user: result.data.user,
            session: result.data.grant.session,
            status: 'authenticated',
          })
          return true
        }
        set({ error: result.error?.message ?? 'Sign-in failed' })
        return false
      },

      signUp: async (input) => {
        set({ error: null })
        const result = await api<{ user: PublicUser; grant: Grant }>('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify(input),
        })
        if (result.status === 'ok' && result.data) {
          set({
            token: result.data.grant.token,
            user: result.data.user,
            session: result.data.grant.session,
            status: 'authenticated',
          })
          return true
        }
        set({ error: result.error?.message ?? 'Registration failed' })
        return false
      },

      signOut: async () => {
        const token = get().token
        // Best-effort server revocation — local state clears regardless.
        if (token) void api('/api/auth/logout', { method: 'POST', token })
        set({ token: null, user: null, session: null, status: 'unauthenticated', error: null })
      },

      listSessions: async () => {
        const token = get().token
        if (!token) return null
        const result = await api<{ sessions: PublicSession[]; currentSessionId: string }>(
          '/api/auth/sessions',
          { token }
        )
        if (result.status === 'ok' && result.data) return result.data.sessions
        if (result.error?.code === 'UNAUTHORIZED') get().signOut()
        return null
      },

      revokeSession: async (id) => {
        const token = get().token
        if (!token) return null
        const result = await api<{ signedOut: boolean }>(`/api/auth/sessions/${id}`, {
          method: 'DELETE',
          token,
        })
        if (result.status === 'ok' && result.data) return result.data
        if (result.error?.code === 'UNAUTHORIZED') get().signOut()
        return null
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'globiq-auth',
      // Persist only the token — everything else is re-verified server-side.
      partialize: (state) => ({ token: state.token }),
    }
  )
)
