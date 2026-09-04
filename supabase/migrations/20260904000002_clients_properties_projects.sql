-- ─────────────────────────────────────────────────────────────────────────────
-- C04 — clients, properties, and projects
-- Every table follows the C02 tenancy template:
--   company_id + RLS (select, insert, update) + soft-delete + updated_at trigger
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── client ──────────────────────────────────────────────────────────────────
create table public.client (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.company(id) on delete restrict,
  name             text not null check (char_length(name) between 1 and 200),
  company_name     text,
  emails           text[] not null default '{}',
  phones           text[] not null default '{}',
  billing_address  text,
  notes            text,
  referral_source  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  deleted_at       timestamptz,
  deleted_by       uuid references auth.users(id)
);

create index client_company_id_idx on public.client (company_id);
-- Full-text search index for duplicate guard and search.
create index client_name_search_idx on public.client using gin (to_tsvector('english', name));

alter table public.client enable row level security;

create policy "client: members can read company clients"
  on public.client for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "client: members can insert company clients"
  on public.client for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "client: members can update company clients"
  on public.client for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

create trigger client_updated_at
  before update on public.client
  for each row execute function public.set_updated_at();

-- ─── property ─────────────────────────────────────────────────────────────────
create table public.property (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete restrict,
  client_id     uuid not null references public.client(id) on delete restrict,
  address_line1 text not null,
  address_line2 text,
  city          text,
  state         text,
  zip           text,
  unit_lot      text,
  access_notes  text,   -- gate codes, dogs, parking instructions
  year_built    integer check (year_built > 1800 and year_built <= extract(year from now()) + 1),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  deleted_at    timestamptz,
  deleted_by    uuid references auth.users(id)
);

create index property_company_id_idx on public.property (company_id);
create index property_client_id_idx on public.property (client_id);

alter table public.property enable row level security;

create policy "property: members can read company properties"
  on public.property for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "property: members can insert company properties"
  on public.property for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "property: members can update company properties"
  on public.property for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

create trigger property_updated_at
  before update on public.property
  for each row execute function public.set_updated_at();

-- ─── project ──────────────────────────────────────────────────────────────────
create type public.project_status as enum (
  'lead', 'estimating', 'approved', 'scheduled',
  'in_progress', 'complete', 'closed', 'lost'
);

create table public.project (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.company(id) on delete restrict,
  property_id    uuid not null references public.property(id) on delete restrict,
  title          text not null check (char_length(title) between 1 and 300),
  status         public.project_status not null default 'lead',
  scope_summary  text,
  start_date     date,
  target_date    date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  deleted_at     timestamptz,
  deleted_by     uuid references auth.users(id)
);

create index project_company_id_idx on public.project (company_id);
create index project_property_id_idx on public.project (property_id);
create index project_status_idx on public.project (company_id, status) where deleted_at is null;

alter table public.project enable row level security;

create policy "project: members can read company projects"
  on public.project for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "project: members can insert company projects"
  on public.project for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "project: members can update company projects"
  on public.project for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id )
  with check ( (select public.auth_company_id()) = company_id );

create trigger project_updated_at
  before update on public.project
  for each row execute function public.set_updated_at();

-- ─── project_user (assigned team members) ────────────────────────────────────
create table public.project_user (
  project_id  uuid not null references public.project(id) on delete cascade,
  user_id     uuid not null references public.app_user(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create index project_user_company_id_idx on public.project_user (company_id);

alter table public.project_user enable row level security;

create policy "project_user: members can read company assignments"
  on public.project_user for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create policy "project_user: members can insert assignments"
  on public.project_user for insert
  to authenticated
  with check ( (select public.auth_company_id()) = company_id );

create policy "project_user: members can delete assignments"
  on public.project_user for delete
  to authenticated
  using ( (select public.auth_company_id()) = company_id );
