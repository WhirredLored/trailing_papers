/**
 * Takeoff Engine — pure function that computes material quantities from an
 * assembly definition and a driver quantity.
 *
 * This module has NO side effects and NO database access. It is a pure function
 * of its inputs. Every takeoff in PaperTrail is computed through this single
 * function, both client-side (for live previews) and server-side (for validation).
 *
 * WHAT MAKES THIS DEFENSIBLE:
 * Each component produces a human-readable DERIVATION STRING that shows exactly
 * how the number was reached. This is not a nicety — it's what makes the takeoff
 * auditable by the contractor and explainable to the client.
 *
 * ROUNDING RULES:
 *   - 'exact':         raw result rounded to nearest whole unit (roundHalfAwayFromZero)
 *   - 'up_to_unit':    always round up to next whole unit (Math.ceil)
 *   - 'up_to_package': round up to next package boundary (Math.ceil to package_size)
 *
 * MONEY:
 *   All cost computations use lib/money.ts (multiplyCents, roundHalfAwayFromZero).
 *   No floats on money paths.
 */

import {
  type Cents,
  multiplyCents,
  roundHalfAwayFromZero,
  sumCents,
} from './money'

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type RoundingRule = 'exact' | 'up_to_unit' | 'up_to_package'

export interface TakeoffComponent {
  /** Display name of the catalog item */
  name: string
  /** Catalog item unit (for derivation string formatting) */
  unit: string
  /** How many of this component per one driver unit */
  quantityPerDriver: number
  /** Waste percentage in basis points (1000 = 10%) */
  wastePercentBp: number
  /** How to round the purchase quantity */
  roundingRule: RoundingRule
  /** Package size for up_to_package rounding (e.g. 1, 12.5) */
  packageSize: number
  /** Unit cost in integer cents */
  unitCostCents: Cents
}

