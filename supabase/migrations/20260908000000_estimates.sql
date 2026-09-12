-- ─────────────────────────────────────────────────────────────────────────────
-- C08 — estimates and estimate lines (versioned, immutable once issued)
--
-- Follows the C02 tenancy template:
--   company_id + RLS (select, insert, update) + soft-delete + updated_at trigger
--
-- Architecture Law 3 is enforced HERE, not in the UI. Once an estimate leaves
-- 'draft' its content, its totals and its line items are frozen by trigger. The
-- only writes that remain legal on a frozen estimate are lifecycle moves: a
-- status transition, the PDF snapshot pointer, and the supersede pointer.
--
-- Law 5: issuing and revising go through row-locking functions, and both are
-- idempotent — calling them twice changes nothing the second time.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── enums ───────────────────────────────────────────────────────────────────
create type public.estimate_status as enum (
  'draft', 'issued', 'approved', 'declined', 'expired', 'superseded'
);

-- Two client-visible detail levels, chosen at issue time. Same underlying rows:
-- 'itemized' publishes every line, 'summary' publishes group totals only.
create type public.estimate_detail_level as enum ('itemized', 'summary');

-- How a unit price is derived from a unit cost. These are NOT the same number
-- (see lib/money.ts): 20% markup on $100 is $120, 20% margin is $125.
create type public.estimate_pricing_mode as enum ('markup', 'margin');

-- Shared by the discount and the deposit: a value is either a percentage or a
-- fixed amount in cents. Mirrors TotalsInput in lib/totals.ts.
create type public.amount_mode as enum ('percent', 'fixed');

-- ─── estimate ────────────────────────────────────────────────────────────────
create table public.estimate (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.company(id) on delete restrict,
  project_id                uuid not null references public.project(id) on delete restrict,

  version                   integer not null default 1 check (version >= 1),
  status                    public.estimate_status not null default 'draft',

  title                     text,
  -- Client-visible detail level, fixed at issue time.
  detail_level              public.estimate_detail_level not null default 'itemized',
  -- Default applied when a catalog item is priced onto this estimate.
  pricing_mode              public.estimate_pricing_mode not null default 'markup',
  pricing_bp                integer not null default 0
                              check (pricing_bp >= 0 and pricing_bp <= 50000),

  -- Terms and notes. internal_notes is never rendered to a client.
  terms                     text,
  notes_to_client           text,
  internal_notes            text,

  -- Money terms (all integer, per Law 4).
  tax_rate_bp               integer not null default 0
                              check (tax_rate_bp >= 0 and tax_rate_bp <= 10000),
  discount_mode             public.amount_mode not null default 'percent',
  discount_value            integer not null default 0 check (discount_value >= 0),
  deposit_mode              public.amount_mode not null default 'percent',
  deposit_value             integer not null default 0 check (deposit_value >= 0),

  -- Totals snapshot. Recomputed server-side through lib/totals.ts on every save
  -- and frozen at issue. Never trusted from the client (Law 4).
  subtotal_cents            integer not null default 0,
  discount_cents            integer not null default 0,
  taxable_subtotal_cents    integer not null default 0,
  tax_cents                 integer not null default 0,
  total_cents               integer not null default 0,
  deposit_due_cents         integer not null default 0,
  balance_due_cents         integer not null default 0,

  -- Internal profitability snapshot. NEVER client-visible.
  estimated_cost_cents      integer not null default 0,
  margin_cents              integer not null default 0,
  margin_bp                 integer not null default 0,

  issued_at                 timestamptz,
  expires_at                timestamptz,

  -- The frozen PDF snapshot taken at issue. The `document` table arrives in C09;
  -- its foreign key is added by that migration rather than forward-declared here.
  pdf_document_id           uuid,

  -- Version chain. A revision points back at the version it was cloned from;
  -- that version gains a forward pointer when the revision is issued.
  revised_from_estimate_id  uuid references public.estimate(id) on delete restrict,
  superseded_by_estimate_id uuid references public.estimate(id) on delete restrict,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references auth.users(id),
  deleted_at                timestamptz,
  deleted_by                uuid references auth.users(id),

  -- An estimate that has left draft always carries its issue timestamp.
  constraint estimate_issued_has_timestamp
    check (status = 'draft' or issued_at is not null)
);

