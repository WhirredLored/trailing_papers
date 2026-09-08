/**
 * Tests for lib/takeoff.ts — pure takeoff engine.
 *
 * Known-answer tests use the same seed catalog prices from C06. The acceptance
 * test (40' × 10' wall with two 3×5 windows through siding assembly) is the
 * spec gate for C07.
 */

import { describe, expect, it } from 'vitest'
import {
  computeTakeoff,
  type TakeoffAssembly,
  type TakeoffComponent,
  type TakeoffComponentResult,
  type TakeoffResult,
} from './takeoff'

/**
 * Indexing into components[] is `| undefined` under noUncheckedIndexedAccess. Asserting
 * presence here gives a named failure if an assembly's shape ever changes, instead of a
 * bare 'cannot read property of undefined' further down the test.
 */
function componentAt(result: TakeoffResult, index: number): TakeoffComponentResult {
  const component = result.components[index]
  if (!component) {
    throw new Error(
      `Expected a component at index ${index}, but the assembly has ${result.components.length}`,
    )
  }
  return component
}

// ── Helper: build a component with defaults ─────────────────────────────────
function comp(overrides: Partial<TakeoffComponent> & { name: string; unitCostCents: number }): TakeoffComponent {
  return {
    unit: 'ea',
    quantityPerDriver: 1,
    wastePercentBp: 0,
    roundingRule: 'up_to_unit',
    packageSize: 1,
    ...overrides,
  }
}

// ── Seed-catalog-based siding assembly ──────────────────────────────────────
// This matches the C07 spec acceptance test. Driver unit is sq_ft.
// Component quantities are per sq ft of wall area.
const SIDING_ASSEMBLY: TakeoffAssembly = {
  name: 'Vinyl Siding — per sq ft',
  driverUnit: 'sq ft',
  components: [
    comp({
      name: 'Vinyl siding D4.5" clapboard',
      unit: 'sq',
      // 1 square = 100 sq ft, so per sq ft = 0.01 squares
      quantityPerDriver: 0.01,
      wastePercentBp: 1000, // 10%
      roundingRule: 'up_to_package',
      packageSize: 1, // sold per square
      unitCostCents: 8999,
    }),
    comp({
      name: 'J-channel',
      unit: 'lin ft',
      // Typical: ~0.1 lin ft of J per sq ft (perimeter-to-area ratio)
      quantityPerDriver: 0.1,
      wastePercentBp: 500, // 5%
      roundingRule: 'up_to_package',
      packageSize: 12.5, // sold in 12'6" sticks
      unitCostCents: 89, // per lin ft
    }),
    comp({
      name: 'Starter strip',
      unit: 'lin ft',
      // ~0.025 lin ft per sq ft (bottom of each wall)
      quantityPerDriver: 0.025,
      wastePercentBp: 500, // 5%
      roundingRule: 'up_to_package',
      packageSize: 12.5,
      unitCostCents: 125, // per lin ft
    }),
    comp({
      name: 'Galvanized ring-shank nails 1.5"',
      unit: 'ea',
      // ~0.005 boxes per sq ft
      quantityPerDriver: 0.005,
      wastePercentBp: 0,
      roundingRule: 'up_to_unit',
      packageSize: 1,
      unitCostCents: 4500, // per box
    }),
    comp({
      name: 'Lead installer',
      unit: 'hour',
      // ~0.02 hours per sq ft
      quantityPerDriver: 0.02,
      wastePercentBp: 0,
      roundingRule: 'exact',
      packageSize: 1,
      unitCostCents: 6500, // per hour
    }),
    comp({
      name: 'Helper / laborer',
      unit: 'hour',
      // ~0.02 hours per sq ft
      quantityPerDriver: 0.02,
      wastePercentBp: 0,
      roundingRule: 'exact',
      packageSize: 1,
      unitCostCents: 3500, // per hour
    }),
  ],
}

// ── Acceptance Test ─────────────────────────────────────────────────────────
// Spec: 40' × 10' wall with two 3×5 windows = 400 - 30 = 370 sq ft net area.

