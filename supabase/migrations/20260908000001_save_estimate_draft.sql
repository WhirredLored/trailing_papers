-- ─────────────────────────────────────────────────────────────────────────────
-- C08 — atomic draft save
--
-- Saving the builder is a read-then-write: check the estimate is still a draft,
-- replace its lines, and write the recomputed totals. Law 5 says that belongs in
-- one locked function, not in three REST calls — a phone that loses signal
-- between the delete and the insert would otherwise leave the contractor with an
-- estimate that has lost its lines.
--
-- Totals arrive already computed by lib/totals.ts from the lines in this same
-- payload, so the stored snapshot always matches the stored lines, and nothing
-- the client claimed about the money is taken on trust (Law 4).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.save_estimate_draft(
  p_estimate_id uuid,
  p_company_id  uuid,
  p_header      jsonb,
  p_lines       jsonb,
  p_totals      jsonb,
  p_profit      jsonb,
  p_actor       uuid
) returns public.estimate
language plpgsql
as $fn$
declare
  v_estimate public.estimate;
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

  -- The line trigger would refuse the writes below anyway; failing here gives
  -- the caller the reason rather than a trigger message about one line.
  if v_estimate.status <> 'draft' then
    raise exception
      'Estimate % (v%) is % and cannot be edited (Law 3). Create a revision instead.',
      p_estimate_id, v_estimate.version, v_estimate.status
      using errcode = '42501';
  end if;

  update public.estimate set
    title                  = nullif(p_header ->> 'title', ''),
    pricing_mode           = coalesce((p_header ->> 'pricing_mode')::public.estimate_pricing_mode,
                                      v_estimate.pricing_mode),
    pricing_bp             = coalesce((p_header ->> 'pricing_bp')::integer, v_estimate.pricing_bp),
    terms                  = nullif(p_header ->> 'terms', ''),
    notes_to_client        = nullif(p_header ->> 'notes_to_client', ''),
    internal_notes         = nullif(p_header ->> 'internal_notes', ''),
    tax_rate_bp            = coalesce((p_header ->> 'tax_rate_bp')::integer, v_estimate.tax_rate_bp),
    discount_mode          = coalesce((p_header ->> 'discount_mode')::public.amount_mode,
                                      v_estimate.discount_mode),
    discount_value         = coalesce((p_header ->> 'discount_value')::integer,
                                      v_estimate.discount_value),
    deposit_mode           = coalesce((p_header ->> 'deposit_mode')::public.amount_mode,
                                      v_estimate.deposit_mode),
    deposit_value          = coalesce((p_header ->> 'deposit_value')::integer,
                                      v_estimate.deposit_value),
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

  delete from public.estimate_line where estimate_id = p_estimate_id;

  -- Order is taken from the array itself, so the sort_order stored always
  -- matches the order the contractor dragged the lines into.
  insert into public.estimate_line (
    estimate_id, company_id, sort_order, kind, catalog_item_id, assembly_id,
    driver_quantity, assembly_group_id, description, quantity, unit,
    unit_price_cents, unit_cost_cents, taxable, is_optional, is_selected,
    group_label, derivation, created_by
  )
  select
    p_estimate_id,
    p_company_id,
    (ord - 1)::integer,
    coalesce((elem ->> 'kind')::public.catalog_item_kind, 'material'),
    nullif(elem ->> 'catalog_item_id', '')::uuid,
    nullif(elem ->> 'assembly_id', '')::uuid,
    nullif(elem ->> 'driver_quantity', '')::numeric,
    nullif(elem ->> 'assembly_group_id', '')::uuid,
    elem ->> 'description',
    coalesce((elem ->> 'quantity')::numeric, 0),
    coalesce((elem ->> 'unit')::public.catalog_item_unit, 'ea'),
    coalesce((elem ->> 'unit_price_cents')::integer, 0),
    coalesce((elem ->> 'unit_cost_cents')::integer, 0),
    coalesce((elem ->> 'taxable')::boolean, true),
    coalesce((elem ->> 'is_optional')::boolean, false),
    coalesce((elem ->> 'is_selected')::boolean, false),
    nullif(elem ->> 'group_label', ''),
    nullif(elem ->> 'derivation', ''),
    p_actor
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(elem, ord);

  return v_estimate;
end;
$fn$;
