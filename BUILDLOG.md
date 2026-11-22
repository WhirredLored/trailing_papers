# Build log

One entry per commit: what was built, what was verified, what still needs a human.

**Current status (2026-09-17):** M1 complete and the tenancy gate is proven — 20/20 cross-tenant
isolation tests passing against the live project across three consecutive runs. C08 (estimate
builder) is committed and driven in a browser. C09 (documents) is committed. Nine migrations are
applied; `20260917000001_documents.sql` is written and proven against a local Postgres but NOT
yet applied to the hosted project. There is no longer a manual dashboard step — buckets are declared in SQL; see the
storage-buckets entry at the bottom of this file.

CORRECTION: the version of this header committed in `chore(storage)` claimed TWO migrations were
unapplied and named `20260908000002_estimate_retire_before_purge.sql` as one of them. That was
wrong — it was applied on 2026-09-08 and both the RESOLVED note and the C08 follow-up entry below
say so. Only `20260917000000_storage_buckets.sql` was ever pending. The mistake matters because
re-pushing an applied migration is exactly the situation the `migration repair` note in CLAUDE.md
exists for, so a future session acting on that header would have created the problem it warns of.

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

RESOLVED 2026-09-08 — migration applied with `supabase db push`, types regenerated (no diff:
the migration only replaces two function bodies), and the acceptance case is now proven by
`lib/estimate-db.test.ts`. See the follow-up entry below.

Also unverified: the builder has not been exercised in a browser against a real session.
The pages compile and the money underneath them is tested, but nobody has dragged a line or
issued an estimate on a real device. The `company-assets` storage bucket from C03 remains
outstanding.

## C08 follow-up — the acceptance case, proven

`20260908000002_estimate_retire_before_purge.sql` applied; all eight migrations now report
local and remote in sync. `lib/estimate-db.test.ts` is the C08 acceptance case, run against
the live project through the SERVICE-ROLE client — which bypasses RLS entirely, so what
refuses these writes is the trigger and nothing else. `npm run test:estimates` runs it alone.

VERIFIED, 20 cases, all observed passing:
  - Issuing froze the expected totals onto the row ($1,335.00 subtotal, $65.63 tax on the one
    taxable line, $1,400.63 total, $1,005.00 cost, $330.00 margin).
  - An issued estimate refuses: a change to its notes, a change to its total, adding a line,
    editing a line, deleting a line, deleting the estimate, a status flip back to draft, and
    a save through `save_estimate_draft`. It still allows issued → approved.
  - A draft refuses a hand-written `status = 'issued'` that bypasses `issue_estimate()`, and
    stays editable afterwards.
  - The revision flow: v1 clones to a v2 draft with its lines copied; v1 stays `approved`
    with a null supersede pointer while v2 is still a draft; asking for a revision twice
    returns the same v2 (idempotent); revising a draft is refused; revising with the wrong
    company id is refused; v2 is editable and re-prices; issuing v2 flips v1 to `superseded`
    with `superseded_by_estimate_id` set, and v1 keeps its own frozen totals; issuing v2 a
    second time changes nothing (idempotent).
  - Retire before purge: deleting an issued estimate is refused, setting `deleted_at` then
    deleting succeeds, and the lines go with it.

Teardown verified: zero rows in every domain table and zero auth users afterwards, across two
consecutive full-suite runs.

Hook timeouts cost two rounds of leaked fixtures and are worth recording. The new suite's first
run timed out in `beforeAll` at vitest's 10s default — an auth user plus six domain rows and an
issue round-trip does not fit — and left a company, a draft estimate, two lines, two projects, a
property, a client and an auth user behind in the live project. Then the C08 rows I added to
`isolation.test.ts`'s seed pushed THAT suite over the same 10s ceiling, in both `beforeAll` and
`afterAll`, leaking two more companies: a regression I introduced with the tenancy cases and did
not catch, because the suite had passed comfortably before the two extra inserts per tenant. Both
leaks were purged by hand and verified gone. The fix is `hookTimeout: 60_000` in
`vitest.config.ts` rather than per-file arguments, so every future live-project suite inherits it.
The lesson is the one worth keeping: a hook that times out mid-seed does not clean up after
itself, so the ceiling has to be generous enough that it never trips.

Full suite 235 tests across 10 files (was 215 across 9). build, lint and typecheck green.

NOTE — `npm run build` is intermittently failing on this machine, and my earlier claim in this
session that it "no longer reproduces" was wrong. It failed three times, passed after
`rm -rf .next`, then failed three more times later, and has since passed eleven consecutive
runs including after regenerating types, touching files and adding and removing files. The
stack is inside webpack's own filesystem snapshot code — `FileSystemInfo` hashing a directory
entry whose `hash` is undefined — not in application code, and the same tree builds clean
repeatedly. Clearing `.next` resolves it every time. I could not find a deterministic trigger,
so nothing was changed to work around it; if it recurs, `rm -rf .next` is the fix.

AWAITING HUMAN: the builder still has not been exercised in a browser against a real session —
nobody has dragged a line, run a takeoff into an estimate, or issued one on a real device. The
`company-assets` storage bucket from C03 also remains outstanding.

RESOLVED 2026-09-12 — both done. See the browser-verification entry below; the bucket now exists
(private, 5 MB, image MIME types matching pages/api/company/logo.ts) and a logo upload, signed
URL and delete were round-tripped through it.

## C08 follow-up — driven in a browser, and one real defect found

The estimate builder has now been used against a real session, and it found a pricing bug that
every other layer of verification had missed.

WHAT WAS EXERCISED, all against the live project with a seeded demo tenant: sign-in and the
session handshake; the project page's estimate tab and list; creating a draft; an assembly
takeoff driven from the C07 measurement input (20 lin ft of J-channel, surfaces resolving to a
driver quantity, three components inserted as a labelled group with their derivations intact);
a price-book search and insert; a free-text optional line; live totals; the internal
profitability panel; the itemized preview; issuing; the read-only frozen rendering; and the
revision flow through to an editable v2 with its lines cloned. The ~300 lines of CSS written
for this commit render correctly — which is the check C07 failed, and the reason this pass was
worth doing.

