/**
 * Totals Engine — pure function that computes a full estimate/invoice breakdown.
 *
 * This module has NO side effects and NO database access. It is a pure function
 * of its inputs. Every total in PaperTrail is computed through this single
 * function, both client-side (for live previews) and server-side (for validation).
 *
 * ROUNDING STRATEGY (see DECISIONS.md):
 *   1. Each line's extended amount is rounded at the line level.
 *   2. All line amounts are summed (exact, since they're integers).
 *   3. Discount is computed and rounded once.
 *   4. Tax is computed on the taxable subtotal and rounded once.
 *   5. Deposit is computed and rounded once.
 *   No intermediate value is rounded more than once.
 *
 * DISCOUNT ALLOCATION (see DECISIONS.md):
 *   When a percentage discount is applied and the estimate has a mix of taxable
 *   and non-taxable lines, the discount is allocated proportionally (pro-rata)
 *   between taxable and non-taxable amounts. This matches standard accounting
 *   practice and ensures the tax base is reduced by the correct amount.
 */

import {
  type Cents,
  addCents,
  applyPercent,
  multiplyCents,
  roundHalfAwayFromZero,
  subtractCents,
  sumCents,
} from './money'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface LineItem {
  /** Human-readable description (carried through for display; not used in math) */
  description: string
  /** Unit price in integer cents */
  unitPriceCents: Cents
  /** Quantity — can be decimal (e.g. 2.5 hours of labor) */
  quantity: number
  /** Whether this line is subject to sales tax (per-line taxability, not a global switch) */
  taxable: boolean
}

export interface TotalsInput {
  /** The line items to compute */
  lines: LineItem[]
  /** Sales tax rate in basis points (875 = 8.75%). Must be ≥ 0. */
  taxRateBp: number
  /** Discount mode: 'percent' applies discountValue as basis points; 'fixed' as cents */
  discountType: 'percent' | 'fixed'
  /** Discount value: basis points if discountType='percent', cents if 'fixed' */
  discountValue: number
  /** Deposit mode: 'percent' applies depositValue as percent (0-100); 'fixed' as cents */
  depositType: 'percent' | 'fixed'
  /** Deposit value: percent (0-100) if depositType='percent', cents if 'fixed' */
  depositValue: number
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface LineResult {
  /** Extended price: unitPrice × quantity, rounded per the documented rule */
  extendedCents: Cents
  /** Whether this line is taxable (echoed from input for downstream convenience) */
  taxable: boolean
}

export interface TotalsBreakdown {
  /** Per-line results, in the same order as the input lines */
  lines: LineResult[]
  /** Sum of all extended line amounts */
  subtotalCents: Cents
  /** Discount amount (always positive or zero) */
  discountCents: Cents
  /** Sum of taxable lines minus the taxable share of the discount */
  taxableSubtotalCents: Cents
  /** Tax computed on the taxable subtotal */
  taxCents: Cents
  /** Final total: subtotal − discount + tax */
  totalCents: Cents
  /** Deposit due: computed from total per deposit terms */
  depositDueCents: Cents
  /** Balance remaining: total − deposit */
  balanceDueCents: Cents
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Compute a complete estimate/invoice breakdown.
 *
 * This is a PURE FUNCTION — same inputs always produce the same outputs,
 * no side effects, no database access.
 */
export function computeTotals(input: TotalsInput): TotalsBreakdown {
  const { lines, taxRateBp, discountType, discountValue, depositType, depositValue } = input

  // Step 1: Compute per-line extended amounts (round at line level)
  const lineResults: LineResult[] = lines.map((line) => ({
    extendedCents: multiplyCents(line.unitPriceCents, line.quantity),
    taxable: line.taxable,
  }))

  // Step 2: Sum all lines for subtotal
  const subtotalCents = sumCents(lineResults.map((lr) => lr.extendedCents))

  // Step 3: Compute discount (round once)
  let discountCents: Cents
  if (discountType === 'percent') {
    discountCents = applyPercent(subtotalCents, discountValue)
  } else {
    // Fixed discount — cap at subtotal to prevent negative pre-tax amounts
    discountCents = Math.min(discountValue, Math.max(subtotalCents, 0))
  }
  // Discount is always non-negative
  discountCents = Math.max(0, discountCents)

  // Step 4: Compute taxable subtotal
  // Sum taxable line amounts
  const taxableLineTotal = sumCents(
    lineResults.filter((lr) => lr.taxable).map((lr) => lr.extendedCents),
  )

  // Pro-rata discount allocation: if there's a mix of taxable and non-taxable lines,
  // the discount is split proportionally between them. The taxable portion of the
  // discount reduces the tax base.
  let taxableDiscountShare: Cents = 0
  if (subtotalCents !== 0 && discountCents > 0) {
    // Proportion of taxable lines in the subtotal
    taxableDiscountShare = roundHalfAwayFromZero(
      (discountCents * taxableLineTotal) / subtotalCents,
    )
  }

  const taxableSubtotalCents = Math.max(0, subtractCents(taxableLineTotal, taxableDiscountShare))

  // Step 5: Compute tax (round once, on the final taxable subtotal)
  const taxCents = applyPercent(taxableSubtotalCents, taxRateBp)

  // Step 6: Compute total
  const totalCents = addCents(subtractCents(subtotalCents, discountCents), taxCents)

  // Step 7: Compute deposit
  let depositDueCents: Cents
  if (depositType === 'percent') {
    // depositValue is 0-100 (percent), convert to basis points (0-10000)
    depositDueCents = applyPercent(totalCents, depositValue * 100)
  } else {
    // Fixed deposit — cap at total
    depositDueCents = Math.min(depositValue, Math.max(totalCents, 0))
  }
  depositDueCents = Math.max(0, depositDueCents)

  // Step 8: Balance
  const balanceDueCents = subtractCents(totalCents, depositDueCents)

  return {
    lines: lineResults,
    subtotalCents,
    discountCents,
    taxableSubtotalCents,
    taxCents,
    totalCents,
    depositDueCents,
    balanceDueCents,
  }
}
