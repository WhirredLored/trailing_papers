-- ─────────────────────────────────────────────────────────────────────────────
-- C07 — assemblies and assembly components (material takeoff recipes)
-- Follows the C02 tenancy template:
--   company_id + RLS (select, insert, update) + soft-delete + updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── driver unit enum ────────────────────────────────────────────────────────
create type public.assembly_driver_unit as enum (
  'sq_ft', 'lin_ft', 'ea', 'sq', 'opening'
);

-- ─── rounding rule enum ──────────────────────────────────────────────────────
create type public.rounding_rule as enum (
  'exact', 'up_to_unit', 'up_to_package'
);

-- ─── assembly ────────────────────────────────────────────────────────────────
create table public.assembly (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete restrict,
  name         text not null check (char_length(name) between 1 and 300),
  description  text,
  driver_unit  public.assembly_driver_unit not null default 'sq_ft',
  notes        text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users(id)
);

create index assembly_company_id_idx on public.assembly (company_id);
create index assembly_company_active_idx
  on public.assembly (company_id, active)
  where deleted_at is null;

alter table public.assembly enable row level security;

create policy "assembly: members can read company assemblies"
  on public.assembly for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "assembly: members can insert company assemblies"
  on public.assembly for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "assembly: members can update company assemblies"
  on public.assembly for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

create trigger assembly_updated_at
  before update on public.assembly
  for each row execute function public.set_updated_at();

-- ─── assembly_component ──────────────────────────────────────────────────────
-- Each row is one ingredient in the assembly recipe. The combination of
-- assembly_id + catalog_item_id is the natural key (a component can only
-- appear once per assembly).
create table public.assembly_component (
  id                   uuid primary key default gen_random_uuid(),
  assembly_id          uuid not null references public.assembly(id) on delete cascade,
  company_id           uuid not null references public.company(id) on delete restrict,
  catalog_item_id      uuid not null references public.catalog_item(id) on delete restrict,
  quantity_per_driver  numeric(12,4) not null check (quantity_per_driver > 0),
  waste_percent_bp     integer not null default 0 check (waste_percent_bp >= 0 and waste_percent_bp <= 10000),
  rounding_rule        public.rounding_rule not null default 'up_to_unit',
  package_size         numeric(12,4) not null default 1 check (package_size > 0),
  sort_order           integer not null default 0,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id)
);

-- A catalog item can only appear once per assembly
create unique index assembly_component_assembly_item_idx
  on public.assembly_component (assembly_id, catalog_item_id);

create index assembly_component_assembly_id_idx
  on public.assembly_component (assembly_id);

create index assembly_component_catalog_item_id_idx
  on public.assembly_component (catalog_item_id);

create index assembly_component_company_id_idx
  on public.assembly_component (company_id);

alter table public.assembly_component enable row level security;

create policy "assembly_component: members can read company components"
  on public.assembly_component for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "assembly_component: members can insert company components"
  on public.assembly_component for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "assembly_component: members can update company components"
  on public.assembly_component for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

-- Allow delete so components can be replaced when editing an assembly
create policy "assembly_component: members can delete company components"
  on public.assembly_component for delete
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create trigger assembly_component_updated_at
  before update on public.assembly_component
  for each row execute function public.set_updated_at();
