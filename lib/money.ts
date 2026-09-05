/**
 * Money is integer cents, everywhere (Architecture Law 4).
 *
 * This module owns every dollar formatting and arithmetic operation in the app.
 * No float ever touches a total. All amounts cross module and network boundaries
 * as `Cents`, never as dollars. No `+`, `*`, or `/` on dollar values anywhere
 * outside this file and `lib/totals.ts`.
 *
 * ROUNDING RULE (see DECISIONS.md):
 *   Round half away from zero at the line level, then sum.
 *   Tax is computed on the sum and rounded once.
 *   This prevents double-rounding and matches standard accounting practice.
 *
 *   Implementation: `roundHalfAwayFromZero(n)` — positive halves round up,
 *   negative halves round down (away from zero in both directions).
 */

// ---------------------------------------------------------------------------
// Core type
// ---------------------------------------------------------------------------

/** A monetary amount in whole cents. Negative values are credits. */
export type Cents = number

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** Guards against a float sneaking in where cents are expected. */
export function assertCents(value: number): asserts value is Cents {
  if (!Number.isInteger(value)) {
    throw new TypeError(`Money must be integer cents, received ${value}`)
  }
}

/** Predicate form of the cents guard. */
export function isCents(value: number): value is Cents {
  return Number.isInteger(value)
}

// ---------------------------------------------------------------------------
// Rounding
// ---------------------------------------------------------------------------

/**
 * Round half away from zero.
 *
 * Standard `Math.round` rounds 0.5 toward +Infinity, which biases negative
 * values incorrectly (Math.round(-0.5) === 0, not -1). This function rounds
 * toward the larger absolute value when exactly at the midpoint.
 *
 * This is the SINGLE rounding function used for all monetary computations.
 */
export function roundHalfAwayFromZero(n: number): number {
  if (n >= 0) {
    return Math.floor(n + 0.5)
  }
  // The `|| 0` normalizes -0 to +0 (e.g. -Math.floor(0.9) === -0).
  return -Math.floor(-n + 0.5) || 0
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a user-entered dollar string into integer cents.
 *
 * Accepts: "$1,250.50", "1250.5", "1,250.50", "-$49.99", "$0", "0", etc.
 * Rejects: empty strings, non-numeric content, NaN results.
 *
 * Uses string manipulation (split on ".") instead of parseFloat to avoid
 * IEEE 754 precision traps. The only rounding that occurs is when the user
 * enters more than 2 decimal places (e.g. "1.005" → 101 cents, following
 * the round-half-away-from-zero rule).
 */
export function parseCents(input: string): Cents {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new TypeError(`Cannot parse empty or non-string value as cents`)
  }

  // Strip currency symbols, commas, and whitespace
  let cleaned = input.trim().replace(/[$,\s]/g, '')

  // Detect and strip sign
  let negative = false
  if (cleaned.startsWith('-')) {
    negative = true
    cleaned = cleaned.slice(1)
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1)
  }

  // Handle parenthetical negatives: (123.45)
  if (cleaned.startsWith('(') && cleaned.endsWith(')')) {
    negative = true
    cleaned = cleaned.slice(1, -1)
  }

  if (cleaned === '' || !/^\d+\.?\d*$/.test(cleaned)) {
    throw new TypeError(`Cannot parse "${input}" as a dollar amount`)
  }

  // Split on decimal point to avoid float precision issues
  const parts = cleaned.split('.')
  const wholePart = parts[0] || '0'
  let fracPart = parts[1] || '0'

  // Parse whole dollars → cents
  const wholeCents = parseInt(wholePart, 10) * 100

  if (isNaN(wholeCents)) {
    throw new TypeError(`Cannot parse "${input}" as a dollar amount`)
  }

  // Handle fractional part — pad or truncate to exactly 2+ digits for rounding
  if (fracPart.length === 0) {
    fracPart = '00'
  } else if (fracPart.length === 1) {
    fracPart = fracPart + '0'
  }

  let fracCents: number
  if (fracPart.length === 2) {
    // Exact cents, no rounding needed
    fracCents = parseInt(fracPart, 10)
  } else {
    // More than 2 decimal places — need to round
    // Take first 2 digits as cents, rest determines rounding
    const first2 = parseInt(fracPart.slice(0, 2), 10)
    const remainder = parseInt(fracPart.slice(2), 10)
    const remainderMagnitude = Math.pow(10, fracPart.length - 2)
    // remainder / remainderMagnitude gives the fractional part of a cent
    const fracOfCent = remainder / remainderMagnitude
    fracCents = first2 + roundHalfAwayFromZero(fracOfCent)
  }

  const totalCents = wholeCents + fracCents
  return negative ? -totalCents : totalCents
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Formats cents for display with currency symbol, e.g. 125000 → "$1,250.00". */
export function formatCents(cents: Cents, currency = 'USD', locale = 'en-US'): string {
  assertCents(cents)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(cents / 100)
}