THE DEFECT. Takeoff-inserted lines ignored each catalog item's `default_markup_bp` and priced
off the estimate's own rate alone. That rate defaults to zero, so inserting a takeoff into a
new estimate quoted every material AT COST, and the profitability panel dutifully reported 0%
margin. The same item added from the price book carried its markup, so one catalog item had two
different prices depending on how it reached the estimate:

    TRIM-JCHAN   cost $0.89   own markup 30%   price book $1.16   takeoff $0.89
    FST-NAIL15   cost $45.00  own markup 20%   price book $54.00  takeoff $45.00

Nothing caught this. The unit tests passed a markup in explicitly, so they never exercised the
default; the database tests assert on totals computed from whatever prices they were handed; the
build and typecheck have no opinion about pricing policy. It took inserting a takeoff and reading
a 0% margin off the screen.

THE FIX: `pricingBpFor()` in lib/estimate.ts is now the single place that decides which rate
prices a catalog-sourced line — the item's own markup beats the estimate's blanket rate in markup
mode, and margin mode always uses the estimate rate, since there is no per-item equivalent. Both
the price-book picker and `linesFromTakeoff` call it, so the two paths cannot diverge again. Five
regression tests cover it, including the zero-rate case that produced the at-cost quote.

VERIFIED: the fix confirmed in the browser — a freshly inserted J-channel takeoff now prices at
$1.16 and $54.00 where it previously read $0.89 and $45.00, while the already-cloned lines keep
their frozen prices. 240 tests across 10 files. build, lint and typecheck green.

The `company-assets` bucket was also created (private, 5 MB limit, the four image MIME types the
logo route accepts), closing a C03 hand-off that had been open since that commit and that would
have blocked C09, which stores generated PDFs to Storage and puts the company logo on the
letterhead. A logo upload, signed URL and delete were round-tripped through it. Note for C09:
buckets are not SQL-managed, so a `documents` bucket will need the same treatment.

AWAITING HUMAN: nothing outstanding from C08.

## chore — storage buckets declared in SQL, ahead of C09

C09 stores generated PDFs to Storage, so it needs a `documents` bucket. C08 left a note that
this would need the same by-hand dashboard creation `company-assets` got. Doing it at the start
meant first checking whether by-hand was actually required. It is not, and it never was.

THE CORRECTION. C03 recorded that a Storage bucket "cannot be created via SQL migration" and
made it a dashboard step. `storage.buckets` is an ordinary base table. Creating a bucket is an
INSERT into it. Three facts, each checked against a live Supabase project on this org rather
than recalled:

    storage.buckets relkind                                    'r' (base table, not a view)
    has_table_privilege('postgres','storage.buckets','INSERT')  true
    pg_roles.rolbypassrls where rolname='postgres'              true  (table RLS is no obstacle)

`db push` connects as `postgres`, so a migration can do this. One wrong sentence in C03 became
an AWAITING HUMAN line that C03, C04, C06, C07 and C08 each carried forward, and that C09 was
about to inherit. That is the actual cost worth recording — not the bucket.

WHAT WAS WRITTEN. `supabase/migrations/20260917000000_storage_buckets.sql` declares both
buckets as one idempotent `insert ... on conflict (id) do nothing`:

    documents        private, 25 MB, application/pdf only
    company-assets   private,  5 MB, the four image types pages/api/company/logo.ts accepts

`company-assets` is backfilled because it existed only as a hand-made row in one project's
dashboard, so a fresh ref could not come up from migrations alone. `do nothing` means the live
bucket is never reconfigured underneath whoever created it.

Storage policies on `storage.objects` are deliberately NOT here — C03 owns the `company-assets`
policies (applied) and C09 owns the `documents` ones. So `documents` arrives private and
reachable only by the service-role key until C09 adds them, which is the safe direction for a
bucket to be incomplete in.

VERIFIED: the INSERT parses and plans against a real Supabase `storage.buckets` — column names,
types and the `on conflict (id)` arbiter all resolve — checked with `PREPARE`, which parses and
plans without executing. The target project's bucket list was re-read afterwards and was
unchanged, so nothing was written anywhere. `build`, `lint` and `typecheck` green.

`test` is NOT fully green in this container, and the file count is the tell CLAUDE.md asks for:
**2 failed | 8 passed (10 files), 193 tests passed** — against the 240 tests across 10 files C08
recorded. `lib/isolation.test.ts` and `lib/estimate-db.test.ts` both wrap their entire body in an
`if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) { warn } else { describe(...) }` guard, so with
no credentials present the file defines no suite at all and vitest reports "No test suite found
in file" as a FAILURE. Confirmed pre-existing and unrelated to this commit: `git stash -u` and a
re-run give the identical 2 failed | 8 passed (10) / 193 passed. It is the absent credentials,
not the change. The M1 tenancy gate is therefore UNVERIFIED in this session — it was last proven
green at C08, and nothing here touches tenancy, but that is inference rather than an observation.
Worth noting that the guard fails loudly instead of silently reporting a smaller green run, which
is the better of the two behaviours given this gate went quietly dead for four days once.

