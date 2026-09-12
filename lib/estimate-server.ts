/**
 * Server-side glue between the estimate API routes and the pure engine.
 *
 * The routes never trust a total the client sends (Law 4). They take the LINES,
 * run them through lib/estimate.ts — the same engine the builder runs in the
 * browser — and hand the result to the database function that freezes it. This
 * module holds the validation and the row/draft mapping so issue, revise and
 * save all agree on the shapes.
 */

import type { Json, Tables } from '@/types/db'
import {
  computeEstimateTotals,
  computeProfitability,
  type EstimateLineDraft,
  type EstimateLineKind,
  type EstimateLineUnit,
  type EstimateTerms,
  type Profitability,
  type EstimateTotals,
} from './estimate'

export const LINE_KINDS: EstimateLineKind[] = [
  'labor',
  'material',
  'equipment',
  'subcontract',
  'other',
]

export const LINE_UNITS: EstimateLineUnit[] = [
  'ea',
  'sq_ft',
  'lin_ft',
  'sq',
  'hour',
  'day',
  'load',
]

/**
 * A line as it crosses the wire and as save_estimate_draft() expects it:
 * database column names, so there is no third naming convention to keep
 * straight between the browser, the route and the SQL.
 */
export interface EstimateLinePayload {
  kind: EstimateLineKind
  catalog_item_id: string | null
  assembly_id: string | null
  driver_quantity: number | null
  assembly_group_id: string | null
  description: string
  quantity: number
  unit: EstimateLineUnit
  unit_price_cents: number
  unit_cost_cents: number
  taxable: boolean
  is_optional: boolean
  is_selected: boolean
  group_label: string | null
  derivation: string | null
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

/** A stored line, as the pure engine wants it. */
export function rowToDraft(row: Tables<'estimate_line'>): EstimateLineDraft {
  return {
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    kind: row.kind,
    unitPriceCents: row.unit_price_cents,
    unitCostCents: row.unit_cost_cents,
    taxable: row.taxable,
    isOptional: row.is_optional,
    isSelected: row.is_selected,
    groupLabel: row.group_label,
    catalogItemId: row.catalog_item_id,
    assemblyId: row.assembly_id,
    driverQuantity: row.driver_quantity === null ? null : Number(row.driver_quantity),
    assemblyGroupId: row.assembly_group_id,
    derivation: row.derivation,
  }
}

/** A validated payload line, as the pure engine wants it. */
export function payloadToDraft(line: EstimateLinePayload): EstimateLineDraft {
  return {
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    kind: line.kind,
    unitPriceCents: line.unit_price_cents,
    unitCostCents: line.unit_cost_cents,
    taxable: line.taxable,
    isOptional: line.is_optional,
    isSelected: line.is_selected,
    groupLabel: line.group_label,
  }
}

/** The money terms carried on the estimate row. */
export function termsOf(estimate: Tables<'estimate'>): EstimateTerms {
  return {
    taxRateBp: estimate.tax_rate_bp,
    discountMode: estimate.discount_mode,
    discountValue: estimate.discount_value,
    depositMode: estimate.deposit_mode,
    depositValue: estimate.deposit_value,
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type ParseResult =
  | { ok: true; lines: EstimateLinePayload[] }
  | { ok: false; error: string }

function asFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function asIntegerCents(value: unknown): number | null {
  const n = asFiniteNumber(value)
  // Law 4: money crosses the wire as integer cents. A float here is a bug in the
  // caller, not something to round away quietly.
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null
}

function asUuidOrNull(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : undefined
}

/**
 * Validate the line array a client submitted.
 *
 * Everything that reaches the database is checked here: a bad enum, a float
 * where cents belong, a negative quantity, or an assembly line with no driver
 * quantity is a 400, not a constraint violation with a Postgres error message.
 */
export function parseLines(input: unknown): ParseResult {
  if (!Array.isArray(input)) {
    return { ok: false, error: 'lines must be an array.' }
  }

  const lines: EstimateLinePayload[] = []

  for (let i = 0; i < input.length; i++) {
    const raw = input[i] as Record<string, unknown>
    const at = `Line ${i + 1}`

    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `${at}: not an object.` }
    }

    const description = typeof raw['description'] === 'string' ? raw['description'].trim() : ''
    if (description === '' || description.length > 500) {
      return { ok: false, error: `${at}: description is required (max 500 characters).` }
    }

    const kind = (raw['kind'] ?? 'material') as EstimateLineKind
    if (!LINE_KINDS.includes(kind)) {
      return { ok: false, error: `${at}: kind must be one of ${LINE_KINDS.join(', ')}.` }
    }

    const unit = (raw['unit'] ?? 'ea') as EstimateLineUnit
    if (!LINE_UNITS.includes(unit)) {
      return { ok: false, error: `${at}: unit must be one of ${LINE_UNITS.join(', ')}.` }
    }

    const quantity = asFiniteNumber(raw['quantity'])
    if (quantity === null || quantity < 0) {
      return { ok: false, error: `${at}: quantity must be a non-negative number.` }
    }

    const unitPriceCents = asIntegerCents(raw['unit_price_cents'])
    if (unitPriceCents === null) {
      return { ok: false, error: `${at}: unit_price_cents must be a non-negative integer (cents).` }
    }

    const unitCostCents = asIntegerCents(raw['unit_cost_cents'] ?? 0)
    if (unitCostCents === null) {
      return { ok: false, error: `${at}: unit_cost_cents must be a non-negative integer (cents).` }
    }

    const catalogItemId = asUuidOrNull(raw['catalog_item_id'])
    if (catalogItemId === undefined) {
      return { ok: false, error: `${at}: catalog_item_id must be a uuid or null.` }
    }

    const assemblyId = asUuidOrNull(raw['assembly_id'])
    if (assemblyId === undefined) {
      return { ok: false, error: `${at}: assembly_id must be a uuid or null.` }
    }

    const assemblyGroupId = asUuidOrNull(raw['assembly_group_id'])
    if (assemblyGroupId === undefined) {
      return { ok: false, error: `${at}: assembly_group_id must be a uuid or null.` }
    }

    const driverRaw = raw['driver_quantity']
    const driverQuantity =
      driverRaw === null || driverRaw === undefined || driverRaw === ''
        ? null
        : asFiniteNumber(driverRaw)
    if (driverRaw !== null && driverRaw !== undefined && driverRaw !== '' && driverQuantity === null) {
      return { ok: false, error: `${at}: driver_quantity must be a number.` }
    }
    if (driverQuantity !== null && driverQuantity < 0) {
      return { ok: false, error: `${at}: driver_quantity must be non-negative.` }
    }
    if (assemblyId !== null && driverQuantity === null) {
      return { ok: false, error: `${at}: an assembly line must carry its driver_quantity.` }
    }

    const isOptional = raw['is_optional'] === true
    const isSelected = raw['is_selected'] === true
    if (isSelected && !isOptional) {
      return { ok: false, error: `${at}: only an optional line can be selected.` }
    }

    const groupLabel =
      typeof raw['group_label'] === 'string' && raw['group_label'].trim() !== ''
        ? raw['group_label'].trim()
        : null

    const derivation =
      typeof raw['derivation'] === 'string' && raw['derivation'].trim() !== ''
        ? raw['derivation'].trim()
        : null

    lines.push({
      kind,
      catalog_item_id: catalogItemId,
      assembly_id: assemblyId,
      driver_quantity: driverQuantity,
      assembly_group_id: assemblyGroupId,
      description,
      quantity,
      unit,
      unit_price_cents: unitPriceCents,
      unit_cost_cents: unitCostCents,
      taxable: raw['taxable'] !== false,
      is_optional: isOptional,
      is_selected: isSelected,
      group_label: groupLabel,
      derivation,
    })
  }

  return { ok: true, lines }
}

/**
 * The generated types describe an RPC's jsonb parameters as `Json`, which is a
 * structural type an interface cannot satisfy without an index signature. The
 * payloads here are plain data that JSON.stringify round-trips exactly, so this
 * is a shape assertion, not a conversion.
 */
export function asJson(value: unknown): Json {
  return value as Json
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface EstimateSnapshot {
  totals: EstimateTotals
  profit: Profitability
  /** The totals payload for the SQL functions, in their expected key names. */
  totalsJson: Record<string, number>
  profitJson: Record<string, number>
}

/**
 * Recompute the whole money picture from the lines. This is the only place a
 * total is produced on the server, and it produces it from the lines, never
 * from a number the client supplied.
 */
export function snapshot(lines: EstimateLineDraft[], terms: EstimateTerms): EstimateSnapshot {
  const totals = computeEstimateTotals(lines, terms)
  const profit = computeProfitability(lines, totals)

  return {
    totals,
    profit,
    totalsJson: {
      subtotalCents: totals.breakdown.subtotalCents,
      discountCents: totals.breakdown.discountCents,
      taxableSubtotalCents: totals.breakdown.taxableSubtotalCents,
      taxCents: totals.breakdown.taxCents,
      totalCents: totals.breakdown.totalCents,
      depositDueCents: totals.breakdown.depositDueCents,
      balanceDueCents: totals.breakdown.balanceDueCents,
    },
    profitJson: {
      estimatedCostCents: profit.estimatedCostCents,
      marginCents: profit.marginCents,
      marginBp: profit.marginBp,
    },
  }
}
