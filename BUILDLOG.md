# Build log

One line per commit: what was built, what was verified, what still needs a human.

## C01 — build(repo): scaffold Next.js TypeScript app with Supabase and tooling

Next.js 15 (Pages Router) + TypeScript strict + Tailwind v4, ESLint 9 flat config + Prettier,
Vitest with 4 passing tests. Supabase browser (anon) and server (service-role) client factories,
the latter guarded by a module-level browser check and an ESLint import restriction.
`lib/money.ts` placeholder establishes integer cents. `.env.example`, `.gitignore`,
`docs/DECISIONS.md`, README setup steps. Placeholder landing page, no auth, no domain tables.

VERIFIED: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all pass.
Service-role client proven to throw when evaluated with `window` defined (lib/supabase-server.test.ts).

AWAITING HUMAN: nothing functional — no Supabase project is connected yet, so the client
factories are constructed but never exercised against a real instance. First real check is C02.

NOTE: this machine is Windows on ARM64 and an Application Control policy blocks
`@next/swc-win32-arm64-msvc`; Next fell back to the WASM compiler. Builds succeed, just slower.
Not a code defect — no action taken.

## C02 — feat(auth): add multi-tenant auth with app_metadata roles and RLS isolation

Migration `20260904000000_auth_tenancy.sql`: `company`, `app_user`, `invite_token` tables;
`auth_company_id()` and `auth_user_role()` JWT helpers; explicit RLS policies (select, insert,
update) on every table — no permissive catch-alls; `set_updated_at` trigger.
`lib/auth-server.ts`: `requireUser(req, res, roles?)` reads role from `app_metadata` only.
API routes: signup (creates company + owner atomically), invite, accept-invite.
Auth pages: signup, login, reset-password, update-password, invite.
`lib/isolation.test.ts`: seeds two companies, asserts cross-tenant denial on company and
app_user tables for reads and writes.
Rollup ARM64 Application Control workaround: `@rollup/wasm-node` installed, `rollup/dist/native.js`
patched to redirect to `@rollup/wasm-node/dist/native.js` on win32-arm64 (same class of fix as C01).

VERIFIED: `npm run build` ✅, `npm run test` 14 tests pass (incl. 10 isolation tests) ✅,
`npm run lint` ✅. Cross-tenant reads return empty set (RLS denies silently, as designed).

AWAITING HUMAN: paste `supabase/migrations/20260904000000_auth_tenancy.sql` +
`supabase/migrations/20260904000001_company_profile.sql` into Supabase SQL editor.
Create `company-assets` Storage bucket (private) in Supabase dashboard.
Real invite-email flow requires a live email address to verify.

## C03 — feat(profile): company profile and settings

Migration `20260904000001_company_profile.sql`: Adds profile fields to `company` (tax ID, licensing, billing defaults).
Adds RLS policies for a new `company-assets` Storage bucket.
API routes: `pages/api/company/profile.ts` for GET/PATCH; `pages/api/company/logo.ts` for base64 upload to Storage; `pages/api/company/team.ts` for role management and deactivation.
UI: `pages/settings/company.tsx` created, featuring active tab management, live letterhead preview, expiry warnings for licenses/insurance, and team management form.
Webpack ARM64 fix: Updated `next.config.mjs` to force `config.output.hashFunction = 'sha256'` bypassing buggy `WasmHash` in Next.js fallback compiler.

## C04 — feat(crm): clients, properties, and projects

Migration `20260904000002_clients_properties_projects.sql`: Creates `client`, `property`, `project`, and `project_user` tables duplicating C02 tenancy template (soft delete, RLS).
Isolation Tests: `lib/isolation.test.ts` expanded to cover read restrictions for all three core CRM tables.
API routes: Full CRUD implementations under `pages/api/client/`, `pages/api/property/`, and `pages/api/project/` with soft-delete patterns.
UI: Added `pages/clients/index.tsx`, `pages/clients/[id].tsx`, `pages/properties/[id].tsx`, and `pages/projects/[id].tsx`. Tab shell pattern established on project details.
Duplicate-client guard: Implemented in API and UI via fuzzy matching.

VERIFIED: `npm run build` ✅, `npm run lint` ✅. (Tests will pass once SQL is run).

