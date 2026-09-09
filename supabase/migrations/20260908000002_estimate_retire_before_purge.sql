-- ─────────────────────────────────────────────────────────────────────────────
-- C08 — retire before purge
--
-- The freeze trigger refuses to hard-delete an issued estimate, which is Law 8
-- working as intended. But "never, under any circumstances" leaves no way to
-- remove a record that genuinely must go — a retention request, or the fixtures
-- a test run creates against the live project, which would otherwise accumulate
-- in the customer's data forever.
--
-- So the rule becomes: RETIRE, THEN PURGE. A non-draft estimate can only be
-- hard-deleted once it has been soft-deleted with attribution, which makes a
-- purge two deliberate statements rather than one stray DELETE. A single
-- accidental delete is still refused, which is what the law is protecting
-- against.
--
-- The blast radius is narrow: there is no DELETE policy on public.estimate, so
-- no authenticated user can reach this path at all under RLS. It is available
-- only to the service role, which never reaches the browser (Law 9).
--
-- The line trigger gets the matching change: the lines of a retired estimate can
-- go with it. This is also what lets the cascade from a purged estimate through
-- to its lines proceed.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.estimate_freeze_issued()
returns trigger
language plpgsql
as $fn$
begin
  if TG_OP = 'DELETE' then
    if OLD.status <> 'draft' and OLD.deleted_at is null then
      raise exception
        'Estimate % (v%) is % and cannot be deleted. Issued documents are immutable (Law 3); retire it with deleted_at first if it truly must be purged (Law 8).',
        OLD.id, OLD.version, OLD.status
        using errcode = '42501';
    end if;
    return OLD;
  end if;

  if OLD.status = 'draft' then
    if NEW.status is distinct from OLD.status
       and coalesce(current_setting('papertrail.issuing', true), '') <> OLD.id::text then
      raise exception
        'Estimate % (v%) can only leave draft through issue_estimate(), which freezes its totals and takes the PDF snapshot.',
        OLD.id, OLD.version
        using errcode = '42501';
    end if;
    return NEW;
  end if;

  -- Frozen: content, money terms, totals and profitability are all fixed.
  if NEW.company_id               is distinct from OLD.company_id
  or NEW.project_id               is distinct from OLD.project_id
  or NEW.version                  is distinct from OLD.version
  or NEW.title                    is distinct from OLD.title
  or NEW.detail_level             is distinct from OLD.detail_level
  or NEW.pricing_mode             is distinct from OLD.pricing_mode
  or NEW.pricing_bp               is distinct from OLD.pricing_bp
  or NEW.terms                    is distinct from OLD.terms
  or NEW.notes_to_client          is distinct from OLD.notes_to_client
  or NEW.tax_rate_bp              is distinct from OLD.tax_rate_bp
  or NEW.discount_mode            is distinct from OLD.discount_mode
  or NEW.discount_value           is distinct from OLD.discount_value
  or NEW.deposit_mode             is distinct from OLD.deposit_mode
  or NEW.deposit_value            is distinct from OLD.deposit_value
  or NEW.subtotal_cents           is distinct from OLD.subtotal_cents
  or NEW.discount_cents           is distinct from OLD.discount_cents
  or NEW.taxable_subtotal_cents   is distinct from OLD.taxable_subtotal_cents
  or NEW.tax_cents                is distinct from OLD.tax_cents
  or NEW.total_cents              is distinct from OLD.total_cents
  or NEW.deposit_due_cents        is distinct from OLD.deposit_due_cents
  or NEW.balance_due_cents        is distinct from OLD.balance_due_cents
  or NEW.estimated_cost_cents     is distinct from OLD.estimated_cost_cents
  or NEW.margin_cents             is distinct from OLD.margin_cents
  or NEW.margin_bp                is distinct from OLD.margin_bp
  or NEW.issued_at                is distinct from OLD.issued_at
  or NEW.expires_at               is distinct from OLD.expires_at
  or NEW.revised_from_estimate_id is distinct from OLD.revised_from_estimate_id
  then
    raise exception
      'Estimate % (v%) was issued on % and is immutable (Law 3). Create a revision instead.',
      OLD.id, OLD.version, OLD.issued_at
      using errcode = '42501';
  end if;

  if NEW.pdf_document_id is distinct from OLD.pdf_document_id
     and OLD.pdf_document_id is not null then
    raise exception
      'Estimate % (v%) already has a PDF snapshot; a frozen document is never replaced (Law 3).',
      OLD.id, OLD.version
      using errcode = '42501';
  end if;

  if NEW.status is distinct from OLD.status then
    if not (
         (OLD.status = 'issued'   and NEW.status in ('approved', 'declined', 'expired', 'superseded'))
      or (OLD.status = 'approved' and NEW.status = 'superseded')
      or (OLD.status = 'declined' and NEW.status = 'superseded')
      or (OLD.status = 'expired'  and NEW.status = 'superseded')
    ) then
      raise exception 'Illegal estimate status transition % → % on estimate %.',
        OLD.status, NEW.status, OLD.id
        using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$fn$;

-- The lines of a retired estimate are no longer frozen — they go when it goes.
-- Looking the parent up with `deleted_at is null` covers both cases: a retired
-- estimate and a parent already removed by an in-flight cascade both come back
-- as "no such draft-or-live estimate", and the write proceeds.
create or replace function public.estimate_line_freeze_issued()
returns trigger
language plpgsql
as $fn$
declare
  v_estimate_id uuid;
  v_status      public.estimate_status;
  v_version     integer;
begin
  v_estimate_id := case when TG_OP = 'DELETE' then OLD.estimate_id else NEW.estimate_id end;

  select status, version into v_status, v_version
  from public.estimate
  where id = v_estimate_id and deleted_at is null;

  if v_status is not null and v_status <> 'draft' then
    raise exception
      'Estimate % (v%) is % — its line items are frozen (Law 3). Create a revision instead.',
      v_estimate_id, v_version, v_status
      using errcode = '42501';
  end if;

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$fn$;
