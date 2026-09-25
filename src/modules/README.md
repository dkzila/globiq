# GlobIQ — Modular Monolith (src/modules)

The platform is one well-bounded deployable application (Master Plan §28) with
**18 logical modules**. Each module receives its implementation in the session
scheduled by the Master Plan (§43) — see the registry in `index.ts`.

## Rules

1. A module folder (`src/modules/<key>/`) is created **only when its session starts**.
2. Modules expose explicit service interfaces; route handlers in `src/app/api/*`
   stay thin and delegate to module services (§37: domain-oriented, client-agnostic APIs).
3. High-load modules (e.g. Search, Questions & Assessment) may be extracted later
   without changing the domain model (§29) — boundaries matter, not infrastructure.

## Registry

See `src/modules/index.ts` — the single source of truth for module keys, phases,
sessions and statuses.
