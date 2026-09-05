import { describe, expect, it } from 'vitest'
import {
  addCents,
  applyMarkup,
  applyMargin,
  applyPercent,
  assertCents,
  formatCents,
  formatCentsPlain,
  isCents,
  multiplyCents,
  parseCents,
  percentOfCents,
  roundHalfAwayFromZero,
  subtractCents,
  sumCents,
} from './money'

// ---------------------------------------------------------------------------
// roundHalfAwayFromZero
// ---------------------------------------------------------------------------
describe('roundHalfAwayFromZero', () => {
  it('rounds positive halves up (away from zero)', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1)
    expect(roundHalfAwayFromZero(1.5)).toBe(2)
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
  })

  it('rounds negative halves down (away from zero)', () => {
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1)
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2)
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3)
  })

  it('rounds non-halves normally', () => {
    expect(roundHalfAwayFromZero(0.4)).toBe(0)
    expect(roundHalfAwayFromZero(0.6)).toBe(1)
    expect(roundHalfAwayFromZero(-0.4)).toBe(0)
    expect(roundHalfAwayFromZero(-0.6)).toBe(-1)
  })

  it('passes through integers unchanged', () => {
    expect(roundHalfAwayFromZero(0)).toBe(0)
    expect(roundHalfAwayFromZero(42)).toBe(42)
    expect(roundHalfAwayFromZero(-7)).toBe(-7)
  })
})

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------
describe('assertCents', () => {
  it('passes for integers', () => {
    expect(() => assertCents(0)).not.toThrow()
    expect(() => assertCents(100)).not.toThrow()
    expect(() => assertCents(-500)).not.toThrow()
  })

  it('rejects a float where cents are expected', () => {
    expect(() => assertCents(12.5)).toThrow(TypeError)
    expect(() => assertCents(0.1 + 0.2)).toThrow(TypeError)
  })
})

