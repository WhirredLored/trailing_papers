/**
 * Estimate engine tests.
 *
 * The centrepiece is a single worked example — a siding job with a demo phase
 * and one optional upgrade — carried through every function, with the arithmetic
 * done by hand in the comments. If the engine ever changes behaviour, these
 * numbers say exactly which behaviour changed.
 */

import { describe, expect, it } from 'vitest'
import {
  UNGROUPED_LABEL,
  billableLines,
  computeEstimateTotals,
  computeProfitability,
  isBillable,
  linesFromTakeoff,
  priceFromCost,
  summarizeGroups,
  type EstimateLineDraft,
  type EstimateTerms,
  type TakeoffLineSource,
} from './estimate'
import { computeTakeoff, type TakeoffAssembly } from './takeoff'

// ---------------------------------------------------------------------------
// The worked example
// ---------------------------------------------------------------------------

function line(overrides: Partial<EstimateLineDraft>): EstimateLineDraft {
  return {
    description: 'Line',
    quantity: 1,
    unit: 'ea',
    kind: 'material',
    unitPriceCents: 0,
    unitCostCents: 0,
    taxable: true,
    isOptional: false,
    isSelected: false,
    groupLabel: null,
    ...overrides,
  }
}

/**
 *   Siding  — 5 sq vinyl siding      @ $150.00  = $750.00   (taxable)
 *           — 9 hr lead carpenter    @  $65.00  = $585.00
 *           — 7 hr helper            @  $40.00  = $280.00
 *   Demo    — 6 hr demo & haul       @  $65.00  = $390.00
 *   Extras  — 120 lf gutter guards   @   $4.50  = $540.00   (OPTIONAL, unselected)
 */
function sampleLines(): EstimateLineDraft[] {
  return [
    line({
      description: 'Vinyl siding',
      quantity: 5,
      unit: 'sq',
      kind: 'material',
      unitPriceCents: 15000,
      unitCostCents: 12000,
      taxable: true,
      groupLabel: 'Siding',
    }),
    line({
      description: 'Lead carpenter',
      quantity: 9,
      unit: 'hour',
      kind: 'labor',
      unitPriceCents: 6500,
      unitCostCents: 4500,
      taxable: false,
      groupLabel: 'Siding',
    }),
    line({
      description: 'Helper',
      quantity: 7,
      unit: 'hour',
      kind: 'labor',
      unitPriceCents: 4000,
      unitCostCents: 2800,
      taxable: false,
      groupLabel: 'Siding',
    }),
    line({
      description: 'Demo and haul',
      quantity: 6,
      unit: 'hour',
      kind: 'labor',
      unitPriceCents: 6500,
      unitCostCents: 4500,
      taxable: false,
      groupLabel: 'Demo',
    }),
    line({
      description: 'Gutter guards',
      quantity: 120,
      unit: 'lin_ft',
      kind: 'material',
      unitPriceCents: 450,
      unitCostCents: 300,
      taxable: true,
      isOptional: true,
      isSelected: false,
      groupLabel: 'Extras',
    }),
  ]
}

const TERMS: EstimateTerms = {
  taxRateBp: 875, // 8.75%
  discountMode: 'percent',
  discountValue: 500, // 5%
  depositMode: 'percent',
  depositValue: 30,
}

// ---------------------------------------------------------------------------

describe('optional lines', () => {
  it('a non-optional line is always billable', () => {
    expect(isBillable(line({ isOptional: false, isSelected: false }))).toBe(true)
  })

  it('an unselected optional line is not billable', () => {
    expect(isBillable(line({ isOptional: true, isSelected: false }))).toBe(false)
  })

  it('a selected optional line is billable', () => {
    expect(isBillable(line({ isOptional: true, isSelected: true }))).toBe(true)
  })

  it('billableLines drops the unselected optional line', () => {
    const billable = billableLines(sampleLines())
    expect(billable).toHaveLength(4)
    expect(billable.map((l) => l.description)).not.toContain('Gutter guards')
  })
})