NOT VERIFIED, and the reason: the migration has not been run, and the `documents` bucket does
not exist yet. **No PaperTrail Supabase project is reachable from this session.** There are no
Supabase environment variables and no `.env`; the CLI is not linked (`db push` fails with
`LegacyProjectNotLinkedError`, despite CLAUDE.md saying the link is in place — that claim holds
for someone's local checkout, not for a fresh container); and of the four projects the account
can see, none is PaperTrail — one is an unrelated auction/marketplace schema, two are paused
under unrelated names, and the fourth is ACTIVE_HEALTHY but times out on every connection
attempt, so it could not even be inspected. So this commit could not create the bucket, only
make creating it a migration instead of a dashboard errand.

Note that `supabase/migrations/20260904000001_company_profile.sql` still carries the incorrect
"buckets are not SQL-managed" comment in its header. It is an applied migration and is not
edited; the correction lives in the new migration's header and in CLAUDE.md.

AWAITING HUMAN: run `npx supabase db push` (with the CLI linked, or apply the one statement in
the SQL editor and `migration repair --status applied 20260917000000`), then confirm both
buckets exist and `documents` is private. No type regeneration is needed — `gen types` covers
the `public` schema and this migration adds nothing there. C09 is otherwise unblocked: its own
migration adds the `document` table and the `documents` storage policies.

RESOLVED 2026-09-17 — `db push` run by the repo owner; the migration is applied and the
`documents` bucket exists. NOT observed by the session that wrote this: it still has no
credentials and no reachable project, so this records what the owner reported, not something
verified here. The two things that would confirm it, for whoever next has access: `documents`
and `company-assets` both present in `storage.buckets`, both with `public = false`. No type
regeneration was needed and none was expected.

## C09 — feat(documents): add deterministic PDF generation with hashing and atomic numbering

The `document` table, server-side PDF rendering on company letterhead, sha256 hashing, atomic
per-company-per-kind numbering, and session-authorized downloads.

WHAT MADE THIS COMMIT DIFFERENT: a local Postgres 16 was stood up and the whole migration chain
applied to it, so for the first time in this project the SQL was EXECUTED before being committed
rather than reasoned about. That is also how both defects below were found. The hosted project is
still unreachable from this session — the local cluster is a stand-in for the SQL, not for the
project.

### Determinism, which is the whole point

Regenerating an issued version must produce byte-identical output, because the sha256 is the
evidence. Four sources of drift were pinned:

    pdf-lib metadata     CreationDate/ModDate/Producer/Creator set from the frozen issued_at
    money formatting     formatCentsStable() in lib/money.ts — hand-grouped, no Intl/ICU
    date formatting      UTC against a fixed month table, never toLocaleDateString
    fonts                standard-14 by name, so no font binary or version in the output

VERIFIED: two renders of the same model hash identically, including across a one-second sleep and
across a process timezone change (Asia/Tokyo vs America/Anchorage). Determinism is not achieved by
ignoring the input — changing a total or the document number changes the hash, both asserted.
Independently confirmed with poppler's `pdfinfo`, which is not pdf-lib and has no stake in the
answer: `Producer: PaperTrail`, `CreationDate` and `ModDate` both `Thu Sep 17 14:30:00 2026 UTC`.

### Two defects found, both by testing rather than by reading

**`lpad` truncates.** `lpad(n::text, 4, '0')` renders document 10000 as `EST-1000` — the same
client-facing number as document 1000, from a number that is unique in the database. Postgres
lpad treats the width as exact, not as a minimum. Now `greatest(4, length(n::text))`. A contractor
reads these numbers aloud to clients; two documents answering to `EST-1000` is a dispute, which is
the exact thing this product exists to prevent. Caught by testing the 10000 boundary, not the
happy path.

**`getModificationDate()` lies.** The test asserting the frozen ModDate failed while the
determinism tests passed — a contradiction, since a varying ModDate would break byte-equality.
Reading the raw bytes settled it: `ModDate = D:20260917143000Z` is correctly in the file, and
pdf-lib RECOMPUTES ModDate when a document is loaded. The renderer was right and the test was
wrong. The assertion now reads the bytes, which is what gets hashed anyway. Worth recording
because the instinct was to "fix" correct production code to satisfy a bad test.

### Numbering

`document_counter` plus `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`, one row per company per
kind. The upsert takes a row lock, so concurrent callers serialize rather than both computing the
same next number from a stale read. A rolled-back caller leaves a gap, never a duplicate: a
missing EST-0007 is a question, a second EST-0006 is a dispute.

VERIFIED against the local Postgres with two genuinely concurrent sessions: session 1 opened a
transaction, allocated, and held the lock for two seconds; session 2 started at 06:33:00, BLOCKED,
and completed at 06:33:01 — after session 1 committed — with number 2. Distinct and sequential,
observed rather than argued. Sequential allocation, per-kind independence and per-company
independence were each confirmed the same way, as were: a duplicate version refused, a duplicate
number refused, a malformed sha256 refused, and update and delete on a document row both refused
by the freeze trigger with the intended messages.

### The rest

Letterhead with logo, legal name/DBA, address, licence and insurance; client and property blocks;
itemized or summary lines; totals with deposit; terms, notes and a signature block. Print-safe US
Letter, and grayscale-legible in the strict sense that no information is carried by colour — an
optional line says "optional" rather than being blue.

`sanitizeForPdf()` exists because pdf-lib THROWS on characters the standard-14 fonts cannot
encode, and en-dashes and curly quotes arrive whenever a description is pasted out of a supplier's
web page. Without it a real-world paste is a 500 on issuing.

Issuing now takes the snapshot automatically. A generation failure does NOT fail the issue: the
estimate is already frozen and committed by then, and reporting failure would tell the contractor
their estimate did not go out when it did.

The download route re-hashes the stored bytes and refuses to serve a mismatch. That is what the
stored hash is for — serving an altered file as the issued one is precisely the failure the
evidence chain exists to prevent.

VERIFIED: 219 tests across 9 files passing (193 before). 26 new, covering determinism, wrapping,
sanitisation, pagination and the stable money formatter. `build`, `lint` and `typecheck` green.
The acceptance case was rendered and READ, not merely asserted on: a 30-line estimate with a long
rural address produces three US Letter pages with the long descriptions wrapping inside their
column, the money columns aligned, the column header repeated after the page break, and the footer
numbering pages 1-3.

NOT VERIFIED, and precisely why:

  - **The migration is not applied to the hosted project.** It applies cleanly to a local
    Postgres 16 with all ten migrations in order; the project runs Postgres 17 and is unreachable
    from this session. Nothing here is version-specific, but that is inference.
  - **Nothing has touched Supabase Storage.** Upload, download and the `documents` bucket's RLS
    policy are unexercised — there is no Storage in a bare Postgres. The policy is a copy of
    C03's proven `company-assets` shape against the same `storage.foldername(name))[1]` idiom.
  - **`lib/document-db.test.ts` has never run.** It is the supabase-js-mediated version of the
    numbering, immutability and tenancy checks, and needs credentials. The behaviours it asserts
    were each proven directly in SQL as described above; what is unproven is that they survive
    the PostgREST round trip. `npm run test:documents` runs it.
  - **No browser has seen any of this.** No route has served a request.
  - `npm run test` now reports **3 failed | 9 passed (12 files)** — the third being this new
    live-database suite, failing to collect for the same missing-credentials reason as the other
    two. Check the FILE count, per CLAUDE.md.

`types/supabase.ts` was regenerated by a real `supabase gen types` run against the local cluster
rather than hand-edited. That cluster cannot know the project's `graphql_public` schema or its
PostgrestVersion, so only the generated `public` block was taken and every other region was
asserted byte-identical to the committed file before writing. Re-run `gen types --linked` after
applying the migration to confirm against the real project.

AWAITING HUMAN: apply `20260917000001_documents.sql` with `npx supabase db push`, regenerate types
in the same breath, then run `npm run test:documents` and `npm run test:isolation`. After that,
issue an estimate in a browser and open the PDF — C08's lesson was that a browser pass found a
pricing defect that every other layer had missed, and nothing here has been near a real request.
## chore — package-lock.json resynced so a cold container can install

A fresh session could not install at all. `npm ci` refused outright with `EUSAGE`:

    npm ci can only install packages when your package.json and package-lock.json
    are in sync. Please update your lock file with npm install before continuing.
      Missing: @emnapi/runtime@1.11.3 from lock file
      Missing: @emnapi/core@1.11.3 from lock file
      Invalid: lock file's @emnapi/wasi-threads@1.2.1 does not satisfy @emnapi/wasi-threads@1.2.3

That is a hard failure, not a warning — it exits before writing `node_modules`, so with no
dependencies on disk every one of the four gates fails with `next: not found` and the repo
looks broken for a reason that has nothing to do with its code. Worth recording because it
costs a cold session its first ten minutes before any real work starts.

WHAT CHANGED. `npm install` to let npm resolve and rewrite the tree, nothing more. The diff is
48 insertions and 15 deletions confined to the `@emnapi/*` wasm shims
(`core`, `runtime`, `wasi-threads`) that hang off `@unrs/resolver-binding-wasm32-wasi`, a
transitive of ESLint's resolver. **No first-party dependency moved** — `package.json` is
untouched, and no direct dependency changed version. These are optional wasm fallbacks that
never load on this platform, which is why the drift went unnoticed: the previous session ran on
a tree that was already installed.

VERIFIED, in this order and all observed rather than assumed:
- `npm ci` now exits 0 from a deleted `node_modules` — this is the actual claim of the commit,
  so it was run rather than inferred from `npm install` having succeeded.
- All four gates re-run against that fresh `npm ci` tree, not the `npm install` one:
  `build` 0, `lint` 0, `typecheck` 0.
- `test` is at the same **2 failed | 8 passed (10 files), 193 tests passed** the previous commit
  recorded. Unchanged by this commit, and the file count is the check CLAUDE.md asks for.

STILL NOT VERIFIED, carried forward unchanged from the previous commit. `lib/isolation.test.ts`
and `lib/estimate-db.test.ts` define no suite without Supabase credentials, so vitest reports
each as a failed file. **The M1 tenancy gate is therefore UNVERIFIED in this session** — last
proven green at C08. Nothing here touches tenancy, but that is inference, not an observation.

No PaperTrail Supabase project is reachable from this session either, so
`20260917000000_storage_buckets.sql` remains unapplied and the `documents` bucket still does not
exist. Of the four projects the account can see: two are INACTIVE (paused); `Sat_Early_Endeavor`
is ACTIVE_HEALTHY but is the unrelated auction/marketplace schema; `color-pebble-hovel` is
ACTIVE_HEALTHY but times out on every connection, so it could not be inspected and cannot be
ruled out. A further probe of it was not possible — the Supabase MCP session dropped and asked
for a re-authentication that cannot be performed from here.

AWAITING HUMAN, unchanged and now blocking the next commit:
- Point the session at a PaperTrail project (or authorise creating one and running all nine
  migrations), then `npx supabase db push` and confirm both buckets exist and `documents` is
  private. C09 writes PDFs into `documents`, so this stops being a loose end at the next commit.
- `prompts/README.md` still lists C08 as `next` and C09 as `planned`; C08 shipped in b9d5a13.
  Left alone deliberately — `prompts/` is verbatim source material under CLAUDE.md, so the
  status table is not something this chore should edit on its own initiative.

**Superseded in part.** Everything above was observed against the pre-C09 tree, before PR #3
was merged and before Supabase was reachable. The "no project is reachable", "buckets
unapplied" and AWAITING HUMAN lines were true when written and are not any more — see the next
entry, which corrects each of them. The verification numbers above still stand as a record of
that tree.

## C09 adopted from PR #3, and the database reconciled to it

Supabase became reachable for the first time, and what it revealed is the entry worth reading:
**C09 existed twice, in two incompatible versions, and neither was on `main`.**

WHY NO EARLIER SESSION FOUND THE PROJECT. It was never missing. `Trailing_papers`
(ref `ocghrrsotgprgrbvgyel`) sits in a **different Supabase organisation** from the four
projects earlier sessions enumerated, so every one of them concluded from a complete and
correct listing that no PaperTrail project existed. A second obstacle sat behind it: this
container's egress proxy refused `ocghrrsotgprgrbvgyel.supabase.co` and `api.supabase.com` with
`403 connect_rejected`, because the cloud environment's allowlist was empty. A `trailing-papers`
environment now allows the four Supabase hosts; both were confirmed answering afterwards.

Two notes in this file were already stale and are withdrawn: `20260917000000_storage_buckets.sql`
**was** applied (on 2026-10-02 — `documents` was created then), and both buckets exist with the
declared settings. The AWAITING HUMAN line six commits carried was closed by someone, unrecorded.

THE DIVERGENCE. PR #3 held a complete C09 (2920 lines, three commits, open since 2026-09-17,
never merged) whose migration `20260917000001_documents.sql` had **never been applied** — it was
proven against a local Postgres 16. Meanwhile the live database carried a migration recorded as
`20260918000000_documents`, applied 2026-10-02, **whose source exists in no commit, no branch and
no PR** — only as statements inside `supabase_migrations.schema_migrations`. The two were not a
renumbering of each other:

    PR #3                                  live database
    document_counter                       document_number_counter
    number, related_id, number_text        document_number, related_entity_id
    document_freeze() trigger              (none)
    lpad(n, greatest(4, length(n)), '0')   lpad(n, 4, '0')
    record_document(), document_number_text()   (neither)