-- One row per version per project.
create unique index estimate_project_version_idx
  on public.estimate (project_id, version)
  where deleted_at is null;

create index estimate_company_id_idx on public.estimate (company_id);
create index estimate_project_id_idx on public.estimate (project_id);
create index estimate_company_status_idx
  on public.estimate (company_id, status)
  where deleted_at is null;

alter table public.estimate enable row level security;

create policy "estimate: members can read company estimates"
  on public.estimate for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "estimate: members can insert company estimates"
  on public.estimate for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "estimate: members can update company estimates"
  on public.estimate for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

create trigger estimate_updated_at
  before update on public.estimate
  for each row execute function public.set_updated_at();

-- ─── estimate_line ───────────────────────────────────────────────────────────
-- A line is one of three things:
--   catalog line   — catalog_item_id set, priced from the price book
--   assembly line  — assembly_id + driver_quantity set, one of a generated group
--   free-text line — both null, typed by the contractor
--
-- unit_cost_cents is snapshotted onto the line rather than read back through
-- catalog_item: a repriced price book must not move the margin on an estimate
-- that was already issued, and free-text lines have no catalog row to read.
create table public.estimate_line (
  id                 uuid primary key default gen_random_uuid(),
  estimate_id        uuid not null references public.estimate(id) on delete cascade,
  company_id         uuid not null references public.company(id) on delete restrict,

  sort_order         integer not null default 0,
  kind               public.catalog_item_kind not null default 'material',

  catalog_item_id    uuid references public.catalog_item(id) on delete restrict,
  assembly_id        uuid references public.assembly(id) on delete restrict,
  driver_quantity    numeric(12,4) check (driver_quantity >= 0),
  -- Ties the components generated by one takeoff together so the group can be
  -- re-driven or removed as a unit.
  assembly_group_id  uuid,

  description        text not null check (char_length(description) between 1 and 500),
  quantity           numeric(12,4) not null default 1 check (quantity >= 0),
  unit               public.catalog_item_unit not null default 'ea',
  unit_price_cents   integer not null default 0 check (unit_price_cents >= 0),
  unit_cost_cents    integer not null default 0 check (unit_cost_cents >= 0),

  taxable            boolean not null default true,
  -- An optional line displays on the estimate but does not count toward the
  -- total until it is selected.
  is_optional        boolean not null default false,
  is_selected        boolean not null default false,
  group_label        text,
  -- The takeoff derivation string, kept so the quantity stays auditable.
  derivation         text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),

  -- An assembly-generated line always records what drove it.
  constraint estimate_line_assembly_has_driver
    check (assembly_id is null or driver_quantity is not null),
  -- Selection is meaningless on a line that is not optional.
  constraint estimate_line_selected_implies_optional
    check (is_optional or not is_selected)
);

create index estimate_line_estimate_id_idx on public.estimate_line (estimate_id, sort_order);
create index estimate_line_company_id_idx on public.estimate_line (company_id);
create index estimate_line_catalog_item_id_idx
  on public.estimate_line (catalog_item_id)
  where catalog_item_id is not null;
create index estimate_line_assembly_group_idx
  on public.estimate_line (assembly_group_id)
  where assembly_group_id is not null;

alter table public.estimate_line enable row level security;

create policy "estimate_line: members can read company lines"
  on public.estimate_line for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "estimate_line: members can insert company lines"
  on public.estimate_line for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "estimate_line: members can update company lines"
  on public.estimate_line for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

-- Lines are replaced wholesale while the estimate is a draft, so delete is a
-- normal part of editing. The freeze trigger below is what stops a delete once
-- the estimate has been issued.
create policy "estimate_line: members can delete company lines"
  on public.estimate_line for delete
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create trigger estimate_line_updated_at
  before update on public.estimate_line
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- IMMUTABILITY (Architecture Law 3)
-- ─────────────────────────────────────────────────────────────────────────────

