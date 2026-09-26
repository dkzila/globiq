'use client'

/**
 * GlobIQ — App Shell (P4-S2)
 *
 * The public product surface (§38): the §34 country homepage at the §16 root
 * default, the §33 topic landing pages and the §22 knowledge pages — with
 * the §15 country switcher and §35 language switcher always available in the
 * header, and the foundation console (every prior session's verification
 * surface) one click away. In-app navigation mirrors the §16 URL grammar
 * after the hash (#/hi/gk/polity-governance/…) — one grammar, one source of
 * URL truth, driven by the live country/language configuration (§35).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowUpRight,
  Globe,
  Languages,
  MapPin,
  SquareTerminal,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { PLATFORM } from '@/config/platform'
import { HeaderAuth } from '@/components/auth/header-auth'
import { ConsoleView } from '@/components/home/console-view'
import { HomepageView } from '@/components/home/homepage-view'
import { TopicLandingView } from '@/components/home/topic-landing-view'
import { UnitView } from '@/components/home/unit-view'
import { navigateHash, useHashRoute } from '@/components/home/hash-router'
import type { ApiCountry, Envelope } from '@/components/home/types'

export default function GlobIQApp() {
  // ---------- Locale configuration (§35 — the switchers' source of truth) ----------
  const [config, setConfig] = useState<ApiCountry[] | null>(null)
  const [configError, setConfigError] = useState(false)

  useEffect(() => {
    fetch('/api/countries', { cache: 'no-store' })
      .then((response) => response.json())
      .then((payload: Envelope<{ countries: ApiCountry[] }>) => {
        if (payload.status === 'ok' && payload.data) {
          setConfig(payload.data.countries)
        } else {
          setConfigError(true)
        }
      })
      .catch(() => setConfigError(true))
  }, [])

  const route = useHashRoute(config)

  // Scroll behaviour: view changes start at the top; #account lands on the
  // account section (the header Sign-in anchor keeps working).
  useEffect(() => {
    if (!route) return
    if (route.view === 'console' && route.scrollTo) {
      const timer = window.setTimeout(() => {
        document.getElementById(route.scrollTo ?? '')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 150)
      return () => window.clearTimeout(timer)
    }
    window.scrollTo({ top: 0 })
  }, [route])

  // ---------- Navigation (§16 grammar after the hash) ----------

  const goHome = useCallback(() => {
    if (!config || !route) return
    navigateHash(
      { view: 'home', countryIso: route.countryIso, language: route.language, topicSlug: null, unitSlug: null },
      config
    )
  }, [config, route])

  const openTopic = useCallback(
    (slug: string) => {
      if (!config || !route) return
      navigateHash(
        { view: 'topic', countryIso: route.countryIso, language: route.language, topicSlug: slug, unitSlug: null },
        config
      )
    },
    [config, route]
  )

  const openUnit = useCallback(
    (topicSlug: string, unitSlug: string) => {
      if (!config || !route) return
      navigateHash(
        { view: 'unit', countryIso: route.countryIso, language: route.language, topicSlug, unitSlug },
        config
      )
    },
    [config, route]
  )

  // Addressable pagination: the page lives in the hash (?page=N), so the
  // back button walks pages and every topic switch starts clean at page 1.
  const goTopicPage = useCallback(
    (page: number) => {
      if (!config || !route || !route.topicSlug) return
      navigateHash(
        {
          view: 'topic',
          countryIso: route.countryIso,
          language: route.language,
          topicSlug: route.topicSlug,
          unitSlug: null,
          page,
        },
        config
      )
    },
    [config, route]
  )

  const switchLanguage = useCallback(
    (code: string) => {
      if (!config || !route) return
      navigateHash(
        {
          view: route.view === 'console' ? 'home' : route.view,
          countryIso: route.countryIso,
          language: code,
          topicSlug: route.topicSlug,
          unitSlug: route.unitSlug,
          page: route.page,
        },
        config
      )
    },
    [config, route]
  )

  const switchCountry = useCallback(
    (iso: string) => {
      if (!config || !route) return
      const target = config.find((entry) => entry.isoCode === iso)
      if (!target) return
      // §15: deliberate country switching lands on that country's homepage.
      navigateHash(
        {
          view: 'home',
          countryIso: target.isoCode,
          language: target.defaultLanguage.code,
          topicSlug: null,
          unitSlug: null,
        },
        config
      )
    },
    [config, route]
  )

  const goConsole = useCallback(() => {
    if (!config || !route) return
    navigateHash(
      { view: 'console', countryIso: route.countryIso, language: route.language, topicSlug: null, unitSlug: null },
      config
    )
  }, [config, route])

  // The homepage's Sign-in CTA routes to the console's account section —
  // the same '#account' anchor the header uses (§38: one auth surface).
  const goSignIn = useCallback(() => {
    window.location.hash = '#account'
  }, [])

  // ---------- Header switcher data ----------

  const currentCountry = useMemo(
    () => (config && route ? config.find((entry) => entry.isoCode === route.countryIso) ?? null : null),
    [config, route]
  )

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900">
      {/* ---------- Header ---------- */}
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/85 backdrop-blur">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
          <div className="flex h-16 items-center justify-between gap-3">
            <button
              type="button"
              onClick={goHome}
              className="flex min-h-[44px] items-center gap-3 text-left"
              aria-label="GlobIQ home"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-600" aria-hidden="true">
                <Globe className="h-5 w-5 text-white" />
              </span>
              <span className="leading-tight">
                <span className="block text-lg font-semibold tracking-tight">GlobIQ</span>
                <span className="hidden text-xs text-zinc-500 sm:block">{PLATFORM.tagline}</span>
              </span>
            </button>

            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="hidden shrink-0 border-emerald-200 bg-emerald-50 text-emerald-700 lg:inline-flex"
              >
                Phase 4 · Session 2 — Homepages &amp; Landing Pages
              </Badge>
              <HeaderAuth />
            </div>
          </div>

          {/* §15/§35 switchers + console link — always available */}
          <div className="flex flex-wrap items-center gap-2 pb-3">
            <div className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              <span className="sr-only">Country</span>
              <Select
                value={route?.countryIso ?? ''}
                onValueChange={switchCountry}
                disabled={!config}
              >
                <SelectTrigger
                  className="h-9 w-[150px] border-zinc-200 bg-white text-sm font-medium"
                  aria-label="Switch country"
                >
                  <SelectValue placeholder={config ? 'Country' : 'Loading…'} />
                </SelectTrigger>
                <SelectContent>
                  {(config ?? []).map((entry) => (
                    <SelectItem key={entry.isoCode} value={entry.isoCode} className="text-sm">
                      {entry.name}
                      {entry.status === 'COMING_SOON' && (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-amber-600">
                          soon
                        </span>
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
              <span className="sr-only">Language</span>
              <Select
                value={route?.language ?? ''}
                onValueChange={switchLanguage}
                disabled={!currentCountry}
              >
                <SelectTrigger
                  className="h-9 w-[150px] border-zinc-200 bg-white text-sm font-medium"
                  aria-label="Switch language"
                >
                  <SelectValue placeholder={currentCountry ? 'Language' : '—'} />
                </SelectTrigger>
                <SelectContent>
                  {(currentCountry?.languages ?? []).map((entry) => (
                    <SelectItem key={entry.code} value={entry.code} className="text-sm">
                      {entry.nativeName ?? entry.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-9 gap-2 px-2.5 text-zinc-500 hover:text-zinc-900"
              onClick={goConsole}
            >
              <SquareTerminal className="h-4 w-4" aria-hidden="true" />
              Console
            </Button>
          </div>
        </div>
      </header>

      {/* ---------- Main (§34/§33/§22 views + console) ---------- */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
        {configError ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            Could not load the country configuration. Refresh the page to retry.
          </div>
        ) : !config || !route ? (
          <div className="space-y-6" aria-busy="true" aria-label="Loading GlobIQ">
            <div className="space-y-3">
              <Skeleton className="h-6 w-64" />
              <Skeleton className="h-10 w-full max-w-xl" />
              <Skeleton className="h-11 w-full max-w-2xl" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3].map((index) => (
                <Skeleton key={index} className="h-44 w-full rounded-xl" />
              ))}
            </div>
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ) : route.view === 'console' ? (
          <ConsoleView onBackHome={goHome} />
        ) : route.view === 'topic' && route.topicSlug ? (
          <TopicLandingView
            key={`${route.countryIso}:${route.language}:${route.topicSlug}`}
            slug={route.topicSlug}
            countryIso={route.countryIso}
            language={route.language}
            page={route.page}
            onPageChange={goTopicPage}
            onOpenTopic={openTopic}
            onOpenUnit={openUnit}
            onGoHome={goHome}
          />
        ) : route.view === 'unit' && route.topicSlug && route.unitSlug ? (
          <UnitView
            key={`${route.countryIso}:${route.language}:${route.unitSlug}`}
            topicSlug={route.topicSlug}
            unitSlug={route.unitSlug}
            country={route.countryIso}
            language={route.language}
            onOpenTopic={openTopic}
            onOpenUnit={openUnit}
            onSwitchLanguage={switchLanguage}
          />
        ) : (
          <HomepageView
            key={`${route.countryIso}:${route.language}`}
            countryIso={route.countryIso}
            language={route.language}
            onOpenTopic={openTopic}
            onOpenUnit={openUnit}
            onSwitchLanguage={switchLanguage}
            onSignIn={goSignIn}
          />
        )}
      </main>

      {/* ---------- Footer (sticky bottom, §16 build reference) ---------- */}
      <footer className="mt-auto border-t border-zinc-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:px-6">
          <div className="text-sm text-zinc-500">
            <span className="font-semibold text-zinc-900">GlobIQ</span> · © 2025 dkzila · Built per{' '}
            <span className="font-medium text-zinc-700">GlobIQ_Master_Plan.md v2.0</span>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-1.5 px-2 text-zinc-500 hover:text-zinc-900"
              onClick={goConsole}
            >
              <SquareTerminal className="h-4 w-4" aria-hidden="true" />
              Foundation console
            </Button>
            <a
              href="https://github.com/dkzila/globiq"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-medium text-emerald-700 hover:text-emerald-800"
            >
              GitHub Repository
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