The live version therefore carried the exact defect PR #3 documents finding and fixing — `lpad`
truncates, so document 10000 prints as `EST-1000`, colliding with document 1000 — and had **no
immutability trigger at all**, which is Law 3 unenforced on the table whose whole purpose is to
be evidence. PR #3's TypeScript could not run against it either way. Adopting PR #3 was the
instruction; this entry records what that cost.

RECONCILIATION, in order, each step verified before the next:
1. Dropped the orphan objects: the storage policy, `estimate_pdf_document_id_fkey` and its index,
   `document` (2 rows), `document_number_counter`, `allocate_document_number`, `document_kind`.
2. Purged leaked fixtures — two tenants both named *Document Generation Test Co LLC*, left by the
   2026-10-02 run, teardown in FK order (retire the issued estimates with `deleted_at` first,
   since C08's trigger refuses to purge a non-draft; then lines, estimates, projects, properties,
   clients, app_users, `auth.users`, companies). This mattered beyond tidiness: both tenants' only
   estimates held the sole non-null `pdf_document_id` values, and PR #3's foreign key could not be
   added while they dangled. `dangling_ptrs` read 0 afterwards.
3. Applied PR #3's migration. The SQL sent was **verified byte-identical to the committed file by
   sha256** (`178dd9e9…7da4`) before any DDL ran, rather than retyped and hoped over.
