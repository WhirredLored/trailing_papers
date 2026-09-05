import { describe, expect, it } from 'vitest'
import { recomputeAndAssert } from './recompute'
import type { TotalsInput } from './totals'

const sampleInput: TotalsInput = {
  lines: [
    { description: 'Labor', unitPriceCents: 5000, quantity: 8, taxable: false },
    { description: 'Materials', unitPriceCents: 10000, quantity: 3, taxable: true },
  ],
  taxRateBp: 1000, // 10%
  discountType: 'fixed',
  discountValue: 0,
  depositType: 'fixed',
  depositValue: 0,
}

describe('recomputeAndAssert', () => {
  it('returns breakdown when client total matches server total', () => {
    // Subtotal: 40000 + 30000 = 70000
    // Tax: 10% of 30000 (only materials are taxable) = 3000
    // Total: 73000
    const breakdown = recomputeAndAssert(73000, sampleInput)

    expect(breakdown.totalCents).toBe(73000)
    expect(breakdown.subtotalCents).toBe(70000)
    expect(breakdown.taxCents).toBe(3000)
  })

  it('throws when client total does not match', () => {
    expect(() => recomputeAndAssert(99999, sampleInput)).toThrow(
      /Total mismatch.*client sent 99999.*server computed 73000/,
    )
  })

  it('throws with a message referencing Law 4', () => {
    expect(() => recomputeAndAssert(0, sampleInput)).toThrow(/Law 4/)
  })

  it('works with zero-total estimate (100% discount)', () => {
    const zeroInput: TotalsInput = {
      ...sampleInput,
      discountType: 'percent',
      discountValue: 10000, // 100%
    }
    const breakdown = recomputeAndAssert(0, zeroInput)
    expect(breakdown.totalCents).toBe(0)
  })
})