describe('acceptance: 40×10 wall with two 3×5 windows', () => {
  const NET_AREA = 370 // 40*10 - 2*(3*5)
  const result = computeTakeoff(SIDING_ASSEMBLY, NET_AREA)

  it('computes the correct number of siding squares', () => {
    const siding = componentAt(result, 0)
    // 370 × 0.01 = 3.70 sq × 1.10 waste = 4.07 → up_to_package(1) = 5 squares
    expect(siding.rawQuantity).toBeCloseTo(3.7, 10)
    expect(siding.wasteAdjustedQuantity).toBeCloseTo(4.07, 10)
    expect(siding.purchaseQuantity).toBe(5)
    expect(siding.extendedCostCents).toBe(5 * 8999)
  })

  it('computes J-channel quantity', () => {
    const jchan = componentAt(result, 1)
    // 370 × 0.1 = 37 lin ft × 1.05 waste = 38.85 → ceil(38.85/12.5)*12.5 = 4*12.5 = 50 lin ft
    expect(jchan.rawQuantity).toBeCloseTo(37, 10)
    expect(jchan.wasteAdjustedQuantity).toBeCloseTo(38.85, 10)
    expect(jchan.purchaseQuantity).toBe(50)
    expect(jchan.extendedCostCents).toBe(50 * 89)
  })

  it('computes starter strip quantity', () => {
    const starter = componentAt(result, 2)
    // 370 × 0.025 = 9.25 lin ft × 1.05 waste = 9.7125 → ceil(9.7125/12.5)*12.5 = 1*12.5 = 12.5 lin ft
    expect(starter.rawQuantity).toBeCloseTo(9.25, 10)
    expect(starter.wasteAdjustedQuantity).toBeCloseTo(9.7125, 10)
    expect(starter.purchaseQuantity).toBe(12.5)
    expect(starter.extendedCostCents).toBe(Math.round(12.5 * 125)) // multiplyCents rounds
  })

  it('computes nail boxes quantity', () => {
    const nails = componentAt(result, 3)
    // 370 × 0.005 = 1.85 boxes → ceil = 2 boxes
    expect(nails.rawQuantity).toBeCloseTo(1.85, 10)
    expect(nails.wasteAdjustedQuantity).toBeCloseTo(1.85, 10) // 0 waste
    expect(nails.purchaseQuantity).toBe(2)
    expect(nails.extendedCostCents).toBe(2 * 4500)
  })

  it('computes lead installer hours', () => {
    const lead = componentAt(result, 4)
    // 370 × 0.02 = 7.4 hours → exact rounding = 7 hours
    expect(lead.rawQuantity).toBeCloseTo(7.4, 10)
    expect(lead.purchaseQuantity).toBe(7) // roundHalfAwayFromZero(7.4) = 7
    expect(lead.extendedCostCents).toBe(7 * 6500)
  })

  it('computes helper hours', () => {
    const helper = componentAt(result, 5)
    // 370 × 0.02 = 7.4 hours → exact rounding = 7 hours
    expect(helper.rawQuantity).toBeCloseTo(7.4, 10)
    expect(helper.purchaseQuantity).toBe(7) // roundHalfAwayFromZero(7.4) = 7
    expect(helper.extendedCostCents).toBe(7 * 3500)
  })

  it('sums total cost correctly', () => {
    const expected =
      5 * 8999 +     // siding
      50 * 89 +      // J-channel
      Math.round(12.5 * 125) + // starter
      2 * 4500 +     // nails
      7 * 6500 +     // lead
      7 * 3500       // helper
    expect(result.totalCostCents).toBe(expected)
  })

  it('includes derivation strings for every component', () => {
    for (const c of result.components) {
      expect(c.derivation).toBeTruthy()
      expect(typeof c.derivation).toBe('string')
      expect(c.derivation.length).toBeGreaterThan(0)
      // Derivation should start with the driver quantity
      expect(c.derivation).toContain('370')
    }
  })
})

// ── Rounding rules ──────────────────────────────────────────────────────────