4. Repaired the history: deleted the `20260918000000` row and inserted `20260917000001`,
   `documents`. The ten rows now match the ten files in `supabase/migrations/` exactly.

VERIFIED afterwards: `document_number_text('estimate', 10000)` returns **`EST-10000`**, not the
colliding `EST-1000`, and 1 → `EST-0001`, 7 → `INV-0007`, 42 → `SIG-0042`, so four is a floor and
not a ceiling; the `document_freeze` trigger is present; both tables, all four functions, the
`estimate_pdf_document_fkey` constraint and the storage policy exist; the orphan table is gone.
`build` 0, `lint` 0, `typecheck` 0, and `test` at **3 failed | 9 passed (12 files), 219 passed** —
the same numbers PR #3 recorded, so merging and reconciling moved nothing.

A MISTAKE, recorded because it wrote to the live database. While probing, `allocate_document_number()`
was called inside what was described as a read-only query. It is not read-only: it upserts. The
counter was empty, so the call inserted a row and burned `EST-0001` for *Ridgeline Exteriors LLC*,
the browsable demo tenant, with no document to show for it. It was reverted with a guarded delete
(conditional on that company having no documents) and the counter confirmed back at 0 rows. No
document row or PDF was touched. The lesson is narrow and worth keeping: in this schema the only
safe function to call while looking around is `document_number_text()`, which is `immutable`.

NOT VERIFIED, and precisely why:
- **The M1 tenancy gate is still unproven, and has been since C08.** `test:isolation`,
  `test:estimates` and `test:documents` guard their entire body on the service-role key, which
  no session has ever had, so each defines no suite and vitest reports it as a failed *file* —
  the file count, not the test count, is the tell. 219 tests passing is 9 files, not 12.
- **Nothing has exercised Storage.** C09's upload and download paths remain untouched.
- **No browser has served a C09 route.** C08's lesson was that a browser pass caught a pricing
  defect every other layer missed; nothing here replaces that.
- `types/supabase.ts` still reports `PostgrestVersion: "14.5"` from PR #3's local cluster where
  the live project reports `14.17`. Left alone deliberately: the file is generated and CLAUDE.md
  forbids hand-editing it, and a real `gen types --linked` cannot run from this container.
- Two orphaned PDFs remain in the `documents` bucket under the purged tenants' folders.
  `storage.objects` refuses direct SQL deletes (`storage.protect_delete()`), which also aborted
  and rolled back the first teardown attempt — caught, re-run without that step, nothing lost.

AWAITING HUMAN:
- Add `SUPABASE_SERVICE_ROLE_KEY` as an environment variable on the cloud environment. It is the
  one thing standing between this repo and a proven tenancy gate; it cannot be a network secret,
  because the suites read `process.env` rather than making a request.
- Remove the two orphaned PDFs via the Storage API or the dashboard.
- `prompts/README.md` still lists C08 as `next` and C09 as `planned`; both have shipped.

## C09 follow-up — the M1 gate is green, and `document` gets a purge path

THE GATE. With `SUPABASE_SERVICE_ROLE_KEY` finally present, the three credential-guarded suites
collected and passed for the first time. Run in a worker session on the same cloud environment,
against the live project, file counts quoted as CLAUDE.md asks:

    npm run test:isolation     Test Files  1 passed (1)      Tests  27 passed
    npm run test:estimates     Test Files  1 passed (1)      Tests  20 passed
    npm run test:documents     Test Files  1 passed (1)      Tests  12 passed
    npm run test               Test Files 12 passed (12)     Tests 278 passed

