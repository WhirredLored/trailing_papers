-- ─────────────────────────────────────────────────────────────────────────────
-- C09 follow-up — a purge path for `document`
--
-- C09 made document rows absolutely undeletable, which is Law 8 working as
-- intended for real evidence. But absolute leaves no way to remove a row that
-- genuinely must go, and the first live run of lib/document-db.test.ts showed
-- what that costs: a document row cannot be deleted, `document.company_id` is
-- `on delete restrict`, so the fixture company that owns it can never be torn
-- down either. One run leaked two companies, one estimate, one document and six
-- counter rows into the live project, and every future run would add more.
--
-- C08 solved the same problem for estimates twice over, and this migration
-- deliberately copies the SECOND of its two patterns:
--
--   1. retire-before-purge — set deleted_at, then DELETE is allowed.
--   2. a session-setting guard — `papertrail.issuing` must name the exact row
--      before the trigger permits an otherwise-forbidden transition.
--
-- Pattern 1 is wrong here. C09 states, in the migration and in DECISIONS, that
-- `document` has no deleted_at and no updated_at ON PURPOSE: the row never
-- changes. Adding deleted_at would mean permitting an UPDATE to the one table
-- whose whole value is that it is never updated — trading the invariant away to
-- get a delete.
--
-- Pattern 2 keeps the row immutable to the very end. The row is never written
-- again; it is either there or purged. A purge takes two deliberate statements
-- in one transaction, naming the exact document id:
--
--   select set_config('papertrail.purging', '<document id>', true);
--   delete from public.document where id = '<document id>';
--
-- A single stray DELETE is still refused, which is what the law protects
-- against. The blast radius is unchanged from C09: there is no DELETE policy on
-- public.document, so no authenticated session can reach this path at all under
-- RLS — it is service-role only, and the service-role key never reaches the
-- browser (Law 9). The guard is `true`-scoped (transaction-local), so it cannot
-- leak into a later statement on a pooled connection.
--
-- No helper function is added on purpose. A `security definer` purge function
-- would bypass RLS for whoever could execute it, so it would need its own grant
-- discipline to avoid becoming the hole this trigger exists to prevent. Two
-- plain statements need no privileges beyond those a service-role caller
-- already has.
--
-- UPDATE remains refused unconditionally. Nothing below widens it.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.document_freeze()
returns trigger
language plpgsql
as $fn$
begin
  if TG_OP = 'DELETE' then
    -- Purge: permitted only when this exact document id has been named in
    -- papertrail.purging earlier in the same transaction.
    if coalesce(current_setting('papertrail.purging', true), '') = OLD.id::text then
      return OLD;
    end if;

    raise exception
      'Document % (%) cannot be deleted. Audit, do not delete (Law 8). To purge a row that must truly go, name it in papertrail.purging in the same transaction first.',
      OLD.id, OLD.number_text
      using errcode = '42501';
  end if;

  raise exception
    'Document % (%) is immutable (Law 3). Generate a new version instead of editing the record.',
    OLD.id, OLD.number_text
    using errcode = '42501';
end;
$fn$;
