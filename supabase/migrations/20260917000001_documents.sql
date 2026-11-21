-- ─────────────────────────────────────────────────────────────────────────────
-- C09 — documents: the frozen PDF record, its hash, and atomic numbering
--
-- A `document` row is the evidence that a particular issued version was rendered
-- to a particular set of bytes. It carries the sha256 of those bytes, which is
-- what makes tamper-evidence provable later (Law 3 / Law 8): re-render the same
-- issued version, hash it, compare. Generation is deterministic, so a mismatch
-- means the stored file changed, not that the renderer drifted.
--
-- Nothing here is editable after the fact. The row is written once by
-- record_document() and then frozen by trigger, the same way an issued estimate
-- is — a correction is a new version or a credit note, never a mutation.
-- ─────────────────────────────────────────────────────────────────────────────

create type public.document_kind as enum (
  'estimate', 'change_order', 'invoice', 'signed_copy', 'receipt'
);

-- ─── numbering ───────────────────────────────────────────────────────────────
-- One counter per company per kind. Contractors read these numbers aloud to
-- clients and write them on cheques, so a collision is not a cosmetic bug.
--
-- last_value is the highest number ever handed out, never decremented. A number
-- is therefore never reissued even when the document it belonged to is voided:
-- voiding is a status change on the document, and this counter does not care.
create table public.document_counter (
  company_id uuid not null references public.company(id) on delete restrict,
  kind       public.document_kind not null,
  last_value integer not null default 0 check (last_value >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, kind)
);

alter table public.document_counter enable row level security;

-- Readable by the tenant (a settings screen may want to show the next number),
-- but never writable through RLS: allocation only happens inside
-- allocate_document_number(), which is the only thing that keeps it atomic.
create policy "document_counter: members can read their counters"
  on public.document_counter for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

create trigger document_counter_updated_at
  before update on public.document_counter
  for each row execute function public.set_updated_at();

-- The human-facing number. Kept in SQL so the database is the single authority
-- on what EST-0001 means; the app renders whatever this returns.
create or replace function public.document_number_text(
  p_kind   public.document_kind,
  p_number integer
) returns text
  language sql
  immutable
as $$
  select case p_kind
           when 'estimate'      then 'EST'
           when 'change_order'  then 'CO'
           when 'invoice'       then 'INV'
           when 'signed_copy'   then 'SIG'
           when 'receipt'       then 'RCP'
         end || '-' ||
         -- Zero-pad to four, but NEVER truncate: lpad('10000', 4, '0') is '1000',
         -- which would print the ten-thousandth document with the thousandth's
         -- number. The width floor is 4, not a ceiling.
         lpad(p_number::text, greatest(4, length(p_number::text)), '0')
$$;

-- Allocate the next number for (company, kind), atomically.
--
-- INSERT ... ON CONFLICT DO UPDATE takes a row lock, so two concurrent callers
-- serialize on it: the second blocks until the first commits and then reads the
-- committed value, rather than both computing the same next number from a stale
-- read. This is the whole reason numbering is not a `select max(number) + 1`.
--
-- A rolled-back caller leaves a gap rather than a duplicate, which is the right
-- way round: a missing EST-0007 is a question, a second EST-0006 is a dispute.
create or replace function public.allocate_document_number(
  p_company_id uuid,
  p_kind       public.document_kind
) returns integer
  language plpgsql
  security definer
  set search_path = public
as $fn$
declare
  v_number integer;
begin
  insert into public.document_counter (company_id, kind, last_value)
  values (p_company_id, p_kind, 1)
  on conflict (company_id, kind) do update
    set last_value = public.document_counter.last_value + 1
  returning last_value into v_number;

  return v_number;
end;
$fn$;