**The M1 tenancy gate is green for the first time since C08**, and `test:documents` has now run
somewhere at all, which it never had. The arithmetic is worth recording because it is what rules
out the failure mode CLAUDE.md warns about: the previous full run was 219 tests over 9 of 12
files; 219 + 27 + 20 + 12 = 278 and 9 + 3 = 12. Every file collects. No suite is silently absent.

The key was validated before anything ran — `ref = ocghrrsotgprgrbvgyel`, `role = service_role`
decoded from the JWT, plus a live authenticated request returning 200. A first attempt was
aborted because the key configured then belonged to a different project; nothing was written by
it, and the database was re-read afterwards to confirm that.

THE DEFECT THE GATE EXPOSED. The runs leaked fixtures into the live project: +4 companies,
+2 estimates, +2 documents, +12 counters (doubled because the documents suite runs both
standalone and inside the full run). `auth.users` was unaffected, so user teardown works.

This is structural, not a sloppy teardown, and C09 predicted it: a document row cannot be
deleted, and `document.company_id` is `on delete restrict`, so the company that owns a document
can never be torn down. C09's own DECISIONS line says the cost "lands on test teardown, which
cannot remove its own fixtures and says so rather than failing silently" — and it did say so,
in stderr, rather than passing quietly. Left alone, every future run would strand more.

THE FIX — `20261122000000_document_purge_path.sql`. C08 solved the same problem for estimates
twice, and this copies the second pattern rather than the first. Retire-before-purge needs a
`deleted_at` column, and C09 forbids one explicitly: `document` has no `deleted_at` and no
`updated_at` on purpose, so adding one would mean permitting an UPDATE to the single table whose
whole value is never being updated. Instead the trigger now admits a DELETE only when the exact
document id has been named in `papertrail.purging` earlier in the same transaction — the same
session-setting guard C08 already uses for `papertrail.issuing`. A purge is two deliberate
statements; a single stray DELETE is still refused. No helper function was added, because a
`security definer` purge function would bypass RLS for whoever could execute it.

VERIFIED, each observed rather than assumed:
- The live function body is **byte-identical to the committed file** — `md5(prosrc)` from
  `pg_proc` and an md5 of the file's `$fn$…$fn$` body both give `4b41248880bf…208f`, 723 bytes.
- An unguarded `delete from public.document` is still **refused** with `42501` and the new
  message. The law still holds; this was checked before the purge path was used for anything.
- An `update` is still refused **even with `papertrail.purging` set to that row's id** — the
  guard unlocks DELETE only and widens nothing else. That is the claim the header makes, so it
  was tested rather than asserted.
- The leaked fixtures are gone and the project is back to its exact baseline: 2 companies,
  2 estimates, 0 documents, 0 counters, 2 `auth.users`, 0 rows matching `c09-%`.
- `gen types` output is unchanged by this migration, and that is checkable rather than hopeful:
  functions returning `trigger` are not emitted into `types/supabase.ts` — `document_freeze`,
  `set_updated_at` and `estimate_freeze_issued` all exist in the database and none appears in the
  generated file, while `record_document` (returning `document`) does. This migration replaces a
  trigger function body and adds no table, column, enum or callable function.

NOT VERIFIED:
- **The purge path is not wired into `lib/document-db.test.ts` teardown.** The migration makes
  cleanup possible; the suite still does not do it, so the next run will leak again and need the
  same manual purge. That change touches a currently-passing test file and cannot be verified
  from a container without the service-role key, so it is left as the next step rather than done
  blind.
- The live suites were not re-run after this migration. It only narrows what `document_freeze`
  refuses, and the suites never delete documents, so nothing in them should change — but that is
  inference.
- Storage is still untouched: the two orphaned PDFs from 2026-10-02 remain, and no browser has
  served a C09 route.

AWAITING HUMAN:
- Decide whether to wire the purge path into the documents suite's teardown (recommended, and it
  needs a worker run with the key to verify).
- Remove the two orphaned PDFs via the Storage API or the dashboard.
- `prompts/README.md` still lists C08 as `next` and C09 as `planned`; both have shipped.

## C09 follow-up — the purge path wired into teardown, and a correction

Wiring the purge path into `lib/document-db.test.ts` broke the design from the previous entry
and found two more teardown bugs. All three are fixed here.