/**
 * Formats cents as a plain number string without currency symbol.
 * Useful for PDF table cells and CSV exports.
 * e.g. 125000 → "1,250.00", -4999 → "-49.99"
 */
export function formatCentsPlain(cents: Cents, locale = 'en-US'): string {
  assertCents(cents)
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/** Sum any number of Cents values. Returns 0 for an empty list. */
export function addCents(...values: Cents[]): Cents {
  let total = 0
  for (const v of values) {
    assertCents(v)
    total += v
  }
  return total
}

/** Subtract b from a. Both must be integer cents. */
export function subtractCents(a: Cents, b: Cents): Cents {
  assertCents(a)
  assertCents(b)
  return a - b
}

/**
 * Multiply a unit price (cents) by a quantity.
 *
 * Quantity can be a decimal (e.g. 2.5 hours of labor). The result is rounded
 * per the documented rule (round half away from zero). This is the ONLY place
 * where a non-integer intermediate value appears in money math.
 */
export function multiplyCents(unitPriceCents: Cents, quantity: number): Cents {
  assertCents(unitPriceCents)
  if (!Number.isFinite(quantity)) {
    throw new TypeError(`Quantity must be a finite number, received ${quantity}`)
  }
  return roundHalfAwayFromZero(unitPriceCents * quantity)
}

/** Reduce an array of Cents to their sum. Returns 0 for an empty array. */
export function sumCents(values: Cents[]): Cents {
  return addCents(...values)
}

// ---------------------------------------------------------------------------
// Percentage operations (basis points)
// ---------------------------------------------------------------------------

/**
 * Apply a percentage to an amount, expressed in basis points.
 *
 * Basis points match the database schema (C03: `default_tax_bp`).
 * 875 bp = 8.75%. Result is rounded per the documented rule.
 *
 * @param amountCents  The base amount in cents.
 * @param basisPoints  The percentage in basis points (100 bp = 1%).
 * @returns            The computed portion in cents (rounded).
 */
export function applyPercent(amountCents: Cents, basisPoints: number): Cents {
  assertCents(amountCents)
  if (!Number.isInteger(basisPoints)) {
    throw new TypeError(`Basis points must be an integer, received ${basisPoints}`)
  }
  return roundHalfAwayFromZero((amountCents * basisPoints) / 10000)
}

/**
 * Compute what percentage `part` is of `whole`, returned as basis points.
 * Returns 0 if whole is 0 (avoid division by zero).
 */
export function percentOfCents(partCents: Cents, wholeCents: Cents): number {
  assertCents(partCents)
  assertCents(wholeCents)
  if (wholeCents === 0) return 0
  return roundHalfAwayFromZero((partCents * 10000) / wholeCents)
}

// ---------------------------------------------------------------------------
// Markup vs Margin — explicitly different (see DECISIONS.md)
// ---------------------------------------------------------------------------

/**
 * Apply a markup to a cost to get a selling price.
 *
 * Markup is added ON TOP OF cost:
 *   price = cost × (1 + markup / 10000)
 *
 * Example: cost $100, markup 2000 bp (20%) → price $120.
 * Contractors often say "markup" when they mean either markup or margin.
 * These two functions are intentionally separate and labeled unambiguously.
 *
 * @param costCents   The cost in cents.
 * @param markupBp    The markup percentage in basis points.
 * @returns           The selling price in cents (rounded).
 */
export function applyMarkup(costCents: Cents, markupBp: number): Cents {
  assertCents(costCents)
  if (!Number.isInteger(markupBp)) {
    throw new TypeError(`Markup basis points must be an integer, received ${markupBp}`)
  }
  return roundHalfAwayFromZero(costCents * (1 + markupBp / 10000))
}

/**
 * Apply a margin to a cost to get a selling price.
 *
 * Margin is the profit as a fraction of the SELLING PRICE:
 *   price = cost / (1 - margin / 10000)
 *
 * Example: cost $100, margin 2000 bp (20%) → price $125.
 * Compare with markup: same inputs produce $120 vs $125.
 *
 * Throws if margin ≥ 10000 bp (100%) — that would require infinite price.
 *
 * @param costCents   The cost in cents.
 * @param marginBp    The margin percentage in basis points.
 * @returns           The selling price in cents (rounded).
 */
export function applyMargin(costCents: Cents, marginBp: number): Cents {
  assertCents(costCents)
  if (!Number.isInteger(marginBp)) {
    throw new TypeError(`Margin basis points must be an integer, received ${marginBp}`)
  }
  if (marginBp >= 10000) {
    throw new RangeError(`Margin must be less than 10000 bp (100%), received ${marginBp}`)
  }
  if (marginBp < 0) {
    throw new RangeError(`Margin must be non-negative, received ${marginBp}`)
  }
  return roundHalfAwayFromZero(costCents / (1 - marginBp / 10000))
}
