/**
 * Server-side recompute helper — enforces Architecture Law 4.
 *
 * "Totals are recomputed server-side and never trusted from the client."
 *
 * Later commits (C08 estimate builder, C12 change orders, C13 invoices) call
 * this function to reject client-supplied totals that don't match what the
 * server computes independently.
 */

import type { Cents } from './money'
import { computeTotals, type TotalsBreakdown, type TotalsInput } from './totals'

/**
 * Recompute totals from the canonical line items and terms, then assert that
 * the client-supplied total matches.
 *
 * @param clientTotalCents  The total the client claims.
 * @param input             The canonical line items + terms.
 * @returns                 The server-computed breakdown (if the total matches).
 * @throws                  Error if the client total does not match the server total.
 */
export function recomputeAndAssert(clientTotalCents: Cents, input: TotalsInput): TotalsBreakdown {
  const breakdown = computeTotals(input)

  if (clientTotalCents !== breakdown.totalCents) {
    throw new Error(
      `Total mismatch: client sent ${clientTotalCents} cents but server computed ${breakdown.totalCents} cents. ` +
        `Totals are recomputed server-side and never trusted from the client (Law 4).`,
    )
  }

  return breakdown
}