THE DESIGN WAS UNREACHABLE. `20261122000000` requires `set_config('papertrail.purging', …)` and
the `DELETE` to share a transaction. The suite talks to the database through the Supabase JS
client, which goes via PostgREST, where **every call is its own transaction** — so the two can
never see each other and the guard was unusable from the one caller it was built for. The
previous entry's claim that no helper should exist "because it would have to be `security
definer`" is **withdrawn**: it does not have to be. `20261122000001` adds
`purge_document(uuid)` as SECURITY INVOKER (`prosecdef = false`, checked), which packages the
two statements into one transaction while granting nobody a capability they lacked —
service_role already had it, and an `authenticated` caller still meets RLS with no DELETE policy
on `public.document`. EXECUTE is additionally revoked from `public`, `anon` and `authenticated`
and granted only to `service_role`; verified with `has_function_privilege`: service_role true,
authenticated false, anon false, and `document` still has 0 DELETE policies.

TWO MORE TEARDOWN BUGS, both of which the live run's drift had already paid for:
- **Issued estimates were never retired.** The teardown called `delete` on `estimate` directly,
  which C08's trigger refuses for a non-draft row. PostgREST returned an error nobody read, so
  the estimate survived — that is the `+2 estimates` in the previous entry's drift, and it was
  never the documents' fault.
- **`document_counter` was never cleaned.** Those rows are company-scoped with `company_id`
  `on delete restrict`, so they block the company exactly as documents do — the `+12 counters`.

The teardown now retires before purging, deletes in the order the schema forces (lines →
estimates → documents via the RPC → counters → project/property/client → company), covers *both*
fixture companies rather than only A, collects every failure, and **throws** if anything remains
instead of warning. A teardown that leaks quietly is what let this accumulate for a whole run.

TYPES. `purge_document` returns `integer`, so unlike the previous migration this one does change
`gen types` output and the file had to be updated. It was updated by splicing, not rewritten —
and the reason is worth recording, because writing the generator's output wholesale would have
been a regression: a `generate_typescript_types` run for this project returns the **`public`
schema only** (15 tables), while the committed file carries a `graphql_public` block too and
pgcrypto's `dearmor` / `gen_random_uuid` / `gen_salt` / `pgp_armor_headers` (23 table blocks in
all). Replacing the file would have deleted all of that. So the two real deltas were taken
verbatim from the generator — the `purge_document` signature, placed alphabetically, and
`PostgrestVersion` `14.5` → `14.17` — which is exactly the splice-and-verify approach C09 used
and documented for the same reason. The stale PostgrestVersion recorded as outstanding two
entries ago is now correct.

VERIFIED: `purge_document`'s live body is byte-identical to the committed file (`md5(prosrc)` and
an md5 of the file's `$fn$…$fn$` body both `9481239e…4648`, 531 bytes). `build` 0, `lint` 0,
`typecheck` 0 — and typecheck passing is the real check on the splice, since it is what resolves
`admin.rpc('purge_document', …)`. `test` reads `3 failed | 9 passed (12)` / 219 in this
container, which is the credentials guard, not a regression.

NOT VERIFIED: **the new teardown has not run.** That needs a session holding the service-role
key; a worker run is queued and its result belongs in the next entry. Until it reports, the claim
that the leak is fixed is a design argument, not an observation. The two orphaned PDFs from
2026-10-02 are also still in the bucket.

## C09 follow-up — the teardown fix verified, and the bucket emptied

The previous entry's claim was a design argument. It has now been run, in a session holding the
service-role key, and the result is observed rather than inferred.

ZERO DRIFT. The same count query was taken before the runs, after `test:documents`, and again
after a full `npm run test`. All three are identical:

    companies=2  estimates=2  documents=0  counters=0  users=2  fixtures=0

That is the baseline exactly, on every column, in both directions. No stranded `c09-%` company.
The teardown's new throw-on-incomplete-cleanup path never fired, because there was nothing left
to report. Verified independently from this session afterwards, against the same project, with
the same numbers — plus `purge_document` present and 12 history rows matching the 12 migration
files on disk.

    npm run test:documents    Test Files  1 passed (1)       Tests  12 passed (12)
    npm run test              Test Files 12 passed (12)      Tests 278 passed (278)

**`lib/document-db.test.ts` no longer leaks.** Two consecutive runs left the live project
bit-for-bit identical, where one run previously stranded 4 companies, 2 estimates, 2 documents
and 12 counters.

STORAGE IS NOW CLEAN. The two PDFs orphaned on 2026-10-02 were removed through the Storage API
with the service-role key — `storage.objects` refuses direct SQL deletes, which is what made this
a hand step. Both returned HTTP 200, and the result was checked three ways: SQL says 0 objects in
every bucket, a Storage API listing of `documents` returns `[]`, and a direct GET of each path now
404s. Confirmed from this session too: 0 objects across all buckets. Only those two paths were
targeted.

ONE DOCUMENTATION WART, deliberately not fixed. `20261122000000_document_purge_path.sql` still
says in its header "No helper function is added on purpose", which `20261122000001` then
contradicts by adding one. Applied migrations are never edited, so the correction lives in the
newer migration's header (which withdraws the claim explicitly and says why) and in DECISIONS,
not by rewriting history. Worth knowing before that header misleads someone the way C03's one
wrong sentence did for six commits.

VERIFIED: nothing was edited, committed or schema-changed by the verification run; it reported a
clean tree at `ac4572d`.

AWAITING HUMAN: a browser pass on C09 — issue an estimate and open the generated PDF. Storage
upload and download have still never served a request, and C08's browser pass is what caught a
pricing defect every other layer of verification had missed.

## docs — migration count corrected from eleven to twelve

A one-word fix, recorded because this repo has twice paid for a single wrong sentence left
standing in its own instructions. The previous entry's CLAUDE.md update said "all eleven
migrations are applied"; it was written before `20261122000001_purge_document_rpc.sql` existed
and the count was never revisited. `supabase/migrations/` holds twelve `.sql` files (plus
`.gitkeep`), and `supabase_migrations.schema_migrations` holds twelve rows — both counts observed
rather than assumed, and they agree.

VERIFIED: `build` 0, `lint` 0, `typecheck` 0; `test` unchanged at `3 failed | 9 passed (12)` /
219 passed in a container without the service-role key, which is the credentials guard.

## C09 browser pass — one client-facing defect found and fixed, four more recorded

C08's lesson repeated itself exactly. Every layer of verification passed C09 — 278 tests, four
green gates, byte-identical determinism, a hash check on every download — and the first time
anyone looked at a rendered page, the body was wrong.

WHAT RAN, against the live project with the demo tenant. Sign-in; the project's estimate tab;
**Path A**, the retry route on issued v1 which had no document (`POST /api/estimate/:id/document`
→ 201, `EST-0001`); **Path B**, issuing draft v2 so the snapshot is taken automatically
(`POST …/issue` → 200, `EST-0002`, `document_error: null`); downloading both through the
session-authorized proxy (200, `content-type: application/pdf`, body hashing to the
`x-document-sha256` header); and rendering both to PNG and **looking at them**. A 300×100 PNG was
also uploaded through the real `/settings/company` UI → `POST /api/company/logo` 200, so the
letterhead logo branch rendered for the first time, and `company-assets` served its first object.

THE DOCUMENT IS GOOD. Single page, 612×792 Letter, correct legal name (not the DEMO display
name), address and contact, logo at the right aspect ratio, CLIENT and PROPERTY blocks, grouped
line items, totals, deposit, terms, signature block, footer "Page 1 of 1". Nothing clipped,
nothing overlapping, nothing off the page, no blank where a number belongs. Metadata carries
`CreationDate = issued_at`, not generation time, which is what makes the hash stable.

**THE DEFECT: every takeoff derivation printed `?` where the engine wrote `→`.** On the page:

    20 lin ft × 1 = 20 lin ft × 1.10 waste = 22 ? 25 lin ft (pkg of 12.5)

`sanitizeForPdf()` folds curly quotes, en/em dashes, ellipsis, nbsp, bullets, ™, ® and °, then
turns anything outside `0x20–0x7e` / `0xa0–0xff` into `?`. `×` and `÷` are Latin-1 and survive;
`→` (U+2192) is not. And `→` is **not pasted input** — `buildDerivation()` in `lib/takeoff.ts`
writes it on every assembly-derived line (lines 268 and 271), and `lib/estimate.test.ts:411`
asserts it verbatim. So this fired on the happy path, on every assembly line, of every estimate
PDF ever generated.

Worse than cosmetic: `= 22 ? 25 lin ft` no longer says the 22 was **rounded up to** 25, which is
the only thing the derivation exists to say. The audit trail C09 is built to produce was being
destroyed in the one artifact a client actually sees.

WHY EVERY LAYER MISSED IT. `lib/pdf.test.ts` tested `sanitizeForPdf` against an en-dash, a curly
quote, ™, ° and an emoji — all characters a *supplier* sends. It never tested the character
*this app writes itself*. The fix is one line; the regression test is the point, so two were
added: the literal derivation string, and a structural one that runs the real `computeTakeoff()`
output through the real `sanitizeForPdf()` and asserts no `?` survives, so the next
unrepresentable glyph added to a derivation fails in CI instead of on a client's estimate.

VERIFIED, first-hand in this session rather than relayed. The credentials finally reached this
container, and Node's `fetch` ignores `HTTPS_PROXY`, so `NODE_USE_ENV_PROXY=1` is what lets the
live suites run here at all — worth knowing, because without it they fail with `ENOTFOUND` and
look like a broken project:

- Both new tests **fail without the fix** and pass with it (the fix was stashed to confirm).
- `npm run test:isolation` → `Test Files 1 passed (1)`, `Tests 27 passed` — **the M1 gate, run
  and observed here, not taken from a worker's report.**
- `npm run test` → `Test Files 12 passed (12)`, `Tests 280 passed` (278 + the 2 new).
- `build` 0, `lint` 0, `typecheck` 0. Typecheck earned its keep: the first draft of the new
  fixture invented a `catalogItemId` field that `TakeoffComponent` does not have. The tests
  passed at runtime; `tsc` caught it.
- Zero leaked fixtures afterwards: 2 companies, 0 `c09-%`, 2 estimates, 2 users. The teardown fix
  from the previous entry now confirmed from a second, independent container.

A CONSEQUENCE OF THE FIX, measured rather than assumed. Changing the renderer changes the bytes,
so the two documents generated during the browser pass no longer re-render to their stored hash:

    EST-0001  stored=d8083f86af66dfd0  rerender=ebd7c8c6547d2668  matches=false
    EST-0002  stored=9dbea9f9c7a71ac8  rerender=b6d90ced581ff415  matches=false

Nothing is broken by this. The download route hashes the **stored bytes** and compares them to
the stored hash — those still agree, so tamper evidence and every download still work. But
`rehashEstimateDocument()` compares a fresh render, and that is only meaningful within one
renderer version. Anyone treating it as absolute will get a false positive after any deliberate
rendering change. The two demo documents are pre-fix artifacts; they can be purged with
`purge_document` and regenerated if the demo should be self-consistent, at the cost of burning
EST-0003/EST-0004, since numbers are never reused.

FOUR MORE FINDINGS, NOT FIXED — each is a product decision rather than a defect in what C09's
spec asks for, so they are recorded here instead of changed unilaterally:

1. **C09 has no UI at all.** Nothing in `pages/` or `components/` references `/api/document/` or
   `/api/estimate/[id]/document` — only the route files themselves. An issued estimate offers
   "Back to project / Itemized / Summary / Create revision" and nothing else. A contractor can
   issue an estimate and has **no way to see, download or send the PDF**; both routes are
   reachable only by hand-crafting an HTTP request. The spec asks for "download endpoints
   authorized by session", which exist and work — so this is arguably spec-complete and
   product-incomplete at the same time.
2. **The tax line cannot be reconciled from the page.** It prints `Subtotal 244.74`,
   `Tax (8.75%) 15.73`, `Total 260.47`. 244.74 × 8.75% is 21.41, not 15.73, because the taxable
   base is 179.74 — the $65 labour line is not taxed, which is correct — but the taxable base is
   never disclosed. Every number is right and every number reconciles internally; the one
   labelled "(8.75%)" simply invites a phone call, on a document whose purpose is to be
   defensible.
3. **The optional line states no amount.** `Gutter guards, rear elevation | 40 | lin_ft | 6.50 |
   optional` — the AMOUNT column reads "optional". Excluding it from the total is deliberate and
   footnoted, but its own price, 40 × 6.50 = $260.00, appears nowhere, and that is more than the
   whole job total. The biggest piece of missing money on the page.
4. **The UNIT column prints the raw enum slug**, `lin_ft`, while the derivation two lines below
   says `lin ft`. Same unit, two spellings, and the underscored one faces the client.

ALSO STILL UNEXERCISED: the licence/insurance letterhead branch, because those fields are NULL on
the demo tenant and inventing data to light up a code path proves nothing.

AWAITING HUMAN: which of the four above to take. The UI gap is the one that decides whether C09
is usable by a real contractor, and C10's share links assume a document a client can be sent.