describe('computeEstimateTotals', () => {
  it('excludes the unselected optional line from every total', () => {
    const totals = computeEstimateTotals(sampleLines(), TERMS)

    // 75000 + 58500 + 28000 + 39000 = 200500 — the $540 option is not in it.
    expect(totals.breakdown.subtotalCents).toBe(200500)
    // 5% of 200500
    expect(totals.breakdown.discountCents).toBe(10025)
    // Only the siding line is taxable: 75000 less its pro-rata share of the
    // discount (10025 x 75000 / 200500 = 3750) = 71250.
    expect(totals.breakdown.taxableSubtotalCents).toBe(71250)
    // 71250 x 8.75% = 6234.375 -> 6234
    expect(totals.breakdown.taxCents).toBe(6234)
    // 200500 - 10025 + 6234
    expect(totals.breakdown.totalCents).toBe(196709)
    // 30% of 196709 = 59012.7 -> 59013
    expect(totals.breakdown.depositDueCents).toBe(59013)
    expect(totals.breakdown.balanceDueCents).toBe(137696)
  })

  it('still prices the optional line for display, and reports what it would add', () => {
    const totals = computeEstimateTotals(sampleLines(), TERMS)
    expect(totals.lineExtendedCents).toHaveLength(5)
    expect(totals.lineExtendedCents[4]).toBe(54000)
    expect(totals.optionalTotalCents).toBe(54000)
  })

  it('selecting the optional line moves it into the subtotal', () => {
    const lines = sampleLines()
    lines[4] = { ...(lines[4] as EstimateLineDraft), isSelected: true }
    const totals = computeEstimateTotals(lines, TERMS)

    expect(totals.breakdown.subtotalCents).toBe(200500 + 54000)
    expect(totals.optionalTotalCents).toBe(0)
    // The option is taxable, so the tax base grows too.
    expect(totals.breakdown.taxableSubtotalCents).toBeGreaterThan(71250)
  })

  it('an estimate with no lines totals zero rather than throwing', () => {
    const totals = computeEstimateTotals([], TERMS)
    expect(totals.breakdown.totalCents).toBe(0)
    expect(totals.breakdown.depositDueCents).toBe(0)
    expect(totals.optionalTotalCents).toBe(0)
  })

  it('honours a fixed discount and a fixed deposit', () => {
    const totals = computeEstimateTotals(sampleLines(), {
      taxRateBp: 0,
      discountMode: 'fixed',
      discountValue: 50000,
      depositMode: 'fixed',
      depositValue: 100000,
    })
    expect(totals.breakdown.discountCents).toBe(50000)
    expect(totals.breakdown.totalCents).toBe(150500)
    expect(totals.breakdown.depositDueCents).toBe(100000)
  })
})

describe('computeProfitability', () => {
  it('reports cost, margin and margin percent against pre-tax revenue', () => {
    const lines = sampleLines()
    const profit = computeProfitability(lines, computeEstimateTotals(lines, TERMS))

    // 5x12000 + 9x4500 + 7x2800 + 6x4500 = 147100 (the option is excluded)
    expect(profit.estimatedCostCents).toBe(147100)
    // Revenue is subtotal less discount. Sales tax is the state's money.
    expect(profit.revenueCents).toBe(190475)
    expect(profit.marginCents).toBe(43375)
    // 43375 / 190475 = 22.77%
    expect(profit.marginBp).toBe(2277)
  })

  it('groups labour hours by phase', () => {
    const lines = sampleLines()
    const profit = computeProfitability(lines, computeEstimateTotals(lines, TERMS))

    expect(profit.hoursByPhase).toEqual([
      { label: 'Siding', hours: 16 },
      { label: 'Demo', hours: 6 },
    ])
    expect(profit.totalHours).toBe(22)
  })

  it('counts hour-unit labour only — a day-rate line adds cost but no hours', () => {
    const lines = [
      ...sampleLines(),
      line({
        description: 'Sub crew, day rate',
        quantity: 2,
        unit: 'day',
        kind: 'labor',
        unitPriceCents: 90000,
        unitCostCents: 70000,
        taxable: false,
        groupLabel: 'Siding',
      }),
    ]
    const profit = computeProfitability(lines, computeEstimateTotals(lines, TERMS))

    expect(profit.estimatedCostCents).toBe(147100 + 140000)
    expect(profit.hoursByPhase).toEqual([
      { label: 'Siding', hours: 16 },
      { label: 'Demo', hours: 6 },
    ])
  })

  it('files ungrouped labour under the ungrouped label', () => {
    const lines = [
      line({ quantity: 3, unit: 'hour', kind: 'labor', unitPriceCents: 6500, groupLabel: null }),
    ]
    const profit = computeProfitability(lines, computeEstimateTotals(lines, TERMS))
    expect(profit.hoursByPhase).toEqual([{ label: UNGROUPED_LABEL, hours: 3 }])
  })

  it('reports zero margin percent on an estimate with no revenue', () => {
    const profit = computeProfitability([], computeEstimateTotals([], TERMS))
    expect(profit.revenueCents).toBe(0)
    expect(profit.marginBp).toBe(0)
  })
})

