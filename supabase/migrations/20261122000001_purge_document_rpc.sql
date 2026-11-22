-- ─────────────────────────────────────────────────────────────────────────────
-- C09 follow-up — purge_document(), because PostgREST has no transactions
--
-- 20261122000000 gave `document` a purge path: name the row in
-- `papertrail.purging`, then DELETE it, both in the SAME transaction. That works
-- from SQL. It cannot work from the Supabase JS client, which reaches the
-- database through PostgREST, where every call is its own transaction — so a
-- `set_config` call and a `delete` call can never see each other, and the guard
-- is unreachable from the one caller that most needs it: the test teardown the
-- purge path was added for.
--
-- The previous migration's header argued that no helper should exist because it
-- "would have to be `security definer`". That was wrong, and this migration
-- withdraws it. The function does not need to be definer, because the only
-- caller that should succeed — the service role — already holds the privilege.
-- SECURITY INVOKER (the default, left explicit below) means:
--
--   * called by service_role, RLS is bypassed as usual and the delete proceeds;
--   * called by anon or authenticated, RLS still applies, and since C09
--     deliberately gives public.document no DELETE policy, zero rows match and
--     the call returns 0 having changed nothing.
--
-- So it packages two statements into one transaction without granting anyone a
-- capability they did not already have. EXECUTE is still narrowed to
-- service_role below, so the function is not even reachable from a browser
-- session — RLS is the boundary, the grant is the second lock.
--
-- Returns the number of rows purged (0 or 1) so a caller can tell "nothing
-- matched" from "it worked", which a bare void return hides.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.purge_document(p_document_id uuid)
returns integer
language plpgsql
security invoker
as $fn$
declare
  v_purged integer;
begin
  -- Transaction-local, and naming this exact row: the guard cannot become a
  -- blanket "deletes are allowed now" switch for anything else in this
  -- transaction.
  perform set_config('papertrail.purging', p_document_id::text, true);

  delete from public.document where id = p_document_id;
  get diagnostics v_purged = row_count;

  -- Close the window immediately rather than relying on the transaction ending.
  perform set_config('papertrail.purging', '', true);

  return v_purged;
end;
$fn$;

revoke execute on function public.purge_document(uuid) from public;
revoke execute on function public.purge_document(uuid) from anon;
revoke execute on function public.purge_document(uuid) from authenticated;
grant execute on function public.purge_document(uuid) to service_role;
