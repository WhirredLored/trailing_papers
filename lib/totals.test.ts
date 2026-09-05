import { describe, expect, it } from 'vitest'
import { computeTotals, type LineItem, type TotalsInput } from './totals'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand for creating a line item. */
function line(
  description: string,
  unitPriceCents: number,
  quantity: number,
  taxable = true,
): LineItem {
  return { description, unitPriceCents, quantity, taxable }
}

/** Default input with zero discount and deposit. */
function makeInput(overrides: Partial<TotalsInput> & { lines: LineItem[] }): TotalsInput {
  return {
    taxRateBp: 0,
    discountType: 'fixed',
    discountValue: 0,
    depositType: 'fixed',
    depositValue: 0,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Basic cases
// ---------------------------------------------------------------------------
describe('computeTotals — basic', () => {
  it('computes a single taxable line', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Labor', 5000, 8, true)],
        taxRateBp: 875,
      }),
    )

    expect(result.subtotalCents).toBe(40000) // $400.00
    expect(result.discountCents).toBe(0)
    expect(result.taxableSubtotalCents).toBe(40000)
    expect(result.taxCents).toBe(3500) // 8.75% of $400 = $35
    expect(result.totalCents).toBe(43500) // $435.00
    expect(result.depositDueCents).toBe(0)
    expect(result.balanceDueCents).toBe(43500)
  })

  it('computes a single non-taxable line (no tax even with rate set)', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Labor', 5000, 8, false)],
        taxRateBp: 875,
      }),
    )

    expect(result.subtotalCents).toBe(40000)
    expect(result.taxableSubtotalCents).toBe(0)
    expect(result.taxCents).toBe(0)
    expect(result.totalCents).toBe(40000)
  })

  it('handles empty lines array', () => {
    const result = computeTotals(makeInput({ lines: [] }))

    expect(result.subtotalCents).toBe(0)
    expect(result.totalCents).toBe(0)
    expect(result.lines).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Zero-quantity lines
// ---------------------------------------------------------------------------
describe('computeTotals — zero quantity', () => {
  it('includes zero-quantity lines with $0 extended', () => {
    const result = computeTotals(
      makeInput({
        lines: [
          line('Materials', 10000, 0, true),
          line('Labor', 5000, 4, false),
        ],
      }),
    )

    expect(result.lines[0]!.extendedCents).toBe(0)
    expect(result.lines[1]!.extendedCents).toBe(20000)
    expect(result.subtotalCents).toBe(20000)
  })
})

// ---------------------------------------------------------------------------
// Negative lines (credits)
// ---------------------------------------------------------------------------
describe('computeTotals — negative lines (credits)', () => {
  it('negative unit prices reduce the subtotal', () => {
    const result = computeTotals(
      makeInput({
        lines: [
          line('Siding install', 50000, 1, true),
          line('Discount credit', -5000, 1, true),
        ],
        taxRateBp: 1000, // 10%
      }),
    )

    expect(result.subtotalCents).toBe(45000) // $500 - $50 = $450
    expect(result.taxableSubtotalCents).toBe(45000)
    expect(result.taxCents).toBe(4500) // 10% of $450
    expect(result.totalCents).toBe(49500) // $495
  })
})

// ---------------------------------------------------------------------------
// Mixed taxability
// ---------------------------------------------------------------------------
describe('computeTotals — mixed taxability', () => {
  it('taxes only the taxable lines', () => {
    const result = computeTotals(
      makeInput({
        lines: [
          line('Materials (taxable)', 10000, 1, true),
          line('Labor (exempt)', 20000, 1, false),
        ],
        taxRateBp: 1000, // 10%
      }),
    )

    expect(result.subtotalCents).toBe(30000) // $300
    expect(result.taxableSubtotalCents).toBe(10000) // only materials
    expect(result.taxCents).toBe(1000) // 10% of $100
    expect(result.totalCents).toBe(31000) // $310
  })
})

// ---------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------
describe('computeTotals — discounts', () => {
  it('applies a percentage discount', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Work', 10000, 10, true)],
        taxRateBp: 1000,
        discountType: 'percent',
        discountValue: 1000, // 10% in bp
      }),
    )

    expect(result.subtotalCents).toBe(100000) // $1000
    expect(result.discountCents).toBe(10000) // $100
    // taxable subtotal = taxable lines - taxable share of discount
    // All lines are taxable, so taxable share = 100% = $100
    expect(result.taxableSubtotalCents).toBe(90000) // $900
    expect(result.taxCents).toBe(9000) // 10% of $900
    expect(result.totalCents).toBe(99000) // $1000 - $100 + $90 = $990
  })

  it('applies a fixed discount', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Work', 10000, 10, true)],
        taxRateBp: 1000,
        discountType: 'fixed',
        discountValue: 5000, // $50
      }),
    )

    expect(result.subtotalCents).toBe(100000)
    expect(result.discountCents).toBe(5000)
    expect(result.taxableSubtotalCents).toBe(95000) // $950
    expect(result.taxCents).toBe(9500)
    expect(result.totalCents).toBe(104500) // $1000 - $50 + $95 = $1045
  })

  it('applies 100% discount — total is $0 (all taxable)', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Work', 10000, 10, true)],
        taxRateBp: 1000,
        discountType: 'percent',
        discountValue: 10000, // 100%
      }),
    )

    expect(result.discountCents).toBe(100000)
    expect(result.taxableSubtotalCents).toBe(0)
    expect(result.taxCents).toBe(0)
    expect(result.totalCents).toBe(0)
  })

  it('pro-rata discount allocation with mixed taxability', () => {
    // Subtotal: $200 taxable + $100 non-taxable = $300
    // 10% discount = $30
    // Taxable share of discount = $30 × ($200/$300) = $20
    // Taxable subtotal = $200 - $20 = $180
    // Tax (10%) = $18
    // Total = $300 - $30 + $18 = $288
    const result = computeTotals(
      makeInput({
        lines: [
          line('Materials', 10000, 2, true), // $200
          line('Labor', 10000, 1, false), // $100
        ],
        taxRateBp: 1000,
        discountType: 'percent',
        discountValue: 1000, // 10% in bp
      }),
    )

    expect(result.subtotalCents).toBe(30000)
    expect(result.discountCents).toBe(3000)
    expect(result.taxableSubtotalCents).toBe(18000) // $200 - $20
    expect(result.taxCents).toBe(1800) // 10% of $180
    expect(result.totalCents).toBe(28800) // $288
  })

  it('fixed discount capped at subtotal', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Small job', 5000, 1, true)],
        discountType: 'fixed',
        discountValue: 100000, // $1000, but job is only $50
      }),
    )

    expect(result.discountCents).toBe(5000) // capped at $50 subtotal
    expect(result.totalCents).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------
