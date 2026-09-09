# Build log

One entry per commit: what was built, what was verified, what still needs a human.

**Current status (2026-09-08):** M1 complete and the tenancy gate is proven — 20/20 cross-tenant
isolation tests passing against the live project across three consecutive runs. All migrations
through C06 are applied. `build`, `test`, `lint` and `typecheck` are green. C07 (assemblies) is
in progress. The only outstanding manual step is the `company-assets` storage bucket, noted at
the bottom of this file.

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

RESOLVED 2026-09-08 — applied via `supabase db push` after repairing the migration history (commit 6e4a070).
Was: paste `20260904000000_auth_tenancy.sql` + `20260904000001_company_profile.sql` into the SQL editor.
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

RESOLVED 2026-09-08 — applied via `supabase db push` after repairing the migration history (commit 6e4a070).
Was: paste `20260904000001_company_profile.sql` and `20260904000002_clients_properties_projects.sql` into the SQL editor.
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

RESOLVED 2026-09-08 — applied via `supabase db push` after repairing the migration history (commit 6e4a070).
Was: paste `20260905000000_catalog.sql` into the SQL editor.
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

## C07 — feat(estimating): add assemblies with waste, packaging, and auditable takeoff math

Assembly and assembly_component tables following the C02 tenancy template, with driver-unit
and rounding-rule enums. Pure takeoff engine in lib/takeoff.ts producing raw, waste-adjusted
and purchase quantities plus a derivation string per component. Feet-inches parser and net-area
maths in lib/dimensions.ts. Measurement UI (surfaces, openings, live driver total, feet-inches
or decimal input) and an assembly detail page whose takeoff preview recomputes as waste factors
and rounding rules are edited. Six sample assemblies covering demo, water barrier, backerboard,
J-channel, siding and trim, seeded by scripts/seed-assemblies.ts.

Two real defects were found and fixed rather than papered over. The derivation string rendered
"x 0.01" where the spec's worked example requires "/ 100" — the division branch was unreachable
because it was guarded by quantityPerDriver >= 1, and a "per 100 sq ft" rate is 0.01. And the
assemblies list page referenced eleven CSS classes that had never been written, so it had been
rendering unstyled.

VERIFIED: the spec acceptance case run end to end against the live project — a 40ft x 10ft wall
with two 3x5 windows (370 sq ft net) through the seeded siding assembly produces 5 squares,
50 lin ft of starter, 1 box of nails, 9 lead hours and 7 helper hours, totalling $1,387.45,
matching the hand-computed takeoff with a derivation on every line. Migration applied via
supabase db push; types regenerated. Seed script re-run after refactoring: 6 assemblies,
21 components, cleanup left zero rows. 187 tests across 8 files. build, lint and typecheck green.

AWAITING HUMAN: the assemblies and measurement UI has not been exercised in a browser against a
real session — the pages compile and the maths underneath them is tested end to end, but no one
has typed a dimension into the field on a real device. The `company-assets` storage bucket from
C03 also remains outstanding.

## C08 — feat(estimating): add versioned estimate builder with immutable issued versions

`estimate` and `estimate_line` following the C02 tenancy template, plus the machinery
that makes Law 3 real: a trigger on each table that freezes content, money terms and
totals the moment an estimate leaves draft, and refuses inserts, updates and deletes on
the lines of a frozen estimate. A draft can only leave draft through `issue_estimate()`,
which announces itself with a transaction-local setting — so a direct
`update ... set status='issued'`, even holding the service-role key, is rejected rather
than producing an issued estimate with unfrozen totals. Three locking, idempotent SQL
functions carry the state changes: `issue_estimate`, `create_estimate_revision`,
`save_estimate_draft`.

Pure engine in `lib/estimate.ts` — optional-line filtering, totals over the billable
subset via the C05 engine, internal profitability (cost, pre-tax margin, hours by phase),
group rollups for the summary rendering, and takeoff-to-lines conversion that carries the
C07 derivation string onto each line. The builder runs the same functions in the browser
that the server runs on save and at issue, so there is no second implementation of the
money to drift.

Builder UI at `/estimates/[id]`: add from the price book, from an assembly takeoff
(reusing C07's measurement input, inserting the components as a labelled group), or free
text; reorder by drag or by up/down buttons; group headings; optional lines that price on
screen but stay out of every total until selected; markup/margin toggle; per-line
taxability; discount and deposit terms defaulted from the company profile; an
itemized-vs-summary preview of what the client will see; and an internal profitability
panel. Issued estimates render the same page read-only with "create revision" in place of
the editing controls.

VERIFIED: 215 tests across 9 files (up from 187 across 8) — `npm run build`, `npm run test`,
`npm run lint`, `npm run typecheck` all green, and a clean build from a deleted `.next`.
The estimate engine's worked example is checked against hand-computed arithmetic end to
end: a five-line siding job with one unselected option totalling $1,967.09 on a $2,005.00
subtotal, 22.77% margin on $1,904.75 of pre-tax revenue, 16 hours of siding and 6 of demo.
The isolation suite is 27 cases across 7 tables (was 20 across 5), now covering `estimate`
and `estimate_line` in both directions plus cross-tenant update and delete attempts.
Teardown verified against the live project afterwards: zero rows in every domain table and
zero leftover fixture companies. The first two migrations were applied with
`supabase db push` and types regenerated in the same breath.

AWAITING HUMAN: **`20260908000002_estimate_retire_before_purge.sql` has not been applied.**
`supabase db push` was declined by the sandbox partway through the session, so the third
migration exists as a file only, and the live project still carries the absolute
hard-delete block from the first migration. It must be pushed before the next commit.

Because of that, the acceptance case "issue → attempt edit → blocked at the DB level, and
the revision flow produces v2 with correct supersede states" is **NOT verified against the
live project** — an issued fixture cannot be cleaned up until the purge path exists, so
writing that test now would have leaked rows into the project on every run. The immutability
triggers and the revision flow are implemented and typecheck, but no one has watched the
database refuse an edit. That test is the first thing C09 should do after the push.

Also unverified: the builder has not been exercised in a browser against a real session.
The pages compile and the money underneath them is tested, but nobody has dragged a line or
issued an estimate on a real device. The `company-assets` storage bucket from C03 remains
outstanding.
