'use client'

/**
 * GlobIQ — header auth area (P1-S2)
 * Shows the signed-in user chip or a "Sign in" anchor to #account.
 */
import { LogIn, LogOut } from 'lucide-react'

import { useAuth } from '@/stores/auth'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

export function HeaderAuth() {
  const { status, user, signOut } = useAuth()

  if (status === 'authenticated' && user) {
    const initial = (user.name?.trim() ?? user.email).slice(0, 1).toUpperCase()
    return (
      <div className="flex shrink-0 items-center gap-2">
        <span className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white py-1 pl-1 pr-3 sm:flex">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="bg-emerald-50 text-xs font-semibold text-emerald-700">
              {initial}
            </AvatarFallback>
          </Avatar>
          <span className="max-w-[140px] truncate text-sm font-medium">{user.name ?? user.email}</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 gap-2 px-2 text-zinc-500 hover:text-zinc-900"
          onClick={() => void signOut()}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline">Sign out</span>
        </Button>
      </div>
    )
  }

  return (
    <Button
      asChild
      size="sm"
      className="h-9 bg-emerald-600 text-white hover:bg-emerald-700"
    >
      <a href="#account">
        <LogIn className="h-4 w-4" aria-hidden="true" />
        Sign in
      </a>
    </Button>
  )
}
