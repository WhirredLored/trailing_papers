/**
 * Dimensions — feet-inches parser and measurement utilities.
 *
 * Contractors enter dimensions in a variety of formats:
 *   "12' 6\""   → 12.5 ft
 *   "12.5"      → 12.5 ft
 *   "12'6"      → 12.5 ft
 *   "12ft 6in"  → 12.5 ft
 *   "3'"        → 3.0 ft
 *   "6\""       → 0.5 ft
 *
 * Canonical storage is decimal feet (number). This module owns all
 * parsing and formatting of dimensional input.
 */

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a feet-inches string into decimal feet.
 *
 * Accepted formats:
 *   - "12' 6\""    feet and inches with quotes
 *   - "12'6\""     feet and inches, no space
 *   - "12' 6"      feet and inches, no trailing quote
 *   - "12'6"       feet and inches, no spaces or trailing quote
 *   - "12ft 6in"   feet and inches with ft/in suffixes
 *   - "12.5"       decimal feet
 *   - "12'"        feet only
 *   - "6\""        inches only
 *   - "6in"        inches only with suffix
 *
 * @param input   The user-entered dimension string.
 * @returns       The dimension in decimal feet.
 * @throws        TypeError if the input cannot be parsed.
 */
export function parseFeetInches(input: string): number {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new TypeError('Cannot parse empty or non-string dimension value')
  }

  const cleaned = input.trim()

  // ── Pattern 1: feet and inches with various separators ──────────────────
  // Matches: 12'6", 12' 6", 12'6, 12' 6, 12ft 6in, 12ft6in
  const feetInchesRegex =
    /^(\d+(?:\.\d+)?)\s*(?:'|ft)\s*(\d+(?:\.\d+)?)\s*(?:"|in)?$/i
  const feetInchesMatch = cleaned.match(feetInchesRegex)
  if (feetInchesMatch) {
    const [, feetStr, inchesStr] = feetInchesMatch
    const feet = parseFloat(feetStr ?? '')
    const inches = parseFloat(inchesStr ?? '')
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) {
      throw new TypeError(`Cannot parse "${input}" as a dimension`)
    }
    if (inches >= 12) {
      throw new TypeError(
        `Inches value ${inches} must be less than 12 in feet-inches format`,
      )
    }
    return feet + inches / 12
  }

  // ── Pattern 2: feet only with quote or suffix ──────────────────────────
  // Matches: 12', 12.5', 12ft
  const feetOnlyRegex = /^(\d+(?:\.\d+)?)\s*(?:'|ft)$/i
  const feetOnlyMatch = cleaned.match(feetOnlyRegex)
  if (feetOnlyMatch) {
    const feet = parseFloat(feetOnlyMatch[1] ?? '')
    if (!Number.isFinite(feet)) {
      throw new TypeError(`Cannot parse "${input}" as a dimension`)
    }
    return feet
  }

  // ── Pattern 3: inches only with quote or suffix ────────────────────────
  // Matches: 6", 6.5", 6in
  const inchesOnlyRegex = /^(\d+(?:\.\d+)?)\s*(?:"|in)$/i
  const inchesOnlyMatch = cleaned.match(inchesOnlyRegex)
  if (inchesOnlyMatch) {
    const inches = parseFloat(inchesOnlyMatch[1] ?? '')
    if (!Number.isFinite(inches)) {
      throw new TypeError(`Cannot parse "${input}" as a dimension`)
    }
    return inches / 12
  }

  // ── Pattern 4: plain decimal number (interpreted as feet) ──────────────
  const plainNumberRegex = /^(\d+(?:\.\d+)?)$/
  const plainNumberMatch = cleaned.match(plainNumberRegex)
  if (plainNumberMatch) {
    const feet = parseFloat(plainNumberMatch[1] ?? '')
    if (!Number.isFinite(feet)) {
      throw new TypeError(`Cannot parse "${input}" as a dimension`)
    }
    return feet
  }

  throw new TypeError(`Cannot parse "${input}" as a dimension`)
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format decimal feet as a feet-inches string for display.
 *
 * Examples:
 *   12.5   → "12' 6\""
 *   12.0   → "12'"
 *   0.5    → "6\""
 *   12.75  → "12' 9\""
 *   12.333 → "12' 4\""  (inches rounded to nearest)
 */
export function formatFeetInches(decimalFeet: number): string {
  if (!Number.isFinite(decimalFeet) || decimalFeet < 0) {
    throw new TypeError(`Cannot format ${decimalFeet} as feet-inches`)
  }

  const totalInches = Math.round(decimalFeet * 12)
  const feet = Math.floor(totalInches / 12)
  const inches = totalInches % 12

  if (feet === 0 && inches === 0) return '0\''
  if (inches === 0) return `${feet}'`
  if (feet === 0) return `${inches}"`
  return `${feet}' ${inches}"`
}

// ---------------------------------------------------------------------------
// Area computation
// ---------------------------------------------------------------------------

/**
 * Compute net area given wall dimensions and openings.
 *
 * @param walls     Array of { length, height } in feet.
 * @param openings  Array of { width, height } in feet (subtracted from gross area).
 * @returns         Net area in square feet (never negative).
 */
export function computeNetArea(
  walls: Array<{ length: number; height: number }>,
  openings: Array<{ width: number; height: number }>,
): number {
  const grossArea = walls.reduce(
    (sum, w) => sum + w.length * w.height,
    0,
  )
  const openingArea = openings.reduce(
    (sum, o) => sum + o.width * o.height,
    0,
  )
  return Math.max(0, grossArea - openingArea)
}