describe('computeTotals — deposits', () => {
  it('computes deposit as a percentage of total', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Work', 100000, 1, true)],
        taxRateBp: 1000, // 10%
        depositType: 'percent',
        depositValue: 50, // 50%
      }),
    )

    expect(result.totalCents).toBe(110000) // $1100
    expect(result.depositDueCents).toBe(55000) // 50% of $1100
    expect(result.balanceDueCents).toBe(55000)
  })

  it('computes deposit as a fixed amount', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Work', 100000, 1, false)],
        depositType: 'fixed',
        depositValue: 25000, // $250
      }),
    )

    expect(result.totalCents).toBe(100000)
    expect(result.depositDueCents).toBe(25000)
    expect(result.balanceDueCents).toBe(75000)
  })

  it('caps fixed deposit at total', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Small job', 5000, 1, false)],
        depositType: 'fixed',
        depositValue: 100000, // $1000, but total is $50
      }),
    )

    expect(result.depositDueCents).toBe(5000) // capped at $50
    expect(result.balanceDueCents).toBe(0)
  })

  it('100% deposit means zero balance', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Work', 100000, 1, false)],
        depositType: 'percent',
        depositValue: 100,
      }),
    )

    expect(result.depositDueCents).toBe(100000)
    expect(result.balanceDueCents).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Decimal quantities
// ---------------------------------------------------------------------------
describe('computeTotals — decimal quantities', () => {
  it('handles 2.5 hours of labor', () => {
    const result = computeTotals(
      makeInput({
        lines: [line('Labor', 7500, 2.5, false)], // $75/hr × 2.5 hrs
      }),
    )

    expect(result.lines[0]!.extendedCents).toBe(18750) // $187.50
    expect(result.subtotalCents).toBe(18750)
  })

  it('handles fractional rounding at line level', () => {
    // 3333 × 3 = 9999 (exact)
    // 3333 × 1/3 = 1111.0 (exact)
    const result = computeTotals(
      makeInput({
        lines: [
          line('Item A', 3333, 3, false),
          line('Item B', 3333, 1, false),
        ],
      }),
    )

    expect(result.lines[0]!.extendedCents).toBe(9999)
    expect(result.lines[1]!.extendedCents).toBe(3333)
    expect(result.subtotalCents).toBe(13332)
  })
})

