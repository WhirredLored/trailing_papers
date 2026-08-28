/**
 * Money is integer cents, everywhere (Architecture Law 4).
 *
 * Placeholder for the scaffold commit: this module owns every dollar formatting and
 * arithmetic operation in the app so that no float ever touches a total. Rounding rules,
 * tax, allocation across line items, and the server-side recompute all land in C05.
 *
 * Rules that hold from here on:
 *   - Amounts cross module and network boundaries as `Cents`, never as dollars.
 *   - No `+`, `*`, or `/` on dollar values anywhere outside this file.
 *   - Totals are recomputed server-side and never trusted from the client.
 */

/** A monetary amount in whole cents. Negative values are credits. */
export type Cents = number

/** Guards against a float sneaking in where cents are expected. */
export function assertCents(value: number): asserts value is Cents {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Money must be integer cents, received ${value}`)
  }
}

/** Formats cents for display, e.g. 125000 -> "$1,250.00". */
export function formatCents(cents: Cents, currency = 'USD', locale = 'en-US'): string {
  assertCents(cents)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100)
}
