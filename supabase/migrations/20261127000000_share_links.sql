-- ══════════════════════════════════════════════════════════════════════════════
-- C10: shareable client-facing documents (share_link & share_link_access)
-- ══════════════════════════════════════════════════════════════════════════════

create table public.share_link (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.company(id) on delete restrict,
  document_id    uuid not null references public.document(id) on delete restrict,
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id),
  expires_at     timestamptz not null default (now() + interval '30 days'),
  revoked_at     timestamptz,
  revoked_by     uuid references auth.users(id),
  view_count     integer not null default 0,
  last_viewed_at timestamptz,

  constraint share_link_token_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint share_link_view_count_check check (view_count >= 0),
  constraint share_link_revoked_by_needs_revoked_at check (
    revoked_by is null or revoked_at is not null
  )
);

create index share_link_company_id_idx on public.share_link (company_id);
create index share_link_document_id_idx on public.share_link (company_id, document_id);

create table public.share_link_access (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.company(id) on delete restrict,
  share_link_id uuid not null references public.share_link(id) on delete restrict,
  viewed_at     timestamptz not null default now(),
  ip            inet,
  user_agent    text,
  referer       text,

  constraint share_link_access_user_agent_check check (
    user_agent is null or char_length(user_agent) <= 1000
  ),
  constraint share_link_access_referer_check check (
    referer is null or char_length(referer) <= 2000
  )
);

create index share_link_access_company_id_idx on public.share_link_access (company_id);
create index share_link_access_link_idx on public.share_link_access (share_link_id, viewed_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

alter table public.share_link enable row level security;
alter table public.share_link_access enable row level security;

create policy "share_link: members can read their company links"
  on public.share_link
  for select
  to authenticated
  using ((select auth_company_id()) = company_id);

create policy "share_link_access: members can read their company log"
  on public.share_link_access
  for select
  to authenticated
  using ((select auth_company_id()) = company_id);

-- ─── Guards ──────────────────────────────────────────────────────────────────

create or replace function public.share_link_guard()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('papertrail.purging', true), '') = OLD.id::text then
      return OLD;
    end if;
    raise exception
      'Share link % cannot be deleted; revoke it instead (Law 8). To purge a row that must truly go, use purge_share_link().',
      OLD.id
      using errcode = '42501';
  end if;

  if NEW.company_id  is distinct from OLD.company_id
  or NEW.document_id is distinct from OLD.document_id
  or NEW.token_hash  is distinct from OLD.token_hash
  or NEW.created_at  is distinct from OLD.created_at
  or NEW.created_by  is distinct from OLD.created_by
  then
    raise exception 'Share link % identity is immutable; create a new link instead.', OLD.id
      using errcode = '42501';
  end if;

  if OLD.revoked_at is not null and NEW.revoked_at is distinct from OLD.revoked_at then
    raise exception 'Share link % was revoked at %; revocation is final.', OLD.id, OLD.revoked_at
      using errcode = '42501';
  end if;

  -- A count only ever goes up.
  if NEW.view_count < OLD.view_count then
    raise exception 'Share link % view_count cannot decrease.', OLD.id
      using errcode = '42501';
  end if;

  return NEW;
end;
$$;

create trigger share_link_guard
  before update or delete on public.share_link
  for each row execute function public.share_link_guard();

create or replace function public.share_link_access_guard()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    if coalesce(current_setting('papertrail.purging', true), '') = OLD.share_link_id::text then
      return OLD;
    end if;
    raise exception
      'Access record % is evidence and cannot be deleted (Law 8).', OLD.id
      using errcode = '42501';
  end if;

  raise exception 'Access record % is immutable (Law 8).', OLD.id
    using errcode = '42501';
end;
$$;

create trigger share_link_access_guard
  before update or delete on public.share_link_access
  for each row execute function public.share_link_access_guard();

-- ─── RPC functions ───────────────────────────────────────────────────────────

create or replace function public.record_share_link_view(
  p_token_hash text,
  p_ip inet,
  p_user_agent text,
  p_referer text
)
returns table(status text, share_link_id uuid, document_id uuid, company_id uuid)
language plpgsql
as $$
#variable_conflict use_column
declare
  v_link public.share_link;
begin
  select * into v_link
  from public.share_link sl
  where sl.token_hash = p_token_hash;

  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if v_link.revoked_at is not null then
    return query select 'revoked'::text, v_link.id, null::uuid, v_link.company_id;
    return;
  end if;

  if v_link.expires_at <= now() then
    return query select 'expired'::text, v_link.id, null::uuid, v_link.company_id;
    return;
  end if;

  update public.share_link
  set view_count = view_count + 1,
      last_viewed_at = now()
  where id = v_link.id;

  insert into public.share_link_access (company_id, share_link_id, ip, user_agent, referer)
  values (
    v_link.company_id,
    v_link.id,
    p_ip,
    left(p_user_agent, 1000),
    left(p_referer, 2000)
  );

  return query select 'active'::text, v_link.id, v_link.document_id, v_link.company_id;
end;
$$;

create or replace function public.purge_share_link(p_share_link_id uuid)
returns integer
language plpgsql
as $$
declare
  v_purged integer;
begin
  perform set_config('papertrail.purging', p_share_link_id::text, true);

  delete from public.share_link_access where share_link_id = p_share_link_id;
  delete from public.share_link where id = p_share_link_id;
  get diagnostics v_purged = row_count;

  perform set_config('papertrail.purging', '', true);
  return v_purged;
end;
$$;
