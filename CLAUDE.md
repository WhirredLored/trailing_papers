# Working in this repo

PaperTrail — field-first contracting software. Read `README.md` for what it is and
`prompts/README.md` for the build roadmap and what has shipped.

## How work is structured

One spec, one commit. Each `prompts/C##_*.md` is a complete, self-contained
specification ending in a commit message that must be used **verbatim**. Do not
combine two specs into one commit (C03 and C04 were, and it is the one blemish in
the history).

After each commit, append to `BUILDLOG.md`: what was built, what you actually
verified, and what still needs a human. Never claim a result you did not observe.
Every judgment call gets one line in `docs/DECISIONS.md`.

## Gates — all four must pass before a commit is done

```bash
npm run build && npm run test && npm run lint && npm run typecheck
```

`npm run test:isolation` runs the cross-tenant RLS suite against the live project.
It is the M1 tenancy gate and it is not optional: it went silently dead for four
days once, and everything built on top of it was unverified. If a test file stops
collecting, the suite still reports "N passed" — check the **file** count, not just
the test count.

## Database workflow

Migrations are timestamped SQL, never edited after being applied. Apply and then
**always regenerate types in the same breath**:

```bash
npx supabase db push
npx supabase gen types typescript --linked > types/supabase.ts
```

Skipping the regeneration makes every new table resolve to `never`, producing a wall
of type errors that look like broken code but are not.

The CLI is linked in a local checkout, but **not in a fresh cloud container**: there is no
`.env`, `db push` fails with `LegacyProjectNotLinkedError`, and the container's egress proxy
carries HTTPS only, so Postgres on 5432 is unreachable even once the host is allowed. From a
cloud session apply DDL with the Supabase MCP server instead, then record the history row under
the version its repo file carries — that is the same gap `migration repair` exists to close.

If a migration was applied by hand in the SQL editor, its history row is missing and
`db push` will try to re-apply it — repair first:

```bash
npx supabase migration repair --status applied <version>
```

## Non-negotiables

- **Tenancy lives in the database.** Every table has `company_id` and an RLS policy.
  No query relies on an application-layer filter for isolation. A missing policy is a
  security defect, not a TODO.
- **Roles come from `app_metadata`**, never `user_metadata` (user-writable, so trusting
  it is privilege escalation). Re-check authorization in every API route.
- **Money is integer cents.** All arithmetic and formatting goes through `lib/money.ts`.
  Totals are recomputed server-side and never trusted from the client.
- **Issued documents are immutable.** Corrections happen by new version or credit note.
- **The service-role key never reaches the browser.** `lib/supabase-server.ts` throws if
  evaluated client-side; ESLint blocks the import from `pages/` and `components/`.
- **Implement only what the spec asks.** Unrelated findings become a DECISIONS.md line.

## Do not touch

- `types/supabase.ts` — generated; regenerate, never hand-edit. Import the `Tables` /
  `Insert` / `Update` / `Enums` helpers from `types/db.ts` instead of reaching into it.
- `prompts/` and `.agents/` — verbatim source material, excluded from Prettier.
- Applied migrations — add a new one instead.

## Testing against the live project

Tests that touch the database must seed **both** tenants. With rows on only one side,
every "cannot read the other company" assertion passes against an empty table and
proves nothing. Tear down in foreign-key order — `company_id` references are
`on delete restrict` and `created_by` references `auth.users`, so domain rows must go
before users and companies or cleanup fails silently and leaks fixtures.

## Storage buckets

Buckets are declared in SQL, in `supabase/migrations/20260917000000_storage_buckets.sql`.
`storage.buckets` is an ordinary table and `db push` connects as `postgres`, which holds
INSERT on it — so a bucket is an `insert ... on conflict (id) do nothing`, not a dashboard
chore. C03 claimed otherwise and left a hand-off note that six commits carried forward;
don't reintroduce it. Add a new bucket to a new migration alongside its policies.

The policies on `storage.objects` still belong to the commit that owns the bucket's
feature — C03 for `company-assets`, C09 for `documents`.

## Outstanding

All eleven migrations are applied to the `Trailing_papers` project (ref `ocghrrsotgprgrbvgyel`),
and both storage buckets exist with `documents` private, 25 MB, `application/pdf` only.

**The M1 tenancy gate is green.** With `SUPABASE_SERVICE_ROLE_KEY` set on the cloud environment,
all three live suites collect and pass: `test:isolation` 27, `test:estimates` 20,
`test:documents` 12, and a full run is `12 passed (12)` files / 278 tests. A container without
that key still reports three failed _files_ — that is the credentials guard, not a regression, and
the file count is the tell.

The suites also no longer leak. `lib/document-db.test.ts` used to strand a fixture tenant on
every run, because a document row cannot be deleted and `company_id` is `on delete restrict`.
`purge_document(uuid)` (migration `20261122000001`) is the only path the freeze trigger allows —
it sets `papertrail.purging` and deletes in one transaction, which a PostgREST caller cannot do
with two separate calls. Teardown uses it, and **throws** if anything is left behind. Verified by
two consecutive runs that left the project bit-for-bit identical. Both storage buckets are empty.

If you add a suite that writes `document` rows, tear them down through `purge_document` —
a plain delete is refused, and the row will pin its company forever.

What remains:

- No browser has served a C09 route, and Storage upload/download is still unexercised — the DB
  suite does not touch it. C08's lesson was that a browser pass caught a pricing defect every
  other layer missed.
- `prompts/README.md` still lists C08 as `next` and C09 as `planned`; both have shipped. It is
  verbatim source material, so it is recorded here rather than edited.