describe('isCents', () => {
  it('returns true for integers', () => {
    expect(isCents(0)).toBe(true)
    expect(isCents(100)).toBe(true)
    expect(isCents(-42)).toBe(true)
  })

  it('returns false for floats', () => {
    expect(isCents(12.5)).toBe(false)
    expect(isCents(0.1)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// parseCents
// ---------------------------------------------------------------------------
describe('parseCents', () => {
  it('parses dollar amount with cents', () => {
    expect(parseCents('1250.50')).toBe(125050)
  })

  it('parses dollar amount with dollar sign', () => {
    expect(parseCents('$1,250.50')).toBe(125050)
  })

  it('parses dollar amount with commas', () => {
    expect(parseCents('1,250.50')).toBe(125050)
  })

  it('parses single-digit cents', () => {
    expect(parseCents('1250.5')).toBe(125050)
  })

  it('parses whole dollars (no decimal)', () => {
    expect(parseCents('100')).toBe(10000)
    expect(parseCents('$100')).toBe(10000)
  })

  it('parses zero', () => {
    expect(parseCents('0')).toBe(0)
    expect(parseCents('$0')).toBe(0)
    expect(parseCents('$0.00')).toBe(0)
  })

  it('parses negative values', () => {
    expect(parseCents('-49.99')).toBe(-4999)
    expect(parseCents('-$49.99')).toBe(-4999)
  })

  it('parses large amounts', () => {
    expect(parseCents('$1,000,000.00')).toBe(100000000)
  })

  it('parses trailing dot (no fractional)', () => {
    expect(parseCents('100.')).toBe(10000)
  })

  it('rounds sub-cent amounts using round-half-away-from-zero', () => {
    // 1.005 → the 0 in "00" and the 5 in the third decimal
    // That's 100 cents + round(0.5) = 101
    expect(parseCents('1.005')).toBe(101)
    // 1.004 → 100 cents + round(0.4) = 100
    expect(parseCents('1.004')).toBe(100)
  })

  it('rejects empty strings', () => {
    expect(() => parseCents('')).toThrow(TypeError)
    expect(() => parseCents('   ')).toThrow(TypeError)
  })

  it('rejects non-numeric content', () => {
    expect(() => parseCents('abc')).toThrow(TypeError)
    expect(() => parseCents('$abc')).toThrow(TypeError)
    expect(() => parseCents('12.34.56')).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// formatCents
// ---------------------------------------------------------------------------
describe('formatCents', () => {
  it('formats integer cents as currency', () => {
    expect(formatCents(125000)).toBe('$1,250.00')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(-4999)).toBe('-$49.99')
  })

  it('formats single cents correctly', () => {
    expect(formatCents(1)).toBe('$0.01')
    expect(formatCents(99)).toBe('$0.99')
  })
})

// ---------------------------------------------------------------------------
// formatCentsPlain
// ---------------------------------------------------------------------------
describe('formatCentsPlain', () => {
  it('formats without currency symbol', () => {
    expect(formatCentsPlain(125000)).toBe('1,250.00')
    expect(formatCentsPlain(0)).toBe('0.00')
    expect(formatCentsPlain(-4999)).toBe('-49.99')
  })
})

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------
describe('addCents', () => {
  it('adds multiple values', () => {
    expect(addCents(100, 200, 300)).toBe(600)
  })

  it('handles negatives (credits)', () => {
    expect(addCents(1000, -250)).toBe(750)
  })

  it('returns 0 for empty args', () => {
    expect(addCents()).toBe(0)
  })

  it('rejects floats', () => {
    expect(() => addCents(12.5)).toThrow(TypeError)
  })
})

describe('subtractCents', () => {
  it('subtracts b from a', () => {
    expect(subtractCents(1000, 250)).toBe(750)
  })

  it('produces negative result if b > a', () => {
    expect(subtractCents(100, 500)).toBe(-400)
  })
})

describe('multiplyCents', () => {
  it('multiplies by an integer quantity', () => {
    expect(multiplyCents(1500, 3)).toBe(4500)
  })

  it('multiplies by a decimal quantity (e.g. 2.5 hours)', () => {
    expect(multiplyCents(5000, 2.5)).toBe(12500)
  })

  it('rounds half away from zero for fractional results', () => {
    // 3 cents × 1/3 = 1.0 — no rounding needed
    expect(multiplyCents(3, 1)).toBe(3)
    // 1 cent × 0.5 = 0.5 → rounds to 1
    expect(multiplyCents(1, 0.5)).toBe(1)
    // -1 cent × 0.5 = -0.5 → rounds to -1
    expect(multiplyCents(-1, 0.5)).toBe(-1)
  })

  it('handles zero quantity', () => {
    expect(multiplyCents(5000, 0)).toBe(0)
  })

  it('rejects non-finite quantity', () => {
    expect(() => multiplyCents(100, Infinity)).toThrow(TypeError)
    expect(() => multiplyCents(100, NaN)).toThrow(TypeError)
  })
})

describe('sumCents', () => {
  it('sums an array', () => {
    expect(sumCents([100, 200, 300])).toBe(600)
  })

  it('returns 0 for empty array', () => {
    expect(sumCents([])).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Percentage operations
// ---------------------------------------------------------------------------
describe('applyPercent', () => {
  it('computes 8.75% tax (875 bp) on $100', () => {
    // $100.00 = 10000 cents, 8.75% = 875 cents
    expect(applyPercent(10000, 875)).toBe(875)
  })

  it('computes 8.75% tax on $123.45', () => {
    // 12345 × 875 / 10000 = 1080.1875 → 1080
    expect(applyPercent(12345, 875)).toBe(1080)
  })

  it('handles 100% (10000 bp)', () => {
    expect(applyPercent(5000, 10000)).toBe(5000)
  })

  it('handles 0% (0 bp)', () => {
    expect(applyPercent(5000, 0)).toBe(0)
  })

  it('handles 50% on odd cent (rounding)', () => {
    // 5001 × 5000 / 10000 = 2500.5 → 2501 (half away from zero)
    expect(applyPercent(5001, 5000)).toBe(2501)
  })

  it('handles negative amount (credit)', () => {
    // -10000 × 875 / 10000 = -875
    expect(applyPercent(-10000, 875)).toBe(-875)
  })

  it('rejects non-integer basis points', () => {
    expect(() => applyPercent(10000, 8.75)).toThrow(TypeError)
  })
})

describe('percentOfCents', () => {
  it('computes the percentage a part is of a whole', () => {
    // 875 is 8.75% of 10000 = 875 bp
    expect(percentOfCents(875, 10000)).toBe(875)
  })

  it('returns 0 when whole is 0 (avoid division by zero)', () => {
    expect(percentOfCents(100, 0)).toBe(0)
  })

  it('computes 100% correctly', () => {
    expect(percentOfCents(5000, 5000)).toBe(10000)
  })
})

// ---------------------------------------------------------------------------
// Markup vs Margin
// ---------------------------------------------------------------------------
describe('applyMarkup', () => {
  it('applies 20% markup to $100 cost', () => {
    // price = 10000 × (1 + 2000/10000) = 10000 × 1.2 = 12000
    expect(applyMarkup(10000, 2000)).toBe(12000)
  })

  it('applies 0% markup (no change)', () => {
    expect(applyMarkup(10000, 0)).toBe(10000)
  })

  it('rounds correctly on fractional result', () => {
    // 3333 × (1 + 1000/10000) = 3333 × 1.1 = 3666.3 → 3666
    expect(applyMarkup(3333, 1000)).toBe(3666)
  })
})

describe('applyMargin', () => {
  it('applies 20% margin to $100 cost', () => {
    // price = 10000 / (1 - 2000/10000) = 10000 / 0.8 = 12500
    expect(applyMargin(10000, 2000)).toBe(12500)
  })

  it('produces a DIFFERENT result than markup with the same inputs', () => {
    const markup = applyMarkup(10000, 2000)
    const margin = applyMargin(10000, 2000)
    expect(markup).toBe(12000) // markup: $120
    expect(margin).toBe(12500) // margin: $125
    expect(markup).not.toBe(margin)
  })

  it('applies 0% margin (no change)', () => {
    expect(applyMargin(10000, 0)).toBe(10000)
  })

  it('throws on 100% margin (infinite price)', () => {
    expect(() => applyMargin(10000, 10000)).toThrow(RangeError)
  })

  it('throws on >100% margin', () => {
    expect(() => applyMargin(10000, 15000)).toThrow(RangeError)
  })

  it('throws on negative margin', () => {
    expect(() => applyMargin(10000, -500)).toThrow(RangeError)
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parse → format
// ---------------------------------------------------------------------------
describe('round-trip', () => {
  it('parse then format preserves value', () => {
    const cents = parseCents('$1,250.50')
    expect(formatCents(cents)).toBe('$1,250.50')
  })

  it('negative round-trip', () => {
    const cents = parseCents('-$49.99')
    expect(formatCents(cents)).toBe('-$49.99')
  })
})