describe('rounding rules', () => {
  it('exact: rounds to nearest using roundHalfAwayFromZero', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Item',
          quantityPerDriver: 1,
          wastePercentBp: 0,
          roundingRule: 'exact',
          packageSize: 1,
          unitCostCents: 100,
        }),
      ],
    }
    // 7.4 → rounds to 7
    expect(componentAt(computeTakeoff(assembly, 7.4), 0).purchaseQuantity).toBe(7)
    // 7.5 → rounds to 8 (half away from zero)
    expect(componentAt(computeTakeoff(assembly, 7.5), 0).purchaseQuantity).toBe(8)
    // 7.6 → rounds to 8
    expect(componentAt(computeTakeoff(assembly, 7.6), 0).purchaseQuantity).toBe(8)
  })

  it('up_to_unit: always rounds up to next whole unit', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Item',
          quantityPerDriver: 1,
          wastePercentBp: 0,
          roundingRule: 'up_to_unit',
          packageSize: 1,
          unitCostCents: 100,
        }),
      ],
    }
    // 7.1 → 8
    expect(componentAt(computeTakeoff(assembly, 7.1), 0).purchaseQuantity).toBe(8)
    // 7.0 → 7 (already whole)
    expect(componentAt(computeTakeoff(assembly, 7.0), 0).purchaseQuantity).toBe(7)
  })

  it('up_to_package: rounds up to next package boundary', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'lin ft',
      components: [
        comp({
          name: 'Stick',
          unit: 'lin ft',
          quantityPerDriver: 1,
          wastePercentBp: 0,
          roundingRule: 'up_to_package',
          packageSize: 12.5, // 12'6" sticks
          unitCostCents: 100,
        }),
      ],
    }
    // 13 lin ft → ceil(13/12.5)*12.5 = 2*12.5 = 25
    expect(componentAt(computeTakeoff(assembly, 13), 0).purchaseQuantity).toBe(25)
    // 12.5 → ceil(12.5/12.5)*12.5 = 1*12.5 = 12.5
    expect(componentAt(computeTakeoff(assembly, 12.5), 0).purchaseQuantity).toBe(12.5)
    // 25 → ceil(25/12.5)*12.5 = 2*12.5 = 25
    expect(componentAt(computeTakeoff(assembly, 25), 0).purchaseQuantity).toBe(25)
  })
})

// ── Packaging boundary: exactly 5.0 squares must not become 6 ───────────────

describe('packaging boundary', () => {
  it('exactly 5.0 squares stays at 5, not 6', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Siding',
          unit: 'sq',
          quantityPerDriver: 0.01, // 1 sq = 100 sq ft
          wastePercentBp: 0,       // no waste
          roundingRule: 'up_to_package',
          packageSize: 1,          // per square
          unitCostCents: 8999,
        }),
      ],
    }
    // 500 sq ft × 0.01 = 5.0 exactly → should be 5, not 6
    const result = computeTakeoff(assembly, 500)
    expect(componentAt(result, 0).rawQuantity).toBe(5.0)
    expect(componentAt(result, 0).wasteAdjustedQuantity).toBe(5.0)
    expect(componentAt(result, 0).purchaseQuantity).toBe(5)
  })

  it('5.01 squares rounds up to 6 with up_to_package', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Siding',
          unit: 'sq',
          quantityPerDriver: 0.01,
          wastePercentBp: 0,
          roundingRule: 'up_to_package',
          packageSize: 1,
          unitCostCents: 8999,
        }),
      ],
    }
    // 501 sq ft × 0.01 = 5.01 → ceil(5.01/1)*1 = 6
    const result = computeTakeoff(assembly, 501)
    expect(componentAt(result, 0).purchaseQuantity).toBe(6)
  })
})

// ── Waste factor ────────────────────────────────────────────────────────────

describe('waste factor', () => {
  it('10% waste (1000 bp) multiplies by 1.10', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Item',
          quantityPerDriver: 1,
          wastePercentBp: 1000, // 10%
          roundingRule: 'exact',
          packageSize: 1,
          unitCostCents: 100,
        }),
      ],
    }
    const result = computeTakeoff(assembly, 100)
    expect(componentAt(result, 0).rawQuantity).toBe(100)
    expect(componentAt(result, 0).wasteAdjustedQuantity).toBeCloseTo(110, 10)
  })

  it('0% waste (0 bp) has no effect', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Item',
          quantityPerDriver: 1,
          wastePercentBp: 0,
          roundingRule: 'exact',
          packageSize: 1,
          unitCostCents: 100,
        }),
      ],
    }
    const result = computeTakeoff(assembly, 100)
    expect(componentAt(result, 0).wasteAdjustedQuantity).toBe(100)
  })

  it('5% waste (500 bp) multiplies by 1.05', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Item',
          quantityPerDriver: 1,
          wastePercentBp: 500,
          roundingRule: 'exact',
          packageSize: 1,
          unitCostCents: 100,
        }),
      ],
    }
    const result = computeTakeoff(assembly, 100)
    expect(componentAt(result, 0).wasteAdjustedQuantity).toBeCloseTo(105, 10)
  })
})