-- Guard on the estimate row itself.
--
-- While the estimate is a draft everything is editable EXCEPT the status, which
-- may only leave 'draft' through issue_estimate(). That function announces
-- itself with a transaction-local setting, so a direct `update ... set status =
-- 'issued'` from any client — even one holding the service-role key — is
-- rejected rather than producing an "issued" estimate with unfrozen totals and
-- no PDF snapshot.
--
-- Once the estimate is not a draft, only lifecycle columns may move.
create or replace function public.estimate_freeze_issued()
returns trigger
language plpgsql
as $fn$
begin
  if TG_OP = 'DELETE' then
    if OLD.status <> 'draft' then
      raise exception
        'Estimate % (v%) is % and cannot be deleted. Issued documents are immutable (Law 3); audit, do not delete (Law 8).',
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

  -- The PDF snapshot is written once and never replaced.
  if NEW.pdf_document_id is distinct from OLD.pdf_document_id
     and OLD.pdf_document_id is not null then
    raise exception
      'Estimate % (v%) already has a PDF snapshot; a frozen document is never replaced (Law 3).',
      OLD.id, OLD.version
      using errcode = '42501';
  end if;

  -- Legal lifecycle transitions.
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

create trigger estimate_freeze
  before update or delete on public.estimate
  for each row execute function public.estimate_freeze_issued();

-- Guard on the lines. A line may not be inserted, changed or removed unless its
-- estimate is still a draft. Deleting the estimate itself cascades here; by then
-- the parent row is gone, so the lookup finds nothing and the cascade proceeds
-- (a non-draft estimate cannot be deleted in the first place).
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
  from public.estimate where id = v_estimate_id;

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

create trigger estimate_line_freeze
  before insert or update or delete on public.estimate_line
  for each row execute function public.estimate_line_freeze_issued();

