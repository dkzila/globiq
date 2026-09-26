'use client'

/**
 * GlobIQ — Account section (P1-S2)
 *
 * Consumes the same /api/auth endpoints a future mobile app will use
 * (Master Plan §4, §37, §39): register/login → Bearer token → authenticated
 * calls. Demonstrates the full identity flow on the temporary foundation page.
 */

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  BadgeCheck,
  CalendarClock,
  KeyRound,
  Laptop,
  Loader2,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Trash2,
} from 'lucide-react'

import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/stores/auth'
import type { PublicSession } from '@/modules/identity-access/types'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

// ---------- Validation (client mirror of the API contract) ----------

const signInSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
})

const signUpSchema = z.object({
  name: z.string().trim().max(80, 'Name is too long').optional(),
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .regex(/[a-zA-Z]/, 'Must contain a letter')
    .regex(/[0-9]/, 'Must contain a number'),
})

type SignInValues = z.infer<typeof signInSchema>
type SignUpValues = z.infer<typeof signUpSchema>

// ---------- Helpers ----------

function initials(name: string | null, email: string): string {
  if (name?.trim()) {
    const parts = name.trim().split(/\s+/).slice(0, 2)
    return parts.map((p) => p[0]!.toUpperCase()).join('')
  }
  return email.slice(0, 2).toUpperCase()
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatRelative(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

function sessionIcon(label: string) {
  const l = label.toLowerCase()
  if (l.includes('mobile') || l.includes('iphone') || l.includes('android')) {
    return <Smartphone className="h-4 w-4 text-zinc-400" aria-hidden="true" />
  }
  return <Laptop className="h-4 w-4 text-zinc-400" aria-hidden="true" />
}

const ROLE_LABELS: Record<string, string> = {
  READER: 'Reader',
  WRITER: 'Writer',
  COUNTRY_ADMIN: 'Country Admin',
  ADMIN: 'Admin',
}

// ---------- Section ----------

export function AccountSection() {
  const { status, user, session, error, initialize, signIn, signUp, signOut, listSessions, revokeSession, clearError } =
    useAuth()
  const { toast } = useToast()

  useEffect(() => {
    void initialize()
  }, [initialize])

  const resolved = status === 'authenticated' && user !== null

  return (
    <section aria-labelledby="account-heading" className="mt-10 scroll-mt-24 space-y-4" id="account">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-emerald-600" aria-hidden="true" />
        <h2 id="account-heading" className="text-xl font-semibold tracking-tight">
          Account — token-based identity
        </h2>
      </div>
      <p className="text-sm text-zinc-600">
        Sign in works with opaque Bearer tokens, not browser cookies — the exact contract a future
        mobile app will reuse unchanged (§4, §39). Sessions are server-side, listable and revocable.
      </p>

      {status === 'loading' || status === 'idle' ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-80 rounded-xl" />
          <Skeleton className="h-80 rounded-xl" />
        </div>
      ) : resolved ? (
        <AuthenticatedView
          onSignOut={async () => {
            await signOut()
            toast({ title: 'Signed out', description: 'Your session was revoked server-side.' })
          }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <UnauthenticatedView
            onSignIn={signIn}
            onSignUp={signUp}
            error={error}
            clearError={clearError}
            onSuccess={(name) =>
              toast({ title: `Welcome, ${name ?? 'learner'}!`, description: 'Bearer token issued — you are signed in.' })
            }
          />
          <HowItWorksCard session={session} />
        </div>
      )}
    </section>
  )
}

// ---------- Authenticated view: profile + sessions ----------

function AuthenticatedView({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const { user, session, listSessions, revokeSession } = useAuth()
  const { toast } = useToast()
  const [sessions, setSessions] = useState<PublicSession[] | null>(null)
  const [loadingSessions, setLoadingSessions] = useState(true)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)

  // Initial load — awaits before touching state (no synchronous setState in effect).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await listSessions()
      if (!cancelled) {
        setSessions(result)
        setLoadingSessions(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [listSessions])

  const refresh = useCallback(async () => {
    setLoadingSessions(true)
    const result = await listSessions()
    setSessions(result)
    setLoadingSessions(false)
  }, [listSessions])

  const confirmSession = sessions?.find((s) => s.id === confirmId) ?? null

  async function handleRevoke(id: string) {
    setConfirmId(null)
    setRevokingId(id)
    const result = await revokeSession(id)
    setRevokingId(null)
    if (result === null) return
    if (result.signedOut) {
      toast({ title: 'Session revoked', description: 'That was the current session — you are signed out.' })
    } else {
      toast({ title: 'Session revoked', description: 'That device can no longer use its token.' })
      void refresh()
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="grid gap-4 md:grid-cols-5"
    >
      {/* Profile card */}
      <Card className="border-zinc-200 shadow-sm md:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Your profile</CardTitle>
          <CardDescription>Base user model (§6) — roles &amp; status managed server-side</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12 border border-zinc-200">
              <AvatarFallback className="bg-emerald-50 font-semibold text-emerald-700">
                {initials(user?.name ?? null, user?.email ?? '')}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{user?.name ?? 'Unnamed learner'}</p>
              <p className="truncate text-xs text-zinc-500">{user?.email}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className="bg-emerald-600 font-normal text-white hover:bg-emerald-600">
              <BadgeCheck className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {ROLE_LABELS[user?.role ?? 'READER'] ?? user?.role}
            </Badge>
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 font-normal text-emerald-700">
              Active
            </Badge>
            <Badge variant="outline" className="font-normal text-zinc-500">
              {user?.emailVerified ? 'Email verified' : 'Email unverified'}
            </Badge>
          </div>

          <Separator />

          <dl className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-zinc-500">Home country</dt>
              <dd className="font-medium">{user?.homeCountry ? `${user.homeCountry.name} (${user.homeCountry.isoCode})` : 'Not set'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-zinc-500">Preferred language</dt>
              <dd className="font-medium">{user?.preferredLanguage ? `${user.preferredLanguage.name} (${user.preferredLanguage.code})` : 'Not set'}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-1.5 text-zinc-500">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
                Member since
              </dt>
              <dd className="font-medium">{formatDate(user?.createdAt ?? null)}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-zinc-500">Last sign-in</dt>
              <dd className="font-medium">{formatDate(user?.lastLoginAt ?? null)}</dd>
            </div>
          </dl>

          <Button variant="outline" className="w-full gap-2" onClick={() => void onSignOut()}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </Button>
        </CardContent>
      </Card>

      {/* Sessions card */}
      <Card className="border-zinc-200 shadow-sm md:col-span-3">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Active sessions</CardTitle>
              <CardDescription>
                Every issued Bearer token — revoke any device at any time (§30)
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              onClick={() => void refresh()}
              disabled={loadingSessions}
              aria-label="Refresh sessions"
            >
              <RefreshCw className={`h-4 w-4 ${loadingSessions ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingSessions && !sessions ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : !sessions || sessions.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">No active sessions.</p>
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto pr-1 globiq-scroll" role="list">
              {sessions.map((s) => (
                <li
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {sessionIcon(s.label)}
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium leading-snug">
                        <span className="truncate">{s.label}</span>
                        {s.isCurrent && (
                          <Badge className="bg-zinc-900 px-1.5 text-[10px] font-normal text-white hover:bg-zinc-900">
                            This device
                          </Badge>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        Last used {formatRelative(s.lastUsedAt)} · expires {formatDate(s.expiresAt)}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 px-2 text-red-600 hover:bg-red-50 hover:text-red-700"
                    onClick={() => setConfirmId(s.id)}
                    disabled={revokingId === s.id}
                    aria-label={`Revoke session ${s.label}`}
                  >
                    {revokingId === s.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    )}
                    <span className="hidden sm:inline">Revoke</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Revoke confirmation */}
      <AlertDialog open={confirmSession !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Revoke {confirmSession?.isCurrent ? 'this device (sign out)' : `"${confirmSession?.label}"`}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmSession?.isCurrent
                ? 'This is the current session — you will be signed out immediately.'
                : 'That device will need to sign in again. This cannot be undone.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => confirmSession && void handleRevoke(confirmSession.id)}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}

// ---------- Unauthenticated view: sign in / create account ----------

function UnauthenticatedView({
  onSignIn,
  onSignUp,
  error,
  clearError,
  onSuccess,
}: {
  onSignIn: (email: string, password: string) => Promise<boolean>
  onSignUp: (input: { email: string; password: string; name?: string }) => Promise<boolean>
  error: string | null
  clearError: () => void
  onSuccess: (name: string | null) => void
}) {
  const signInForm = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })
  const signUpForm = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { name: '', email: '', password: '' },
  })

  const [signInBusy, setSignInBusy] = useState(false)
  const [signUpBusy, setSignUpBusy] = useState(false)

  async function handleSignIn(values: SignInValues) {
    setSignInBusy(true)
    const ok = await onSignIn(values.email, values.password)
    setSignInBusy(false)
    if (ok) {
      clearError()
      onSuccess(signInForm.getValues('email').split('@')[0] ?? null)
    }
  }

  async function handleSignUp(values: SignUpValues) {
    setSignUpBusy(true)
    const ok = await onSignUp({
      email: values.email,
      password: values.password,
      name: values.name?.trim() ? values.name.trim() : undefined,
    })
    setSignUpBusy(false)
    if (ok) {
      clearError()
      onSuccess(values.name?.trim() || null)
    }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card className="border-zinc-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Sign in to GlobIQ</CardTitle>
          <CardDescription>
            Accounts unlock personalisation, saved items and exam queues in later phases.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin">
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Create account</TabsTrigger>
            </TabsList>

            {error && (
              <p
                role="alert"
                className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <TabsContent value="signin">
              <Form {...signInForm}>
                <form onSubmit={signInForm.handleSubmit(handleSignIn)} className="space-y-4" noValidate>
                  <FormField
                    control={signInForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signInForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" autoComplete="current-password" placeholder="••••••••" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full bg-emerald-600 text-white hover:bg-emerald-700" disabled={signInBusy}>
                    {signInBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Sign in
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="signup">
              <Form {...signUpForm}>
                <form onSubmit={signUpForm.handleSubmit(handleSignUp)} className="space-y-4" noValidate>
                  <FormField
                    control={signUpForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Name (optional)</FormLabel>
                        <FormControl>
                          <Input autoComplete="name" placeholder="Your name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" autoComplete="email" placeholder="you@example.com" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={signUpForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input
                            type="password"
                            autoComplete="new-password"
                            placeholder="8+ chars, a letter and a number"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="submit"
                    className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                    disabled={signUpBusy}
                  >
                    {signUpBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                    Create account
                  </Button>
                </form>
              </Form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </motion.div>
  )
}

// ---------- Info card: how token auth works ----------

function HowItWorksCard({ session }: { session: PublicSession | null }) {
  return (
    <Card className="h-full border-zinc-200 bg-zinc-900 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-white">
          <ShieldCheck className="h-4 w-4 text-emerald-400" aria-hidden="true" />
          How authentication works
        </CardTitle>
        <CardDescription className="text-zinc-400">
          API-first identity (§4, §37, §39) — no cookies required
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="space-y-3 text-sm text-zinc-300" role="list">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/20 text-xs font-semibold text-emerald-400">
              1
            </span>
            <span>
              <strong className="text-white">Register or sign in</strong> — passwords are hashed with
              scrypt (memory-hard KDF); plaintext never leaves this request.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/20 text-xs font-semibold text-emerald-400">
              2
            </span>
            <span>
              <strong className="text-white">Receive a Bearer token</strong> — 256-bit, opaque, shown
              once. Only its SHA-256 hash is stored server-side.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/20 text-xs font-semibold text-emerald-400">
              3
            </span>
            <span>
              <strong className="text-white">Call any API</strong> with{' '}
              <code className="rounded bg-zinc-800 px-1.5 py-0.5 text-xs text-emerald-400">
                Authorization: Bearer &lt;token&gt;
              </code>{' '}
              — identical for web and future apps.
            </span>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600/20 text-xs font-semibold text-emerald-400">
              4
            </span>
            <span>
              <strong className="text-white">Stay in control</strong> — every session (device) is
              listed and revocable; sign-out kills the token server-side.
            </span>
          </li>
        </ol>
        <Separator className="bg-zinc-800" />
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Try the API</p>
          <code className="block overflow-x-auto rounded-md bg-zinc-800 px-3 py-2 text-xs text-emerald-400">
            curl -X POST /api/auth/login -d {'\'{"email":"…","password":"…"}\''}
          </code>
          {session && (
            <p className="text-xs text-zinc-500">
              Sessions expire after 30 days · rate limiting active (§30)
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