// ── Zero driver ─────────────────────────────────────────────────────────────

describe('zero driver quantity', () => {
  it('produces 0 of everything', () => {
    const result = computeTakeoff(SIDING_ASSEMBLY, 0)
    for (const c of result.components) {
      expect(c.rawQuantity).toBe(0)
      expect(c.wasteAdjustedQuantity).toBe(0)
      expect(c.purchaseQuantity).toBe(0)
      expect(c.extendedCostCents).toBe(0)
    }
    expect(result.totalCostCents).toBe(0)
  })
})

// ── Invalid input ───────────────────────────────────────────────────────────

describe('invalid input', () => {
  it('throws on negative driver quantity', () => {
    expect(() => computeTakeoff(SIDING_ASSEMBLY, -10)).toThrow(TypeError)
  })

  it('throws on NaN driver quantity', () => {
    expect(() => computeTakeoff(SIDING_ASSEMBLY, NaN)).toThrow(TypeError)
  })

  it('throws on Infinity driver quantity', () => {
    expect(() => computeTakeoff(SIDING_ASSEMBLY, Infinity)).toThrow(TypeError)
  })
})

// ── Derivation strings ─────────────────────────────────────────────────────

describe('derivation strings', () => {
  it('includes waste factor when present', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Item',
          quantityPerDriver: 0.01,
          wastePercentBp: 1000,
          roundingRule: 'up_to_unit',
          packageSize: 1,
          unitCostCents: 100,
        }),
      ],
    }
    const result = computeTakeoff(assembly, 400)
    expect(componentAt(result, 0).derivation).toContain('waste')
  })

  it('omits waste factor when zero', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Item',
          quantityPerDriver: 0.01,
          wastePercentBp: 0,
          roundingRule: 'up_to_unit',
          packageSize: 1,
          unitCostCents: 100,
        }),
      ],
    }
    const result = computeTakeoff(assembly, 400)
    expect(componentAt(result, 0).derivation).not.toContain('waste')
  })

  it('mentions package size for up_to_package with non-unit size', () => {
    const assembly: TakeoffAssembly = {
      name: 'Test',
      driverUnit: 'lin ft',
      components: [
        comp({
          name: 'Stick',
          unit: 'lin ft',
          quantityPerDriver: 1,
          wastePercentBp: 0,
          roundingRule: 'up_to_package',
          packageSize: 12.5,
          unitCostCents: 100,
        }),
      ],
    }
    const result = computeTakeoff(assembly, 20)
    expect(componentAt(result, 0).derivation).toContain('pkg of 12.5')
  })
  // The spec states the derivation string is "a requirement, not a nicety" and gives
  // this exact worked example. Assert it verbatim so the format cannot drift.
  it('matches the format the spec specifies, verbatim', () => {
    const assembly: TakeoffAssembly = {
      name: 'Vinyl siding',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Siding',
          unit: 'sq',
          quantityPerDriver: 0.01,
          wastePercentBp: 1000,
          roundingRule: 'up_to_package',
          packageSize: 1,
          unitCostCents: 8999,
        }),
      ],
    }
    const result = computeTakeoff(assembly, 412)
    expect(componentAt(result, 0).derivation).toBe(
      '412 sq ft ÷ 100 = 4.12 sq × 1.10 waste = 4.53 → 5 squares',
    )
  })

  it('reads a per-unit rate as a division only when the reciprocal is whole', () => {
    const assembly: TakeoffAssembly = {
      name: 'Labor',
      driverUnit: 'sq ft',
      components: [
        comp({
          name: 'Lead carpenter',
          unit: 'hour',
          quantityPerDriver: 0.0267,
          wastePercentBp: 0,
          roundingRule: 'exact',
          packageSize: 1,
          unitCostCents: 6500,
        }),
      ],
    }
    // 1 / 0.0267 = 37.45..., not whole, so multiplication is the honest rendering.
    expect(componentAt(computeTakeoff(assembly, 412), 0).derivation).toContain('× 0.0267')
  })
})
