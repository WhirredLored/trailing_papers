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
