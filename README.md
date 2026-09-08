# PaperTrail

**Field-first contracting software built around an unbroken evidence chain.**

Estimate → e-signed approval → phase-tagged photo evidence with logged hours → change
orders → invoice → payment. Built for a residential contractor standing on a jobsite with
one hand free and no signal.

> **Status:** M1 complete. Multi-tenant foundation, CRM, money core and catalog are shipped
> and running against a live Supabase project. Estimating (C07) is in progress. Documents,
> signatures and payments are specified but not yet built — see the [roadmap](prompts/).

---

## The problem

Competitors handle estimate → invoice. Contractors don't lose money on invoicing; they lose
it on **disputes and unsigned change orders**. When a homeowner says _"I never approved
that,"_ the contractor needs the record — and usually doesn't have one.

PaperTrail's differentiator is that every document a client saw, every signature, every
change order and every photo is timestamped, attributed, and immutable once issued.
Anywhere convenience and an auditable record conflict, the record wins.

## What's built

| Area                  | Detail                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| **Multi-tenant auth** | Roles from `app_metadata` (never user-writable `user_metadata`), invite tokens, password reset |
| **Tenant isolation**  | RLS policies on every table, enforced in Postgres — proven by a live cross-tenant test suite   |
| **Company profile**   | Branding, license and insurance expiry tracking, logo storage with scoped policies             |
| **CRM**               | Clients, properties, projects — with a duplicate-detection guard on client creation            |
| **Money core**        | Integer cents end to end, a pure totals engine, no float ever touches a dollar                 |
| **Catalog**           | Price book, bulk repricing, CSV import with dry-run validation, full price history             |

11 tables, 4 migrations, **101 tests passing**. `build`, `lint` and `typecheck` are green.

## Architecture decisions that shaped everything

**Tenancy is enforced in the database, not the application.** Every table carries
`company_id` with an RLS policy keyed to the caller. No query anywhere relies on an
application-layer filter for isolation. A missing RLS policy is treated as a security
defect, not a TODO.

**Roles come from `app_metadata`.** `user_metadata` is user-writable — treating it as
authorization is privilege escalation. Every API route re-checks; middleware is a
convenience, not a control.

**Money is integer cents.** One module owns all formatting and arithmetic, with a runtime
guard that throws if a float reaches it. Totals are always recomputed server-side.

**The service-role key cannot reach the browser.** `lib/supabase-server.ts` throws at module
evaluation if `window` is defined, with an ESLint rule blocking the import path from
`pages/` and `components/` as a second layer. There's a test that proves the throw.

The full set of ten laws is in any spec file under [`prompts/`](prompts/); judgment calls
made along the way are logged one line each in [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Proving tenant isolation

Claiming RLS works is easy. [`lib/isolation.test.ts`](lib/isolation.test.ts) proves it
against the real project: it creates two companies, two auth users with genuine JWTs
carrying their own `company_id`, seeds a full client → property → project chain plus a
catalog item **for both**, then asserts each user sees only their own rows and that
cross-tenant writes are silently blocked.

Seeding both sides is the part that matters. With rows on only one side, every "user A
cannot read company B" assertion passes against an empty table and proves nothing — it
tests that the table is empty, not that RLS filters. Teardown deletes in foreign-key order
so `on delete restrict` constraints can't silently leak fixtures between runs.

```bash
npm run test:isolation   # 20/20 against the live project
```

## Stack

Next.js 15 (Pages Router) · TypeScript in strict mode with `noUncheckedIndexedAccess` ·
Tailwind v4 · Supabase (Postgres, Auth, Storage, RLS) · Vitest · Stripe and server-side PDF
generation to come. Deployed on Vercel. PWA and offline-capable by design — the primary
device is a phone in a work glove.

## Getting started

Requires Node 20.11+ and a Supabase project.

```bash
npm install
cp .env.example .env.local   # every variable is named and commented
npm run dev                  # http://localhost:3000
```

Apply migrations with the Supabase CLI:

```bash
npx supabase link --project-ref <your-project-ref> && npx supabase db push
```

The one environment rule that matters: `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS, so it is
server-only and never prefixed with `NEXT_PUBLIC_`. Import `lib/supabase-browser.ts` from
components and pages.

Checks that must pass before any commit is considered done:

```bash
npm run build && npm run test && npm run lint && npm run typecheck
```

## Layout

```
pages/          routes (Pages Router); pages/api/ for REST-ish endpoints
components/     React components
lib/            money.ts (integer cents), Supabase client factories, isolation tests
types/          generated Supabase types + the Tables/Insert/Update wrapper
supabase/       timestamped SQL migrations, never edited after being applied
prompts/        the build specifications, C01 → C21, and milestone gates
docs/           DECISIONS.md — one line per judgment call
```

## How it's built

Spec-first. Each commit implements one complete, self-contained specification from
[`prompts/`](prompts/), with its acceptance criteria and commit message fixed in advance.
[`BUILDLOG.md`](BUILDLOG.md) records what was built, what was actually verified, and what
still needs a human — including the things that were claimed done and weren't.

## A note on the name

"PaperTrail" is a placeholder. It appears only in company-facing copy and branding
constants, so renaming is a small change — but the term is common, so a USPTO search and
domain check should come before it's printed on anything.

## License

MIT — see [LICENSE](LICENSE).