-- ─── the document record ─────────────────────────────────────────────────────
create table public.document (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.company(id) on delete restrict,

  kind         public.document_kind not null,

  -- The entity this document renders. Deliberately not a foreign key: the target
  -- table depends on kind (estimate today, change_order and invoice in C12/C13),
  -- and Postgres has no polymorphic reference. Integrity comes from
  -- record_document(), which is the only writer, plus the uniqueness below.
  related_id   uuid not null,
  version      integer not null check (version >= 1),

  number       integer not null check (number >= 1),
  number_text  text not null check (char_length(number_text) between 3 and 40),

  storage_path text not null check (char_length(storage_path) between 1 and 500),
  -- Lowercase hex sha256 of the exact bytes at storage_path.
  sha256       text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size    integer not null check (byte_size > 0),

  generated_at timestamptz not null default now(),
  generated_by uuid references auth.users(id),

  created_at   timestamptz not null default now(),

  -- No updated_at and no deleted_at on purpose: this row never changes and is
  -- never soft-deleted. The freeze trigger below enforces both.

  -- A number identifies exactly one document within a company.
  constraint document_number_unique unique (company_id, kind, number),
  -- And an issued version has exactly one document, which is what makes
  -- generation idempotent: the second attempt collides here instead of
  -- producing a second PDF of the same frozen content.
  constraint document_version_unique unique (company_id, kind, related_id, version)
);

create index document_related_idx on public.document (company_id, related_id);
create index document_company_kind_number_idx on public.document (company_id, kind, number desc);

alter table public.document enable row level security;

create policy "document: members can read their company documents"
  on public.document for select
  to authenticated
  using ( (select public.auth_company_id()) = company_id );

-- No insert, update or delete policy. Documents are written by record_document()
-- through the server, never by a browser holding an anon key.

-- Immutability (Law 3). The row is the evidence; evidence that can be edited is
-- not evidence.
create or replace function public.document_freeze()
returns trigger
language plpgsql
as $fn$
begin
  if TG_OP = 'DELETE' then
    raise exception
      'Document % (%) cannot be deleted. Audit, do not delete (Law 8).',
      OLD.id, OLD.number_text
      using errcode = '42501';
  end if;

  raise exception
    'Document % (%) is immutable (Law 3). Generate a new version instead of editing the record.',
    OLD.id, OLD.number_text
    using errcode = '42501';
end;
$fn$;

create trigger document_freeze
  before update or delete on public.document
  for each row execute function public.document_freeze();

-- The forward reference C08 left open: estimate.pdf_document_id exists already,
-- and only now is there a table for it to point at.
alter table public.estimate
  add constraint estimate_pdf_document_fkey
  foreign key (pdf_document_id) references public.document(id) on delete restrict;

-- Write the document row and link it to what it renders, in one transaction.
--
-- The number must already be allocated, because it is printed ON the PDF: the
-- caller allocates, renders, hashes, uploads, then records. That ordering is why
-- allocation and recording are two functions rather than one.
create or replace function public.record_document(
  p_company_id   uuid,
  p_kind         public.document_kind,
  p_related_id   uuid,
  p_version      integer,
  p_number       integer,
  p_storage_path text,
  p_sha256       text,
  p_byte_size    integer,
  -- Nullable, with a default, because generated_by is: a document may be
  -- produced by a scheduled job with no staff member behind it.
  p_actor        uuid default null
) returns public.document
  language plpgsql
  security definer
  set search_path = public
as $fn$
declare
  v_document public.document;
begin
  insert into public.document (
    company_id, kind, related_id, version, number, number_text,
    storage_path, sha256, byte_size, generated_by
  ) values (
    p_company_id, p_kind, p_related_id, p_version, p_number,
    public.document_number_text(p_kind, p_number),
    p_storage_path, p_sha256, p_byte_size, p_actor
  )
  returning * into v_document;

  -- An estimate's snapshot pointer is write-once; the estimate freeze trigger
  -- refuses a second one. The `is null` guard keeps this a no-op rather than an
  -- error when a pointer somehow already stands.
  if p_kind = 'estimate' then
    update public.estimate
    set pdf_document_id = v_document.id
    where id = p_related_id
      and company_id = p_company_id
      and pdf_document_id is null;
  end if;

  return v_document;
end;
$fn$;

-- ─── storage policies for the documents bucket ───────────────────────────────
-- Paths are <company_id>/<kind>/<number_text>-v<version>.pdf, so the first path
-- segment is the tenancy boundary, exactly as C03 does for company-assets.
--
-- Read only, and only for the tenant. There is deliberately no insert, update or
-- delete policy: PDFs are written by the generator through the service-role key,
-- so no browser session can put a file in this bucket or replace one. C10 adds
-- public token access for clients, which does not go through these policies.
create policy "documents: company members can read their documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select public.auth_company_id())::text
  );