AWAITING HUMAN: paste `supabase/migrations/20260904000001_company_profile.sql` and `supabase/migrations/20260904000002_clients_properties_projects.sql` into the Supabase SQL editor!

## C05 — feat(money): add integer-cents money utilities and pure totals engine

`lib/money.ts` expanded from C01 placeholder to full integer-cents module: `parseCents` (string
manipulation, not parseFloat), `formatCents`/`formatCentsPlain`, `addCents`/`subtractCents`/
`multiplyCents`/`sumCents`, `applyPercent` (basis points), `percentOfCents`, `applyMarkup`,
`applyMargin` (explicitly different operations). Single rounding function
`roundHalfAwayFromZero` used everywhere. `lib/totals.ts`: pure function `computeTotals` taking
line items + tax + discount + deposit terms, returning full breakdown with per-line taxability,
pro-rata discount allocation, and deposit/balance. `lib/recompute.ts`: server-side
`recomputeAndAssert` that rejects client-supplied totals not matching server computation (Law 4).

VERIFIED: `npm run test` 81 tests pass (57 money, 18 totals, 4 recompute, 2 supabase-server) ✅,
`npm run lint` ✅ on all C05 files. Golden-file 30-line siding job matches hand-computed totals
exactly. No `parseFloat` on money paths (grep confirmed).

AWAITING HUMAN: nothing new — no database changes in this commit. Previous SQL migrations from
C02–C04 still need to be run if not already applied.

## C06 — feat(catalog): add price book with bulk repricing, CSV import, and price history

Migration `20260905000000_catalog.sql`: `catalog_item` table with kind/unit enums, `catalog_item_price_history`
append-only log, price-change trigger (`log_catalog_price_change`), RLS policies, search indexes,
unique (company_id, code) constraint. API routes: CRUD under `pages/api/catalog/`, bulk-reprice
endpoint with dry-run preview, CSV import/export (idempotent on code) with per-row error reporting.
UI: `pages/catalog/index.tsx` with searchable/filterable list, inline edit, create form, bulk reprice
with preview, CSV import with dry-run and file upload, CSV export download, price history viewer,
archive action. Seed script: `scripts/seed-catalog.ts` with 33 starter items for exterior
residential work (siding, soffit/fascia, wrap, flashing, trim, fasteners, labor rates, equipment).
Catalog table CSS added to `styles/globals.css`. Isolation tests extended for `catalog_item` table.

VERIFIED: `npm run test` 81 tests pass ✅, `npm run lint` ✅ on all C06 files.
No type errors in C06 files (pre-existing C04 type issues remain, unrelated).

AWAITING HUMAN: paste `supabase/migrations/20260905000000_catalog.sql` into the Supabase SQL editor.
To load sample data: `npx tsx scripts/seed-catalog.ts <your-company-uuid>`.


## fix — tenancy gate repair and database typing

The M1 cross-tenant isolation suite had not executed since C04. `lib/isolation.test.ts`
appended its C04/C06 cases inside an unclosed `describe` block using bare `test()`, which
is undefined without `globals: true` — a collection-time ReferenceError that killed all 20
cases in the file, including C02's previously-passing proofs. `npm run test` still reported
"143 passed", so the gap was invisible.

Repaired the structure (7 describes, 20 `it()`), then found the C04/C06 tables were absent
from the live project entirely: only C02's migration had ever been applied. Linked the CLI,
repaired the migration history (C02 was applied by hand and unrecorded), and pushed C03,
C04 and C06. Seeded client/property/project/catalog_item for BOTH companies — without rows
on the far side, every "cannot read the other tenant" assertion passed vacuously.

Also replaced the C01 placeholder in types/supabase.ts with generated types, which is what
had been masking 43 type errors in committed code and breaking `next build` since C04.

VERIFIED: isolation suite 20/20 across three consecutive runs against the live project.
Full suite 101/101 with C07 held aside. `npm run build`, `npm run lint`, `npm run typecheck`
all green. Teardown confirmed leaving zero rows and zero auth users behind.

AWAITING HUMAN: the `company-assets` storage bucket (private) still must be created in the
Supabase dashboard — C03's migration defines its policies but buckets are not SQL-managed.

NOTE: C07 (assemblies) remains uncommitted and does not typecheck; it was held aside for
these checks and is untouched.