describe('summarizeGroups — summary and itemized come from the same rows', () => {
  it('group subtotals add up to the itemized subtotal', () => {
    const lines = sampleLines()
    const groups = summarizeGroups(lines)
    const totals = computeEstimateTotals(lines, TERMS)

    expect(groups).toEqual([
      { label: 'Siding', subtotalCents: 161500, optionalCents: 0, lineCount: 3 },
      { label: 'Demo', subtotalCents: 39000, optionalCents: 0, lineCount: 1 },
      { label: 'Extras', subtotalCents: 0, optionalCents: 54000, lineCount: 1 },
    ])

    const summed = groups.reduce((total, g) => total + g.subtotalCents, 0)
    expect(summed).toBe(totals.breakdown.subtotalCents)
  })

  it('keeps groups in the order they first appear', () => {
    expect(summarizeGroups(sampleLines()).map((g) => g.label)).toEqual([
      'Siding',
      'Demo',
      'Extras',
    ])
  })
})

describe('priceFromCost', () => {
  it('markup and margin are different numbers on the same cost', () => {
    expect(priceFromCost(10000, 'markup', 2000)).toBe(12000)
    expect(priceFromCost(10000, 'margin', 2000)).toBe(12500)
  })

  it('zero markup leaves the cost alone', () => {
    expect(priceFromCost(12345, 'markup', 0)).toBe(12345)
  })
})

describe('linesFromTakeoff', () => {
  const assembly: TakeoffAssembly = {
    name: 'Vinyl siding, per 100 sq ft',
    driverUnit: 'sq ft',
    components: [
      {
        name: 'Vinyl siding square',
        unit: 'sq',
        quantityPerDriver: 0.01,
        wastePercentBp: 1000,
        roundingRule: 'up_to_unit',
        packageSize: 1,
        unitCostCents: 12000,
      },
      {
        name: 'Siding labour',
        unit: 'hour',
        quantityPerDriver: 0.025,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
        packageSize: 1,
        unitCostCents: 4500,
      },
    ],
  }

  const sources: TakeoffLineSource[] = [
    {
      catalogItemId: 'catalog-siding',
      kind: 'material',
      unit: 'sq',
      unitCostCents: 12000,
      taxable: true,
    },
    {
      catalogItemId: 'catalog-labour',
      kind: 'labor',
      unit: 'hour',
      unitCostCents: 4500,
      taxable: false,
    },
  ]

  it('converts a takeoff into priced, grouped, auditable lines', () => {
    const takeoff = computeTakeoff(assembly, 370)
    const lines = linesFromTakeoff(takeoff, sources, {
      assemblyId: 'assembly-1',
      assemblyGroupId: 'group-1',
      pricingMode: 'markup',
      pricingBp: 2500,
    })

    expect(lines).toHaveLength(2)

    // 370 sq ft / 100 = 3.7 sq x 1.10 waste = 4.07 -> 5 squares
    const siding = lines[0] as (typeof lines)[number]
    expect(siding.quantity).toBe(5)
    expect(siding.unitCostCents).toBe(12000)
    expect(siding.unitPriceCents).toBe(15000) // 25% markup
    expect(siding.kind).toBe('material')
    expect(siding.taxable).toBe(true)
    // The group heading defaults to the assembly name — which is the phase.
    expect(siding.groupLabel).toBe('Vinyl siding, per 100 sq ft')
    expect(siding.assemblyId).toBe('assembly-1')
    expect(siding.assemblyGroupId).toBe('group-1')
    expect(siding.driverQuantity).toBe(370)
    // The evidence chain: the derivation travels onto the line.
    expect(siding.derivation).toBe('370 sq ft ÷ 100 = 3.7 sq × 1.10 waste = 4.07 → 5 squares')

    const labour = lines[1] as (typeof lines)[number]
    expect(labour.quantity).toBe(10) // 370 x 0.025 = 9.25 -> 10
    expect(labour.kind).toBe('labor')
    expect(labour.taxable).toBe(false)
  })

  it('honours an explicit group label and an optional group', () => {
    const lines = linesFromTakeoff(computeTakeoff(assembly, 100), sources, {
      assemblyId: 'assembly-1',
      assemblyGroupId: 'group-2',
      groupLabel: 'Rear elevation',
      pricingMode: 'margin',
      pricingBp: 2000,
      isOptional: true,
    })

    expect(lines.every((l) => l.groupLabel === 'Rear elevation')).toBe(true)
    expect(lines.every((l) => l.isOptional && !l.isSelected)).toBe(true)
    // 20% margin on $120.00 cost is $150.00, not the $144.00 a markup would give.
    expect(lines[0]?.unitPriceCents).toBe(15000)
  })

  it('refuses to price components against a mismatched source list', () => {
    expect(() =>
      linesFromTakeoff(computeTakeoff(assembly, 100), [sources[0] as TakeoffLineSource], {
        assemblyId: 'assembly-1',
        assemblyGroupId: 'group-3',
        pricingMode: 'markup',
        pricingBp: 0,
      }),
    ).toThrow(/2 components but 1 catalog sources/)
  })
})
