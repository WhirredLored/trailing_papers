-- ─────────────────────────────────────────────────────────────────────────────
-- C03 — company profile, branding, and license/insurance tracking
-- ─────────────────────────────────────────────────────────────────────────────

-- Extend company with full profile fields.
alter table public.company
  add column if not exists legal_name         text,
  add column if not exists dba                text,
  add column if not exists address_line1      text,
  add column if not exists address_line2      text,
  add column if not exists city               text,
  add column if not exists state              text,
  add column if not exists zip                text,
  add column if not exists phone              text,
  add column if not exists email              text,
  add column if not exists website            text,
  add column if not exists tax_id             text,
  -- Default tax rate stored as integer basis points (e.g. 875 = 8.75%)
  add column if not exists default_tax_bp     integer not null default 0 check (default_tax_bp >= 0 and default_tax_bp <= 10000),
  -- Default payment terms in days
  add column if not exists payment_terms_days integer not null default 30 check (payment_terms_days >= 0),
  -- Deposit policy: percent (0–100) or fixed cents. Exactly one is set.
  add column if not exists deposit_pct        integer check (deposit_pct between 0 and 100),
  add column if not exists deposit_fixed_cents integer check (deposit_fixed_cents >= 0),
  -- Currency: USD only in v1
  add column if not exists currency           text not null default 'USD',
  -- License
  add column if not exists license_number     text,
  add column if not exists license_expires_at date,
  -- Insurance
  add column if not exists insurance_carrier  text,
  add column if not exists insurance_policy   text,
  add column if not exists insurance_expires_at date,
  -- Logo: Storage object path (company-scoped)
  add column if not exists logo_path          text;

-- Constraint: deposit policy is either percent OR fixed, not both.
alter table public.company
  add constraint deposit_policy_exclusive
    check (
      (deposit_pct is null) or (deposit_fixed_cents is null)
    );

-- ─── Storage bucket for company logos ────────────────────────────────────────
-- Creates the bucket if it doesn't exist. Storage buckets are managed via the
-- Supabase Storage API, not SQL — but we set up the RLS policies here.
-- The bucket itself must be created in the Supabase dashboard or via Storage API.
-- Bucket name: company-assets (private; URLs are signed)

-- Storage RLS: owner/admin of the company may read/write their scoped prefix.
-- Paths are: <company_id>/logo.<ext>
-- Note: Storage policies live in storage.objects and use the storage schema.
create policy "company-assets: company members can read their logo"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'company-assets'
    and (storage.foldername(name))[1] = (select public.auth_company_id())::text
  );

create policy "company-assets: owners and admins can upload logo"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'company-assets'
    and (storage.foldername(name))[1] = (select public.auth_company_id())::text
    and (select public.auth_user_role()) in ('owner', 'admin')
  );

create policy "company-assets: owners and admins can update logo"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'company-assets'
    and (storage.foldername(name))[1] = (select public.auth_company_id())::text
    and (select public.auth_user_role()) in ('owner', 'admin')
  )
  with check (
    bucket_id = 'company-assets'
    and (storage.foldername(name))[1] = (select public.auth_company_id())::text
    and (select public.auth_user_role()) in ('owner', 'admin')
  );

create policy "company-assets: owners and admins can delete logo"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'company-assets'
    and (storage.foldername(name))[1] = (select public.auth_company_id())::text
    and (select public.auth_user_role()) in ('owner', 'admin')
  );