export interface TakeoffAssembly {
  /** Assembly name */
  name: string
  /** Driver unit label (for derivation strings) */
  driverUnit: string
  /** Components of this assembly */
  components: TakeoffComponent[]
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export interface TakeoffComponentResult {
  /** Component name (echoed from input) */
  name: string
  /** Component unit (echoed from input) */
  unit: string
  /** Raw quantity: driverQuantity × quantityPerDriver */
  rawQuantity: number
  /** Waste-adjusted quantity: rawQuantity × (1 + waste/10000) */
  wasteAdjustedQuantity: number
  /** Final purchase quantity after rounding rule */
  purchaseQuantity: number
  /** Extended cost in cents: purchaseQuantity × unitCostCents */
  extendedCostCents: Cents
  /** Human-readable derivation showing how the number was reached */
  derivation: string
}

export interface TakeoffResult {
  /** Assembly name */
  assemblyName: string
  /** The driver quantity that was input */
  driverQuantity: number
  /** Driver unit label */
  driverUnit: string
  /** Per-component results */
  components: TakeoffComponentResult[]
  /** Total cost in cents across all components */
  totalCostCents: Cents
}

// ---------------------------------------------------------------------------
// Formatting helpers (for derivation strings)
// ---------------------------------------------------------------------------

/** Format a number to a reasonable number of decimal places, trimming trailing zeros. */
function fmt(n: number, maxDecimals = 2): string {
  return parseFloat(n.toFixed(maxDecimals)).toString()
}

/** Format a unit label for plural/singular display */
function unitLabel(unit: string, qty: number): string {
  // Simple pluralization for common units
  if (qty === 1) return unit
  const plurals: Record<string, string> = {
    sq: 'squares',
    hour: 'hours',
    ea: 'ea',
    day: 'days',
    load: 'loads',
  }
  if (plurals[unit]) return plurals[unit]
  return unit
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/**
 * Compute a complete takeoff for an assembly given a driver quantity.
 *
 * This is a PURE FUNCTION — same inputs always produce the same outputs,
 * no side effects, no database access.
 *
 * @param assembly        The assembly definition with components.
 * @param driverQuantity  The measured driver quantity (e.g. 370 sq ft).
 * @returns               Full takeoff result with derivation strings.
 */
export function computeTakeoff(
  assembly: TakeoffAssembly,
  driverQuantity: number,
): TakeoffResult {
  if (!Number.isFinite(driverQuantity) || driverQuantity < 0) {
    throw new TypeError(
      `Driver quantity must be a non-negative finite number, received ${driverQuantity}`,
    )
  }

  const componentResults: TakeoffComponentResult[] = assembly.components.map(
    (comp) => {
      // Step 1: Raw quantity
      const rawQuantity = driverQuantity * comp.quantityPerDriver

      // Step 2: Waste-adjusted quantity
      const wasteFactor = 1 + comp.wastePercentBp / 10000
      const wasteAdjustedQuantity = rawQuantity * wasteFactor

      // Step 3: Purchase quantity by rounding rule
      let purchaseQuantity: number
      switch (comp.roundingRule) {
        case 'exact':
          purchaseQuantity = roundHalfAwayFromZero(wasteAdjustedQuantity)
          break
        case 'up_to_unit':
          purchaseQuantity =
            wasteAdjustedQuantity === 0
              ? 0
              : Math.ceil(wasteAdjustedQuantity)
          break
        case 'up_to_package':
          if (wasteAdjustedQuantity === 0) {
            purchaseQuantity = 0
          } else {
            purchaseQuantity =
              Math.ceil(wasteAdjustedQuantity / comp.packageSize) *
              comp.packageSize
          }
          break
        default:
          throw new TypeError(`Unknown rounding rule: ${comp.roundingRule}`)
      }

      // Step 4: Extended cost
      const extendedCostCents = multiplyCents(
        comp.unitCostCents,
        purchaseQuantity,
      )

      // Step 5: Build derivation string
      const derivation = buildDerivation(
        driverQuantity,
        assembly.driverUnit,
        comp,
        rawQuantity,
        wasteFactor,
        wasteAdjustedQuantity,
        purchaseQuantity,
      )

      return {
        name: comp.name,
        unit: comp.unit,
        rawQuantity,
        wasteAdjustedQuantity,
        purchaseQuantity,
        extendedCostCents,
        derivation,
      }
    },
  )

  const totalCostCents = sumCents(
    componentResults.map((c) => c.extendedCostCents),
  )

  return {
    assemblyName: assembly.name,
    driverQuantity,
    driverUnit: assembly.driverUnit,
    components: componentResults,
    totalCostCents,
  }
}

/**
 * Build a human-readable derivation string for a single component.
 *
 * Example output:
 *   "412 sq ft ÷ 100 = 4.12 sq × 1.10 waste = 4.53 → 5 squares"
 *   "412 sq ft × 0.0267 = 11 lin ft × 1.05 waste = 11.55 → 12 lin ft"
 */
function buildDerivation(
  driverQty: number,
  driverUnit: string,
  comp: TakeoffComponent,
  rawQty: number,
  wasteFactor: number,
  wasteAdj: number,
  purchaseQty: number,
): string {
  const parts: string[] = []

  // Starting point
  parts.push(`${fmt(driverQty)} ${driverUnit}`)

  // Conversion step. A contractor reads a "per 100 sq ft" rate as a division, not as a
  // multiplication by 0.01, so show "÷ 100" whenever the reciprocal is a clean whole
  // number. The spec's worked example depends on this form.
  const reciprocal = 1 / comp.quantityPerDriver
  const roundedReciprocal = Math.round(reciprocal)
  const isCleanReciprocal =
    comp.quantityPerDriver < 1 &&
    Number.isFinite(reciprocal) &&
    roundedReciprocal > 1 &&
    Math.abs(reciprocal - roundedReciprocal) < 1e-9

  if (isCleanReciprocal) {
    parts.push(`÷ ${roundedReciprocal} = ${fmt(rawQty)} ${comp.unit}`)
  } else {
    parts.push(`× ${fmt(comp.quantityPerDriver, 4)} = ${fmt(rawQty)} ${comp.unit}`)
  }

  // Waste step (only if waste > 0). Two decimals so 10% reads as "1.10", not "1.1".
  if (comp.wastePercentBp > 0) {
    parts.push(`× ${wasteFactor.toFixed(2)} waste = ${fmt(wasteAdj)}`)
  }

  // Rounding step
  const unitStr = unitLabel(comp.unit, purchaseQty)
  if (comp.roundingRule === 'up_to_package' && comp.packageSize !== 1) {
    parts.push(
      `→ ${fmt(purchaseQty)} ${unitStr} (pkg of ${fmt(comp.packageSize)})`,
    )
  } else {
    parts.push(`→ ${fmt(purchaseQty)} ${unitStr}`)
  }

  return parts.join(' ')
}