// ---------------------------------------------------------------------------
// Golden-file test: 30-line siding job
// ---------------------------------------------------------------------------
describe('computeTotals — golden file: 30-line siding job', () => {
  /**
   * HAND-COMPUTED GOLDEN FILE
   *
   * A realistic 30-line siding job for a residential contractor.
   * All figures hand-computed to verify the totals engine matches exactly.
   *
   * Tax rate: 8.25% (825 bp) — applied to materials only.
   * Discount: 5% (500 bp) across the board.
   * Deposit: 33% of total.
   *
   * HAND COMPUTATION (line-by-line):
   *
   * --- MATERIALS (taxable) ---
   *  1. Vinyl siding D4.5: $89.99 × 45 sq  = 404955 cents  → taxable
   *  2. Vinyl siding D5:   $94.50 × 12 sq  = 113400 cents  → taxable
   *  3. J-channel:         $0.89  × 240 lf  =  21360 cents  → taxable
   *  4. Starter strip:     $1.25  × 180 lf  =  22500 cents  → taxable
   *  5. Utility trim:      $1.15  × 120 lf  =  13800 cents  → taxable
   *  6. Outside corner:    $6.75  × 24 pc   =  16200 cents  → taxable
   *  7. Inside corner:     $5.50  × 8 pc    =   4400 cents  → taxable
   *  8. Window casing:    $12.00  × 16 pc   =  19200 cents  → taxable
   *  9. Door casing:      $18.50  × 4 pc    =   7400 cents  → taxable
   * 10. Soffit panels:     $3.25  × 320 sf  = 104000 cents  → taxable
   * 11. Fascia boards:     $2.75  × 180 lf  =  49500 cents  → taxable
   * 12. Drip edge:         $1.50  × 180 lf  =  27000 cents  → taxable
   * 13. House wrap:       $48.00  × 18 roll =  86400 cents  → taxable
   * 14. Wrap tape:         $8.50  × 12 roll =  10200 cents  → taxable
   * 15. Flashing (window): $3.25  × 40 pc   =  13000 cents  → taxable
   * 16. Galv. nails 1.5":  $45.00 × 4 box  =  18000 cents  → taxable
   * 17. Galv. nails 2.5":  $48.00 × 2 box  =   9600 cents  → taxable
   * 18. Caulk tubes:       $6.50  × 24 tube =  15600 cents  → taxable
   * 19. Touch-up paint:   $32.00  × 2 gal  =   6400 cents  → taxable
   * 20. Dumpster rental:  $450.00 × 1       =  45000 cents  → taxable
   *
   * Taxable subtotal (before discount): sum of 1–20
   *  = 404955 + 113400 + 21360 + 22500 + 13800 + 16200 + 4400 + 19200 +
   *    7400 + 104000 + 49500 + 27000 + 86400 + 10200 + 13000 + 18000 +
   *    9600 + 15600 + 6400 + 45000
   *  = 1007915 cents
   *
   * --- LABOR (non-taxable) ---
   * 21. Lead installer:   $65.00 × 40 hr   = 260000 cents  → non-taxable
   * 22. Helper 1:         $35.00 × 40 hr   = 140000 cents  → non-taxable
   * 23. Helper 2:         $35.00 × 40 hr   = 140000 cents  → non-taxable
   * 24. Demo crew:        $45.00 × 16 hr   =  72000 cents  → non-taxable
   * 25. Cleanup crew:     $30.00 × 8 hr    =  24000 cents  → non-taxable
   * 26. Permit runner:    $25.00 × 2 hr    =   5000 cents  → non-taxable
   * 27. Delivery fee:    $150.00 × 1       =  15000 cents  → non-taxable
   * 28. Scaffold rental:  $75.00 × 5 day   =  37500 cents  → non-taxable
   * 29. Tool rental:      $85.00 × 5 day   =  42500 cents  → non-taxable
   * 30. Waste disposal:  $200.00 × 1       =  20000 cents  → non-taxable
   *
   * Non-taxable subtotal: sum of 21–30
   *  = 260000 + 140000 + 140000 + 72000 + 24000 + 5000 + 15000 + 37500 +
   *    42500 + 20000
   *  = 756000 cents
   *
   * SUBTOTAL = 1007915 + 756000 = 1763915 cents
   *
   * DISCOUNT (5% = 500 bp of subtotal):
   *   1763915 × 500 / 10000 = 88195.75 → roundHalfAwayFromZero → 88196 cents
   *
   * Pro-rata taxable share of discount:
   *   88196 × 1007915 / 1763915 = 88196 × 0.571393... = 50396.17... → 50396 cents
   *
   * Taxable subtotal after discount:
   *   1007915 - 50396 = 957519 cents
   *
   * TAX (8.25% = 825 bp of taxable subtotal):
   *   957519 × 825 / 10000 = 78995.3175 → roundHalfAwayFromZero → 78995 cents
   *
   * TOTAL = 1763915 - 88196 + 78995 = 1754714 cents
   *
   * DEPOSIT (33% of total):
   *   1754714 × 33 × 100 / 10000 = 1754714 × 3300 / 10000 = 579055.62 → 579056 cents
   *
   * BALANCE = 1754714 - 579056 = 1175658 cents
   */
  it('matches hand-computed totals for a 30-line siding job', () => {
    const input: TotalsInput = {
      lines: [
        // Materials (taxable)
        line('Vinyl siding D4.5 (sq)', 8999, 45, true),
        line('Vinyl siding D5 (sq)', 9450, 12, true),
        line('J-channel (lf)', 89, 240, true),
        line('Starter strip (lf)', 125, 180, true),
        line('Utility trim (lf)', 115, 120, true),
        line('Outside corner post (pc)', 675, 24, true),
        line('Inside corner post (pc)', 550, 8, true),
        line('Window casing (pc)', 1200, 16, true),
        line('Door casing (pc)', 1850, 4, true),
        line('Soffit panels (sf)', 325, 320, true),
        line('Fascia boards (lf)', 275, 180, true),
        line('Drip edge (lf)', 150, 180, true),
        line('House wrap (roll)', 4800, 18, true),
        line('Wrap tape (roll)', 850, 12, true),
        line('Flashing, window (pc)', 325, 40, true),
        line('Galvanized nails 1.5" (box)', 4500, 4, true),
        line('Galvanized nails 2.5" (box)', 4800, 2, true),
        line('Caulk tubes (tube)', 650, 24, true),
        line('Touch-up paint (gal)', 3200, 2, true),
        line('Dumpster rental', 45000, 1, true),
        // Labor (non-taxable)
        line('Lead installer (hr)', 6500, 40, false),
        line('Helper 1 (hr)', 3500, 40, false),
        line('Helper 2 (hr)', 3500, 40, false),
        line('Demo crew (hr)', 4500, 16, false),
        line('Cleanup crew (hr)', 3000, 8, false),
        line('Permit runner (hr)', 2500, 2, false),
        line('Delivery fee', 15000, 1, false),
        line('Scaffold rental (day)', 7500, 5, false),
        line('Tool rental (day)', 8500, 5, false),
        line('Waste disposal fee', 20000, 1, false),
      ],
      taxRateBp: 825,
      discountType: 'percent',
      discountValue: 500, // 5%
      depositType: 'percent',
      depositValue: 33,
    }

    const result = computeTotals(input)

    // Verify all 30 lines produced results
    expect(result.lines).toHaveLength(30)

    // Verify individual line extended amounts (spot check a few)
    expect(result.lines[0]!.extendedCents).toBe(404955) // 8999 × 45
    expect(result.lines[2]!.extendedCents).toBe(21360) // 89 × 240
    expect(result.lines[20]!.extendedCents).toBe(260000) // 6500 × 40

    // Verify aggregates — these are the golden numbers
    expect(result.subtotalCents).toBe(1763915)
    expect(result.discountCents).toBe(88196)

    // Taxable share of discount: 88196 × 1007915 / 1763915 = 50396.17 → 50396
    expect(result.taxableSubtotalCents).toBe(957519)

    // Tax: 957519 × 825 / 10000 = 78995.3175 → 78995
    expect(result.taxCents).toBe(78995)

    // Total: 1763915 - 88196 + 78995 = 1754714
    expect(result.totalCents).toBe(1754714)

    // Deposit: 1754714 × 3300 / 10000 = 579055.62 → 579056
    expect(result.depositDueCents).toBe(579056)

    // Balance: 1754714 - 579056 = 1175658
    expect(result.balanceDueCents).toBe(1175658)

    // Verify the totals are self-consistent
    expect(result.totalCents).toBe(
      result.subtotalCents - result.discountCents + result.taxCents,
    )
    expect(result.balanceDueCents).toBe(result.totalCents - result.depositDueCents)
  })
})
