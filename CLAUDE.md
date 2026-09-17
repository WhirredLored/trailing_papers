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
of type errors that look like broken code but are not. The CLI is already linked.

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

`20260917000000_storage_buckets.sql` has not been applied: no Supabase project was
reachable from the session that wrote it. Apply it with the usual `db push`, then confirm
both buckets exist and `documents` is private.
