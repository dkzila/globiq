# GlobIQ — Project Analysis & Execution Readiness Report

**Prepared:** 2025-12-18 (pre-development setup session, before Session P1-S1)
**Governing document:** `GlobIQ_Master_Plan.md` (v2.0 Final) — repo `dkzila/globiq`, sandbox copy at `docs/GlobIQ_Master_Plan.md`
**Credentials reference:** `/home/z/my-project/.globiq/credentials.md` (private, gitignored)

This report is the bridge between the Master Plan and implementation in this sandbox. It records: (1) what the plan says, (2) how the plan maps onto this sandbox's reality, (3) the environment decisions already verified, and (4) exactly what the next session (P1-S1) will do. **It contains no secrets.**

---

## 1. Product in One Paragraph

GlobIQ is a **next-gen global GK & Current Affairs platform** that replaces GK books, magazines, and GK-only coaching with one unified, multilingual, personalised knowledge system. General users get broad, SEO-friendly discovery; exam aspirants get **exam-mapped, personalised, multi-exam-combined** learning — all built on ONE canonical knowledge graph, never duplicated content. Web-first (Next.js), API-first (mobile-app ready later), India as default root market with English default (no `/in` or `/en` in URLs), other countries under `/{country}/` with their own languages.

## 2. The Five Core Architectural Ideas (the heart of the plan)

1. **Knowledge vs Context separation** — `KnowledgeUnit` is canonical knowledge stored ONCE. Country, language, exam, depth, and user state are *rendering dimensions* over it. This is what kills the "one article copy per exam" anti-pattern that every competitor suffers from.
2. **Multi-Exam Combination Engine (Section 11)** — the platform's crown jewel. When a user follows multiple exams (e.g., RRB Group D + MP Police Constable), the system unions their syllabus `ExamMapping`s, deduplicates by canonical `KnowledgeUnit` ID, renders each unit once at the **max required depth**, and badges it "Covers: Exam A + Exam B". It's a **computed view**, never stored.
3. **Follow ≠ Save** — `UserFollow` (exam/topic/entity) is an *ongoing interest signal* driving feeds/recommendations; `SavedItem` → `Collection` is *explicit retrieval*. Structurally separate tables, separate UX.
4. **Versioned exam syllabi** — `Exam` → `ExamVersion` → `SyllabusNode` tree → `ExamMapping` (relevance, priority, `required_depth`, expected_scope, question_likelihood, evidence). Exam changes never break history.
5. **Country as server-side data scope, not a network wall** — geo-location only *routes* first-time visitors; public content stays browsable cross-country; all data/authorization queries are forcibly scoped by `country_id` at the service layer. Editorial roles are country/language-scoped (RBAC + scope checks).

## 3. Canonical Domain Model (Section 6 — ~30 entities)

Core spine: `Country`, `Language`, `User`, `Topic` (taxonomy), `KnowledgeUnit`, `ContentItem`, `QnA`, `Question`, `MockTest`, `TestAttempt`, `Exam`, `ExamVersion`, `SyllabusNode`, `ExamMapping`, `CurrentEvent`, `Entity`, `Source`, `UserFollow`, `SavedItem`, `Collection`, `UserGoal`, `MasteryState`, `Translation`, `ContentFeedback`, `EditorialTask`, `AuditLog`, `SEOPage`, `NotificationPreference`, `NotificationEvent`.

