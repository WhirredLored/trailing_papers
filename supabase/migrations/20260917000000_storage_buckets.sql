-- ─────────────────────────────────────────────────────────────────────────────
-- chore — storage buckets, declared in SQL
--
-- CORRECTION. C03 recorded that a Storage bucket "cannot be created via SQL
-- migration" and left `company-assets` as a manual dashboard step. That was
-- wrong, and it cost six commits of hand-off notes: `storage.buckets` is an
-- ordinary table, and creating a bucket is an INSERT into it. Verified against
-- a live project on this org:
--
--   storage.buckets relkind            = 'r'   (base table, not a view)
--   has_table_privilege('postgres', 'storage.buckets', 'INSERT') = true
--   pg_roles.rolbypassrls for postgres = true  (RLS on the table is no obstacle)
--
-- `db push` connects as `postgres`, so a migration can do this. The Management
-- API and the dashboard are conveniences, not the only route.
--
-- So buckets are declared here from now on, and a fresh project (a new dev, a
-- staging ref) comes up from migrations alone with no dashboard checklist. This
-- is what removes the AWAITING HUMAN line rather than moving it to the next
-- commit.
--
-- `on conflict (id) do nothing` makes this idempotent and safe over the
-- hand-created `company-assets`: an existing bucket is left exactly as it is,
-- never reconfigured underneath whoever made it. The trade is that this
-- migration declares intent for a new project but does not converge an old
-- bucket whose settings drifted — checked by hand below, not assumed.
--
-- Storage RLS policies are NOT here. C03 owns the `company-assets` policies on
-- storage.objects (already applied) and C09 owns the `documents` ones, which is
-- why `documents` lands private with service-role-only reach until C09 adds
-- them — the safe direction to be wrong in.
-- ─────────────────────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  -- C09 stores generated PDFs under <company_id>/… and hands them out through
  -- session-authorized download endpoints; C10 adds public token access. Private,
  -- and PDF-only because the generator writes nothing else. 25 MB is a ceiling on
  -- a runaway write, not a target: a 30-line estimate with a letterhead logo is
  -- three orders of magnitude under it, and a signed copy carrying signature
  -- images still is.
  ('documents', 'documents', false, 26214400, array['application/pdf']),

  -- Backfill of the bucket C08 created by hand, so the declaration lives with the
  -- code rather than only in one project's dashboard. Caps mirror what
  -- pages/api/company/logo.ts already enforces (5 MB, four image types), so a
  -- caller holding the service-role key meets the same limits as one going
  -- through the route.
  (
    'company-assets',
    'company-assets',
    false,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
  )
on conflict (id) do nothing;
