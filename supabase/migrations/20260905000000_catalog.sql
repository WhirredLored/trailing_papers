-- ─────────────────────────────────────────────────────────────────────────────
-- C06 — catalog items (price book) and price history
-- Follows the C02 tenancy template:
--   company_id + RLS (select, insert, update) + soft-delete + updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── catalog item kind enum ──────────────────────────────────────────────────
create type public.catalog_item_kind as enum (
  'labor', 'material', 'equipment', 'subcontract', 'other'
);

-- ─── catalog item unit enum ──────────────────────────────────────────────────
create type public.catalog_item_unit as enum (
  'ea', 'sq_ft', 'lin_ft', 'sq', 'hour', 'day', 'load'
);

-- ─── catalog_item ────────────────────────────────────────────────────────────
create table public.catalog_item (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.company(id) on delete restrict,
  code              text not null check (char_length(code) between 1 and 50),
  name              text not null check (char_length(name) between 1 and 300),
  description       text,
  kind              public.catalog_item_kind not null default 'material',
  unit              public.catalog_item_unit not null default 'ea',
  unit_cost_cents   integer not null default 0 check (unit_cost_cents >= 0),
  default_markup_bp integer not null default 0 check (default_markup_bp >= 0 and default_markup_bp <= 50000),
  taxable           boolean not null default true,
  active            boolean not null default true,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  deleted_at        timestamptz,
  deleted_by        uuid references auth.users(id)
);

-- Code must be unique within a company (active or archived — prevents confusion)
create unique index catalog_item_company_code_idx
  on public.catalog_item (company_id, code)
  where deleted_at is null;

create index catalog_item_company_id_idx on public.catalog_item (company_id);
create index catalog_item_company_active_idx
  on public.catalog_item (company_id, active)
  where deleted_at is null;

-- Full-text search on code + name for catalog search
create index catalog_item_search_idx
  on public.catalog_item using gin (
    to_tsvector('english', coalesce(code, '') || ' ' || coalesce(name, ''))
  );

alter table public.catalog_item enable row level security;

create policy "catalog_item: members can read company items"
  on public.catalog_item for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "catalog_item: members can insert company items"
  on public.catalog_item for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "catalog_item: members can update company items"
  on public.catalog_item for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

create trigger catalog_item_updated_at
  before update on public.catalog_item
  for each row execute function public.set_updated_at();

-- ─── catalog_item_price_history ──────────────────────────────────────────────
-- Append-only log of price changes. When unit_cost_cents changes on a catalog_item,
-- a trigger records the old and new price with attribution.
create table public.catalog_item_price_history (
  id              uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.catalog_item(id) on delete cascade,
  company_id      uuid not null references public.company(id) on delete restrict,
  old_price_cents integer not null,
  new_price_cents integer not null,
  changed_at      timestamptz not null default now(),
  changed_by      uuid references auth.users(id)
);

create index catalog_item_price_history_item_idx
  on public.catalog_item_price_history (catalog_item_id, changed_at desc);

create index catalog_item_price_history_company_idx
  on public.catalog_item_price_history (company_id);

alter table public.catalog_item_price_history enable row level security;

create policy "catalog_item_price_history: members can read company history"
  on public.catalog_item_price_history for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

-- Insert allowed for the trigger (runs as table owner, not authenticated user)
-- but also for service-role calls. No user-facing insert policy needed since
-- inserts come from the trigger or server-side API.
create policy "catalog_item_price_history: members can insert company history"
  on public.catalog_item_price_history for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

-- ─── price history trigger ───────────────────────────────────────────────────
-- Fires on UPDATE of catalog_item when unit_cost_cents changes.
create or replace function public.log_catalog_price_change()
returns trigger as $$
begin
  if OLD.unit_cost_cents is distinct from NEW.unit_cost_cents then
    insert into public.catalog_item_price_history (
      catalog_item_id, company_id, old_price_cents, new_price_cents, changed_by
    ) values (
      NEW.id, NEW.company_id, OLD.unit_cost_cents, NEW.unit_cost_cents,
      auth.uid()
    );
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

create trigger catalog_item_price_change
  after update on public.catalog_item
  for each row execute function public.log_catalog_price_change();