Key entity splits (deliberate, must not be collapsed):
- `QnA` (explanatory, unscored, learning) vs `Question` (assessment MCQ) vs `MockTest` (timed composition of Questions) vs `TestAttempt` (user's scored attempt).
- `ContentItem` (article/explainer representation) vs `KnowledgeUnit` (canonical truth).
- `Translation` references canonical content — never duplicates identity.

## 4. Phase & Session Structure (Sections 40–43)

**One chat = one session. Execute ONLY the requested session. Never auto-advance.**

| Phase | Theme | Sessions |
|---|---|---|
| P0 | Design freeze (scope, domain model, URL/SEO, RBAC, API conventions) | P0-S1…S5 — **already delivered inside the v2.0 document itself** |
| P1 | Foundation (repo/env/CI, auth, country/language, taxonomy, audit) | P1-S1…S5 |
| P2 | Knowledge + content + sources + editorial workflow | P2-S1…S5 |
| P3 | Exams + syllabus + mappings + combination engine | P3-S1…S5 |
| P4 | Search + SEO + country homepages | P4-S1…S5 |
| P5 | Personalisation (follows, saves, dashboard) | P5-S1…S5 |
| P6 | Current affairs system | P6-S1…S5 |
| P7 | QnA/Questions/MockTests/mastery/revision | P7-S1…S5 |
| P8 | Sharing, notifications, feedback loop, analytics | P8-S1…S5 |
| P9 | Multilingual + country launch framework | P9-S1…S5 |
| P10 | Scale + advanced AI + infrastructure evolution | P10-S1…S5 |
| P11 | (Future) Native mobile apps on existing APIs | out of scope |

> **"Session 1" for the next chat = P1-S1** (Initialize application/repository, environments, configuration and CI), because all P0 design outputs are already frozen in the v2.0 document.

## 5. Sandbox Reality vs Plan — Adaptations (IMPORTANT for every future session)

| # | Plan requirement | Sandbox reality | Adaptation decision |
|---|---|---|---|
| A1 | Relational DB (PG via Supabase) for production/Vercel | Sandbox default is SQLite; **direct PG port 5432 to `db.*.supabase.co` is BLOCKED**, but the **session pooler (`aws-0-ap-south-1.pooler.supabase.com:5432`) is OPEN and VERIFIED with Prisma** | **Develop directly on Supabase PostgreSQL via session pooler from day one** (full production parity; no SQLite↔PG drift). Vercel uses direct/pooled connection. SQLite template is retired in P1-S1. |
| A2 | Many canonical routes (`/gk/{topic}`, `/current-affairs`, `/exams/{exam}`, `/{country}/{lang}/`…) | Sandbox preview constraint: the **`/` route is the only user-verified entry** | `/` = India default (English) homepage = the country discovery hub (Section 34). **Every other route must be reachable via client-side navigation from `/`** so the full platform is explorable from the preview. No orphan URL-only pages. |
| A3 | API-first: versioned internal APIs consumed by web (Section 37, 4) | Sandbox rule: **use API routes, not server actions** | Perfect alignment — implement all domain operations as `/api/*` route handlers (App Router), frontend fetches them. This also keeps future mobile-app parity. |
| A4 | Modular monolith, 18 logical modules (Section 28) | Next.js 16 App Router project exists (template) | Implement as `src/modules/<module>/` folders with explicit service interfaces + `src/app/api/*` thin handlers. |
| A5 | CI in P1-S1 | Sandbox has no CI runner | Add a GitHub Actions workflow (lint + type-check) that runs on the GitHub repo after the sandbox project is synced there. |
| A6 | Repo `dkzila/globiq` as deploy source for Vercel | Sandbox project is a local git repo (branch `main`) not yet connected to GitHub | P1-S1 connects remotes and pushes the project; repo root will contain the Next.js app. The existing root-level `GlobIQ_Master_Plan.md` stays as the governing doc. |
| A7 | Editorial console as separate protected surface (Section 18–20, 38) | Only one public app surface in sandbox | Build editorial under protected routes (`/editorial/*`) + scoped RBAC middleware, separate from the public app in the same deployable (Section 38 allows "protected path" as the plan's own recommended option). |
| A8 | Deploy target: Vercel free subdomain, custom domain later | — | Keep repo Vercel-ready: standard `next build`, env vars documented in `.globiq/credentials.md` + `.env.local`. No domain work until user decides. |

## 6. Environment Decisions (VERIFIED, do not re-litigate)

1. **DB = Supabase PostgreSQL** (project ref `kbezlaqsvvlmgllkvszn`, Mumbai). Sandbox dev connection = session pooler (verified with Prisma `db pull` on 2025-12-18; DB currently empty). Pooler username format: `postgres.kbezlaqsvvlmgllkvszn`.
2. **Prisma provider switches `sqlite` → `postgresql` in P1-S1**, `DATABASE_URL` moves to `.env.local` (currently left as commented lines there so the template app keeps working until then).
3. **Stack** (already in sandbox, matches plan): Next.js 16 App Router, TypeScript 5, Tailwind CSS 4 + shadcn/ui (New York), Prisma 6, NextAuth v4 (token-based auth requirement — P1-S2), next-intl (multilingual URLs — P1-S3), TanStack Query, Zustand.
4. **GitHub**: repo `dkzila/globiq` (public) is the single deploy source; token saved in `.globiq/credentials.md` + `.env.local` (gitignored).
5. **Secrets policy**: `.env*` and `.globiq/` are gitignored — verified. No secret ever committed. `.env.local` never uses `NEXT_PUBLIC_` for server-only keys.

## 7. What Session P1-S1 ("Session 1") Will Do — Proposed Scope

1. **Project identity:** rename package to `globiq`, GlobIQ branding in layout/metadata, minimal placeholder homepage (India default) so `/` remains previewable.
2. **Database switch:** Prisma schema → `postgresql` provider, `DATABASE_URL` = Supabase session pooler (from `.env.local`), first `prisma db push` with the **P1 core schema only** (`Country`, `Language`, `User` base — per plan P1 sessions; full domain model lands progressively in P1-S2+).
3. **Modular monolith skeleton:** `src/modules/` with the 18 logical module folders + service interface pattern; `src/app/api/health` example route proving the API-first pattern.
4. **Git/GitHub sync:** add authenticated remote, initial commit/push of the app to `dkzila/globiq` (keeping `GlobIQ_Master_Plan.md` at root), `.gitignore` verified safe (credentials excluded).
5. **CI:** GitHub Actions workflow (`lint` + `prisma validate` + type-check) on push.
6. **Config foundations:** central `src/config/` (country/language seed config per Section 14/35), seed script skeleton (Section 45).
7. **Docs:** update `worklog.md`, session report per the Session Template (Section 42).

Out of scope for P1-S1 (later sessions): auth (P1-S2), country/language routing (P1-S3), taxonomy CRUD (P1-S4), audit middleware (P1-S5).

## 8. Risks / Watch-items

- **Pooler stability from sandbox** — if the pooler ever gets blocked mid-project, fallback = temporary local SQLite dev with a PG-compatible schema + deployment-time `db push` to Supabase (documented; last resort only).
- **Supabase free tier pauses** inactive projects — remind user to keep the project active during long gaps between sessions.
- **GitHub token** is a classic PAT with broad repo scope — recommend the user rotates it eventually and never pastes it in chats again (it's now saved in the sandbox; future sessions must read from `.globiq/credentials.md`).
- **One session per chat discipline** — the plan's Section 41/48 execution rule will be followed strictly; no silent scope expansion.

## 9. Session Quick-Reference (for the user)

- Next chat: say **"Start P1-S1"** (or "Session 1 शुरू करो").
- Each later chat: **"Start P1-S2"**, **"Start P2-S1"**, etc.
- Every session ends with: implementation summary, changed files, schema/API changes, acceptance results, unresolved issues, and the exact next session name.
