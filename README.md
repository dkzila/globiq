# GlobIQ

**Next-Gen Global GK & Current Affairs Platform** — one unified, multilingual, personalised knowledge system for general learners and exam aspirants. Built to replace GK books, current-affairs magazines and GK-only coaching.

> **Governing specification:** [`GlobIQ_Master_Plan.md`](./GlobIQ_Master_Plan.md) (v2.0)
> All development follows its phase/session roadmap — **one chat = one session** (§41–§43).

## Current Status

**Phase 1 · Session 1 (P1-S1) — Foundation initialized.**
Environments, PostgreSQL database (Supabase), modular monolith contract, internal APIs and CI are live. Session reports live in [`docs/sessions/`](./docs/sessions).

## Core Architecture (in one paragraph)

Knowledge is canonical (`KnowledgeUnit`) and stored once; country, language, exam, depth and user state are *rendering dimensions* over it. Exams map to knowledge through versioned syllabus trees (`ExamVersion` → `SyllabusNode` → `ExamMapping`), so a learner following multiple exams gets a **deduplicated combined queue** ("Covers: Exam A + Exam B") computed on the fly — never duplicated content. Follow and Save are separate concepts; country is a first-class, server-side scope; every authenticated capability is exposed through client-agnostic APIs so native mobile apps later require no backend redesign.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS 4 + shadcn/ui (New York) |
| Database | PostgreSQL on Supabase + Prisma ORM |
| Runtime/CI | Bun · GitHub Actions |

## Getting Started

```bash
bun install
cp .env.example .env    # set GLOBIQ_DATABASE_URL to your Supabase Postgres string
bun run db:generate     # generate Prisma client
bun run db:push         # create tables
bun run db:seed         # seed languages + countries (India default, en + hi)
bun run dev             # http://localhost:3000
```

## Scripts

| Command | Purpose |
|---|---|
| `bun run dev` | Dev server (port 3000) |
| `bun run lint` | ESLint |
| `bun run type-check` | TypeScript check (`tsc --noEmit`) |
| `bun run db:generate` | Generate Prisma client |
| `bun run db:push` | Push schema to database |
| `bun run db:seed` | Seed foundation data |

## Project Structure

```
prisma/             Schema + seed (foundation: Country, Language, base User)
src/app/            App Router — public pages + /api routes
src/app/api/        Internal APIs (health; domain APIs grow per session)
src/modules/        Modular monolith — 18-module registry (architecture contract)
src/config/         Platform constants + phase roadmap
src/lib/            Shared kernel (db client, API response envelope, utils)
docs/sessions/      Session reports (one per executed session)
```

## API Conventions

All internal APIs return the envelope `{ status, data | error, meta }` (Master Plan §37) and are client-agnostic — the same contract will serve future native apps.

- `GET /api/health` — platform & database health with seed snapshot

## Deployment (Vercel)

1. Import this repository in Vercel (auto-detects Next.js).
2. Set the environment variable `GLOBIQ_DATABASE_URL` to your Supabase Postgres **direct** connection string (Supabase → Project Settings → Database).
3. Deploy.

> Note: the variable is deliberately named `GLOBIQ_DATABASE_URL` (not `DATABASE_URL`) so injected/stale environment values can never override the intended connection.

## Development Protocol

One chat/session = one unit of work (Master Plan §41–§48):
- Execute only the requested session; never start the next one without explicit instruction.
- Preserve existing contracts; prefer small, testable, reversible changes.
- After each session: update the schema/docs affected and add a report in `docs/sessions/`.

---

© 2025 dkzila · GlobIQ
