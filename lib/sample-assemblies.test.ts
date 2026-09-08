import { describe, expect, it } from 'vitest'
import { SAMPLE_ASSEMBLIES } from './sample-assemblies'
import { computeTakeoff, type TakeoffAssembly } from './takeoff'

/**
 * Known-answer takeoffs for every seeded assembly.
 *
 * These import the same SAMPLE_ASSEMBLIES the seed script writes to the database,
 * so a change to a waste factor or package size fails here rather than silently
 * altering what a contractor gets seeded.
 *
 * Unit costs mirror the C06 sample catalog. They are fixtures here: the assertions
 * that matter are the purchase quantities, which are what a contractor actually buys.
 */

const UNIT_COST_CENTS: Record<string, { unit: string; cents: number }> = {
  'LAB-DEMO': { unit: 'hour', cents: 4500 },
  'LAB-CLEAN': { unit: 'hour', cents: 3000 },
  'LAB-HELP': { unit: 'hour', cents: 3500 },
  'LAB-LEAD': { unit: 'hour', cents: 6500 },
  'OTH-DUMP': { unit: 'ea', cents: 45000 },
  'WRP-TYVEK': { unit: 'ea', cents: 4800 },
  'WRP-TAPE': { unit: 'ea', cents: 850 },
  'FST-NAIL15': { unit: 'ea', cents: 4500 },
  'FST-CAULK': { unit: 'ea', cents: 650 },
  'INS-FANFOLD': { unit: 'sq', cents: 3200 },
  'TRIM-JCHAN': { unit: 'lin ft', cents: 89 },
  'TRIM-START': { unit: 'lin ft', cents: 125 },
  'TRIM-WCASE': { unit: 'ea', cents: 1200 },
  'SID-D45': { unit: 'sq', cents: 8999 },
}

const DRIVER_LABELS: Record<string, string> = {
  sq_ft: 'sq ft',
  lin_ft: 'lin ft',
  ea: 'ea',
  sq: 'sq',
  opening: 'opening',
}

function build(name: string): TakeoffAssembly {
  const spec = SAMPLE_ASSEMBLIES.find((a) => a.name === name)
  if (!spec) throw new Error(`No sample assembly named ${name}`)
  return {
    name: spec.name,
    driverUnit: DRIVER_LABELS[spec.driverUnit] ?? spec.driverUnit,
    components: spec.components.map((c) => {
      const item = UNIT_COST_CENTS[c.code]
      if (!item) throw new Error(`No fixture price for catalog code ${c.code}`)
      return {
        name: c.code,
        unit: item.unit,
        quantityPerDriver: c.quantityPerDriver,
        wastePercentBp: c.wastePercentBp,
        roundingRule: c.roundingRule,
        packageSize: c.packageSize ?? 1,
        unitCostCents: item.cents,
      }
    }),
  }
}

/** Expected purchase quantities, hand-computed from the seeded rates. */
const CASES: Array<{ assembly: string; driver: number; expected: Record<string, number> }> = [
  {
    assembly: 'Demo - strip existing siding',
    driver: 370,
    // 370 x 0.012 = 4.44 -> 4 hr; 370 x 0.0004 = 0.148 -> 1 dumpster; 1.48 -> 1 hr
    expected: { 'LAB-DEMO': 4, 'OTH-DUMP': 1, 'LAB-CLEAN': 1 },
  },
  {
    assembly: 'Water barrier - house wrap',
    driver: 370,
    expected: { 'WRP-TYVEK': 1, 'WRP-TAPE': 1, 'FST-NAIL15': 1, 'LAB-HELP': 3 },
  },
  {
    assembly: 'Backerboard - fanfold insulation',
    driver: 370,
    // 3.7 sq x 1.05 waste = 3.885 -> 4 squares
    expected: { 'INS-FANFOLD': 4, 'FST-NAIL15': 1, 'LAB-HELP': 4 },
  },
  {
    assembly: 'J-channel and trim-out',
    driver: 100,
    // 100 x 1.10 = 110 lin ft -> ceil(110 / 12.5) = 9 sticks -> 112.5 lin ft
    expected: { 'TRIM-JCHAN': 112.5, 'FST-NAIL15': 1, 'LAB-LEAD': 5 },
  },
  {
    assembly: 'Vinyl siding - D4.5 clapboard',
    driver: 370,
    expected: { 'SID-D45': 5, 'TRIM-START': 50, 'FST-NAIL15': 1, 'LAB-LEAD': 9, 'LAB-HELP': 7 },
  },
  {
    assembly: 'Trim - window and door openings',
    driver: 8,
    // 8 openings: one casing each, one tube per four, 45 min each
    expected: { 'TRIM-WCASE': 8, 'FST-CAULK': 2, 'LAB-LEAD': 6 },
  },
]

describe('seeded sample assemblies', () => {
  it('seeds exactly the six exterior phases the product targets', () => {
    expect(SAMPLE_ASSEMBLIES.map((a) => a.name)).toEqual([
      'Demo - strip existing siding',
      'Water barrier - house wrap',
      'Backerboard - fanfold insulation',
      'J-channel and trim-out',
      'Vinyl siding - D4.5 clapboard',
      'Trim - window and door openings',
    ])
  })

  it('marks every assembly as sample data', () => {
    for (const a of SAMPLE_ASSEMBLIES) {
      expect(a.description).toContain('SAMPLE DATA')
    }
  })

  it('keeps every rate within the numeric(12,4) column precision', () => {
    for (const a of SAMPLE_ASSEMBLIES) {
      for (const c of a.components) {
        const scaled = c.quantityPerDriver * 10000
        expect(
          Math.abs(scaled - Math.round(scaled)),
          `${a.name} / ${c.code} rate ${c.quantityPerDriver} exceeds 4dp`,
        ).toBeLessThan(1e-6)
      }
    }
  })

  it('only uses package_size where the rounding rule consumes it', () => {
    for (const a of SAMPLE_ASSEMBLIES) {
      for (const c of a.components) {
        if (c.packageSize !== undefined && c.packageSize !== 1) {
          expect(c.roundingRule, `${a.name} / ${c.code}`).toBe('up_to_package')
        }
      }
    }
  })

  for (const testCase of CASES) {
    describe(testCase.assembly, () => {
      const result = computeTakeoff(build(testCase.assembly), testCase.driver)

      it('produces the hand-computed purchase quantities', () => {
        const actual = Object.fromEntries(
          result.components.map((c) => [c.name, c.purchaseQuantity]),
        )
        expect(actual).toEqual(testCase.expected)
      })

      it('shows a derivation for every component', () => {
        for (const c of result.components) {
          expect(c.derivation, c.name).toBeTruthy()
          expect(c.derivation).toContain(String(testCase.driver))
        }
      })

      it('totals the components exactly', () => {
        const sum = result.components.reduce((acc, c) => acc + c.extendedCostCents, 0)
        expect(result.totalCostCents).toBe(sum)
      })
    })
  }
})
