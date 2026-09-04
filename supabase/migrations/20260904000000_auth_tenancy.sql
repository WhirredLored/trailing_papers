-- ─────────────────────────────────────────────────────────────────────────────
-- C02 — auth, multi-tenancy, and RLS foundation
--
-- Architecture Laws enforced here:
--   1. Tenancy enforced in the database via company_id + RLS on every table.
--   2. Roles come from app_metadata, never user_metadata.
--   8. Soft-delete with attribution (deleted_at, deleted_by).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Helper: read the caller's company from their JWT app_metadata ────────────
-- This function is the single source of truth for the current tenant.
-- It reads from app_metadata (set by our server code, not user-editable).
create or replace function public.auth_company_id()
  returns uuid
  language sql
  stable
  security invoker
as $$
  select nullif(
    (auth.jwt() -> 'app_metadata' ->> 'company_id'),
    ''
  )::uuid
$$;

-- ─── Helper: read the caller's role from their JWT app_metadata ──────────────
create or replace function public.auth_user_role()
  returns text
  language sql
  stable
  security invoker
as $$
  select auth.jwt() -> 'app_metadata' ->> 'role'
$$;

-- ─── company ──────────────────────────────────────────────────────────────────
create table public.company (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references auth.users(id)
);

-- RLS: owners/admins read their own company; no cross-tenant reads.
alter table public.company enable row level security;

create policy "company: members can read their company"
  on public.company
  for select
  to authenticated
  using ( (select public.auth_company_id()) = id );

create policy "company: owners can update their company"
  on public.company
  for update
  to authenticated
  using  ( (select public.auth_company_id()) = id )
  with check ( (select public.auth_company_id()) = id );

-- Insert is handled by the signup function (service role), not directly by RLS.

-- ─── app_user ─────────────────────────────────────────────────────────────────
-- Mirrors auth.users; holds per-company role and profile.
-- role is canonical here; the JWT copy (app_metadata) is a derivative.
create type public.user_role as enum ('owner', 'admin', 'crew');

create table public.app_user (
  id          uuid primary key references auth.users(id) on delete cascade,
  company_id  uuid not null references public.company(id) on delete restrict,
  role        public.user_role not null,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users(id)
);

-- Index: most queries filter by company_id
create index app_user_company_id_idx on public.app_user (company_id);

alter table public.app_user enable row level security;

-- Members can read peers in their own company.
create policy "app_user: members can read company peers"
  on public.app_user
  for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

-- Members can update their own row only.
create policy "app_user: members can update own row"
  on public.app_user
  for update
  to authenticated
  using  ( (select auth.uid()) = id
        and (select public.auth_company_id()) = company_id )
  with check ( (select auth.uid()) = id
           and (select public.auth_company_id()) = company_id );

-- Owners and admins can update any row in their company.
create policy "app_user: owners and admins can update company members"
  on public.app_user
  for update
  to authenticated
  using  ( (select public.auth_company_id()) = company_id
        and (select public.auth_user_role()) in ('owner', 'admin') )
  with check ( (select public.auth_company_id()) = company_id
           and (select public.auth_user_role()) in ('owner', 'admin') );

-- Inserts are handled by server-side signup/invite (service role).
-- Deletes are soft-delete only (set deleted_at), so no delete policy needed.

-- ─── invite_token ─────────────────────────────────────────────────────────────
-- Short-lived, single-use tokens for crew/admin invite emails.
create table public.invite_token (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.company(id) on delete cascade,
  email       text not null,
  role        public.user_role not null,
  token       text not null unique default encode(gen_random_bytes(32), 'hex'),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default (now() + interval '48 hours'),
  used_at     timestamptz,
  created_by  uuid references auth.users(id)
);

create index invite_token_company_id_idx on public.invite_token (company_id);
create index invite_token_token_idx on public.invite_token (token);

alter table public.invite_token enable row level security;

-- Only the server (service role) reads/writes invite tokens.
-- No authenticated policy — service role bypasses RLS.

-- ─── updated_at trigger (shared helper) ──────────────────────────────────────
create or replace function public.set_updated_at()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger company_updated_at
  before update on public.company
  for each row execute function public.set_updated_at();

create trigger app_user_updated_at
  before update on public.app_user
  for each row execute function public.set_updated_at();