-- ─────────────────────────────────────────────────────────────────────────────
-- LIFECYCLE FUNCTIONS (Architecture Law 5 — atomic, row-locked, idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- Freeze a draft: write the server-computed totals, stamp issued_at, fix the
-- client-visible detail level, and supersede the version this one revises.
--
-- The totals arrive already computed by lib/totals.ts — the single engine every
-- total in PaperTrail goes through — rather than being recomputed in SQL, so
-- there is no second implementation to drift from it. The API route computes
-- them from the stored lines, never from anything the client sent.
--
-- Idempotent: issuing an estimate that is no longer a draft returns the frozen
-- row untouched.
create or replace function public.issue_estimate(
  p_estimate_id  uuid,
  p_company_id   uuid,
  p_detail_level public.estimate_detail_level,
  p_expires_at   timestamptz,
  p_totals       jsonb,
  p_profit       jsonb
) returns public.estimate
language plpgsql
as $fn$
declare
  v_estimate public.estimate;
  v_prior    public.estimate;
begin
  select * into v_estimate
  from public.estimate
  where id = p_estimate_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Estimate % not found.', p_estimate_id using errcode = 'P0002';
  end if;

  if v_estimate.company_id <> p_company_id then
    raise exception 'Estimate % belongs to another company.', p_estimate_id
      using errcode = '42501';
  end if;

  if v_estimate.status <> 'draft' then
    return v_estimate;
  end if;

  if not exists (select 1 from public.estimate_line where estimate_id = p_estimate_id) then
    raise exception 'Estimate % has no line items and cannot be issued.', p_estimate_id
      using errcode = '22023';
  end if;

  perform set_config('papertrail.issuing', p_estimate_id::text, true);

  update public.estimate set
    status                 = 'issued',
    issued_at              = now(),
    expires_at             = p_expires_at,
    detail_level           = p_detail_level,
    subtotal_cents         = (p_totals ->> 'subtotalCents')::integer,
    discount_cents         = (p_totals ->> 'discountCents')::integer,
    taxable_subtotal_cents = (p_totals ->> 'taxableSubtotalCents')::integer,
    tax_cents              = (p_totals ->> 'taxCents')::integer,
    total_cents            = (p_totals ->> 'totalCents')::integer,
    deposit_due_cents      = (p_totals ->> 'depositDueCents')::integer,
    balance_due_cents      = (p_totals ->> 'balanceDueCents')::integer,
    estimated_cost_cents   = (p_profit ->> 'estimatedCostCents')::integer,
    margin_cents           = (p_profit ->> 'marginCents')::integer,
    margin_bp              = (p_profit ->> 'marginBp')::integer
  where id = p_estimate_id
  returning * into v_estimate;

  -- The prior version is superseded only now — at issue, not when the revision
  -- was created. A revision abandoned in draft leaves the issued version standing.
  if v_estimate.revised_from_estimate_id is not null then
    select * into v_prior
    from public.estimate
    where id = v_estimate.revised_from_estimate_id
    for update;

    if found and v_prior.status in ('issued', 'approved', 'declined', 'expired') then
      update public.estimate
      set status = 'superseded', superseded_by_estimate_id = v_estimate.id
      where id = v_prior.id;
    end if;
  end if;

  return v_estimate;
end;
$fn$;

-- Clone an issued estimate to version N+1 in draft. Editing an issued estimate
-- is impossible; this is the action that replaces it.
--
-- Idempotent: if a draft revision of this estimate already exists, it is
-- returned rather than a second one being created.
create or replace function public.create_estimate_revision(
  p_estimate_id uuid,
  p_company_id  uuid,
  p_actor       uuid
) returns public.estimate
language plpgsql
as $fn$
declare
  v_source   public.estimate;
  v_existing public.estimate;
  v_revision public.estimate;
  v_version  integer;
begin
  select * into v_source
  from public.estimate
  where id = p_estimate_id and deleted_at is null
  for update;

  if not found then
    raise exception 'Estimate % not found.', p_estimate_id using errcode = 'P0002';
  end if;

  if v_source.company_id <> p_company_id then
    raise exception 'Estimate % belongs to another company.', p_estimate_id
      using errcode = '42501';
  end if;

  if v_source.status = 'draft' then
    raise exception 'Estimate % (v%) is still a draft — edit it directly.',
      p_estimate_id, v_source.version
      using errcode = '22023';
  end if;

  select * into v_existing
  from public.estimate
  where revised_from_estimate_id = p_estimate_id
    and status = 'draft'
    and deleted_at is null
  limit 1;

  if found then
    return v_existing;
  end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.estimate
  where project_id = v_source.project_id and deleted_at is null;

  insert into public.estimate (
    company_id, project_id, version, status, title, detail_level,
    pricing_mode, pricing_bp, terms, notes_to_client, internal_notes,
    tax_rate_bp, discount_mode, discount_value, deposit_mode, deposit_value,
    subtotal_cents, discount_cents, taxable_subtotal_cents, tax_cents,
    total_cents, deposit_due_cents, balance_due_cents,
    estimated_cost_cents, margin_cents, margin_bp,
    revised_from_estimate_id, created_by
  ) values (
    v_source.company_id, v_source.project_id, v_version, 'draft', v_source.title,
    v_source.detail_level, v_source.pricing_mode, v_source.pricing_bp,
    v_source.terms, v_source.notes_to_client, v_source.internal_notes,
    v_source.tax_rate_bp, v_source.discount_mode, v_source.discount_value,
    v_source.deposit_mode, v_source.deposit_value,
    v_source.subtotal_cents, v_source.discount_cents, v_source.taxable_subtotal_cents,
    v_source.tax_cents, v_source.total_cents, v_source.deposit_due_cents,
    v_source.balance_due_cents, v_source.estimated_cost_cents, v_source.margin_cents,
    v_source.margin_bp, v_source.id, p_actor
  ) returning * into v_revision;

  insert into public.estimate_line (
    estimate_id, company_id, sort_order, kind, catalog_item_id, assembly_id,
    driver_quantity, assembly_group_id, description, quantity, unit,
    unit_price_cents, unit_cost_cents, taxable, is_optional, is_selected,
    group_label, derivation, created_by
  )
  select
    v_revision.id, company_id, sort_order, kind, catalog_item_id, assembly_id,
    driver_quantity, assembly_group_id, description, quantity, unit,
    unit_price_cents, unit_cost_cents, taxable, is_optional, is_selected,
    group_label, derivation, p_actor
  from public.estimate_line
  where estimate_id = v_source.id
  order by sort_order;

  return v_revision;
end;
$fn$;
