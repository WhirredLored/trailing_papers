# PaperTrail — Contractor Software Project Pack

Field-first contracting software: estimate → e-signed approval → phase-tagged photo evidence
with logged hours → change orders → invoice → payment.

Each C-file is ONE complete, self-contained prompt — project context, domain model, ten
architecture laws, conventions, and its verbatim commit message are all baked in. Copy a whole
file into a session, or hand the directory to an agent.

ORDER: C01 → C21, one prompt = one commit. Milestone gates in MILESTONES.md are real gates —
M1's tenancy gate especially. Do not build on unproven isolation.

## Name
"PaperTrail" is a placeholder. It appears only in company-facing copy and branding constants,
so renaming is a small change — but run a USPTO search and a domain check before printing
anything, as the term is common.

## What makes this different from Joist
The evidence chain. Competitors stop at estimate→invoice. This tracks every document the client
saw, every signature with an audit certificate, every change order, and every phase-tagged
photo — and C19 exports the whole thing as one verifiable packet. That is the feature you can
charge for and the one that saves a contractor a five-figure dispute.

## Setup

Requires Node 20.11+ (developed on 24) and a Supabase project.

```bash
npm install
cp .env.example .env.local   # fill in Supabase values
npm run dev                  # http://localhost:3000
```

Checks that must pass before any commit is done:

```bash
npm run build && npm run test && npm run lint
```

`npm run typecheck` and `npm run format` are available too.

### Environment

Every variable is named and commented in `.env.example`. The one rule that matters:
`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security, so it is server-only and never
prefixed with `NEXT_PUBLIC_`. Import `lib/supabase-browser.ts` from components and pages;
`lib/supabase-server.ts` throws if it is ever evaluated in a browser, and ESLint blocks the
import from `pages/` and `components/`.

### Layout

```
pages/          routes (Pages Router); pages/api/ for REST-ish endpoints
components/     React components
lib/            money.ts (integer cents), Supabase client factories
types/          shared TypeScript types, generated DB types
supabase/       timestamped SQL migrations, never edited after being applied
docs/           DECISIONS.md — one line per judgment call
```
