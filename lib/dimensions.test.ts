/**
 * Tests for lib/dimensions.ts — feet-inches parsing, formatting, and area computation.
 */

import { describe, expect, it } from 'vitest'
import { computeNetArea, formatFeetInches, parseFeetInches } from './dimensions'

// ---------------------------------------------------------------------------
// parseFeetInches
// ---------------------------------------------------------------------------

describe('parseFeetInches', () => {
  // ── Feet and inches with quotes ──────────────────────────────────────────
  it('parses 12\' 6" as 12.5', () => {
    expect(parseFeetInches('12\' 6"')).toBeCloseTo(12.5, 10)
  })

  it('parses 12\'6" (no space) as 12.5', () => {
    expect(parseFeetInches('12\'6"')).toBeCloseTo(12.5, 10)
  })

  it('parses 12\' 6 (no trailing quote) as 12.5', () => {
    expect(parseFeetInches("12' 6")).toBeCloseTo(12.5, 10)
  })

  it('parses 12\'6 (no space, no trailing quote) as 12.5', () => {
    expect(parseFeetInches("12'6")).toBeCloseTo(12.5, 10)
  })

  // ── Feet and inches with ft/in suffixes ─────────────────────────────────
  it('parses 12ft 6in as 12.5', () => {
    expect(parseFeetInches('12ft 6in')).toBeCloseTo(12.5, 10)
  })

  it('parses 12ft6in (no space) as 12.5', () => {
    expect(parseFeetInches('12ft6in')).toBeCloseTo(12.5, 10)
  })

  // ── Feet only ───────────────────────────────────────────────────────────
  it("parses 3' as 3.0", () => {
    expect(parseFeetInches("3'")).toBe(3.0)
  })

  it('parses 3ft as 3.0', () => {
    expect(parseFeetInches('3ft')).toBe(3.0)
  })

  it("parses 10.5' as 10.5", () => {
    expect(parseFeetInches("10.5'")).toBe(10.5)
  })

  // ── Inches only ─────────────────────────────────────────────────────────
  it('parses 6" as 0.5', () => {
    expect(parseFeetInches('6"')).toBeCloseTo(0.5, 10)
  })

  it('parses 6in as 0.5', () => {
    expect(parseFeetInches('6in')).toBeCloseTo(0.5, 10)
  })

  it('parses 3" as 0.25', () => {
    expect(parseFeetInches('3"')).toBeCloseTo(0.25, 10)
  })

  // ── Decimal feet (plain number) ─────────────────────────────────────────
  it('parses 12.5 as 12.5', () => {
    expect(parseFeetInches('12.5')).toBe(12.5)
  })

  it('parses 40 as 40.0', () => {
    expect(parseFeetInches('40')).toBe(40.0)
  })

  it('parses 0 as 0.0', () => {
    expect(parseFeetInches('0')).toBe(0.0)
  })

  // ── Edge cases ──────────────────────────────────────────────────────────
  it('handles leading/trailing whitespace', () => {
    expect(parseFeetInches("  12' 6\"  ")).toBeCloseTo(12.5, 10)
  })

  it('parses 0\' 0" as 0', () => {
    expect(parseFeetInches('0\' 0"')).toBe(0)
  })

  // ── Invalid input ──────────────────────────────────────────────────────
  it('throws on empty string', () => {
    expect(() => parseFeetInches('')).toThrow(TypeError)
  })

  it('throws on non-string', () => {
    expect(() => parseFeetInches(null as unknown as string)).toThrow(TypeError)
  })

  it('throws on text with no numbers', () => {
    expect(() => parseFeetInches('abc')).toThrow(TypeError)
  })

  it('throws on negative values', () => {
    expect(() => parseFeetInches('-5')).toThrow(TypeError)
  })

  it('throws on inches >= 12 in feet-inches format', () => {
    expect(() => parseFeetInches("5' 13\"")).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// formatFeetInches
// ---------------------------------------------------------------------------

describe('formatFeetInches', () => {
  it('formats 12.5 as 12\' 6"', () => {
    expect(formatFeetInches(12.5)).toBe('12\' 6"')
  })

  it('formats 12.0 as 12\'', () => {
    expect(formatFeetInches(12.0)).toBe("12'")
  })

  it('formats 0.5 as 6"', () => {
    expect(formatFeetInches(0.5)).toBe('6"')
  })

  it('formats 0 as 0\'', () => {
    expect(formatFeetInches(0)).toBe("0'")
  })

  it('formats 12.75 as 12\' 9"', () => {
    expect(formatFeetInches(12.75)).toBe('12\' 9"')
  })

  it('throws on negative', () => {
    expect(() => formatFeetInches(-1)).toThrow(TypeError)
  })

  it('throws on NaN', () => {
    expect(() => formatFeetInches(NaN)).toThrow(TypeError)
  })
})

// ---------------------------------------------------------------------------
// Round-trip: parse → format → parse
// ---------------------------------------------------------------------------

describe('round-trip: parse → format → parse', () => {
  const cases = [
    { input: "12' 6\"", expected: 12.5 },
    { input: "10'", expected: 10.0 },
    { input: '6"', expected: 0.5 },
    { input: '40', expected: 40.0 },
    { input: "12' 9\"", expected: 12.75 },
  ]

  for (const { input, expected } of cases) {
    it(`round-trips "${input}" → ${expected}`, () => {
      const parsed = parseFeetInches(input)
      expect(parsed).toBeCloseTo(expected, 10)
      const formatted = formatFeetInches(parsed)
      const reparsed = parseFeetInches(formatted)
      expect(reparsed).toBeCloseTo(expected, 2)
    })
  }
})

// ---------------------------------------------------------------------------
// computeNetArea
// ---------------------------------------------------------------------------

describe('computeNetArea', () => {
  it('computes gross area for a single wall', () => {
    expect(computeNetArea([{ length: 40, height: 10 }], [])).toBe(400)
  })

  it('subtracts openings from gross area', () => {
    // 40×10 = 400, minus two 3×5 windows = 400 - 30 = 370
    expect(
      computeNetArea(
        [{ length: 40, height: 10 }],
        [
          { width: 3, height: 5 },
          { width: 3, height: 5 },
        ],
      ),
    ).toBe(370)
  })

  it('sums multiple walls', () => {
    expect(
      computeNetArea(
        [
          { length: 40, height: 10 },
          { length: 20, height: 8 },
        ],
        [],
      ),
    ).toBe(560)
  })

  it('never returns negative', () => {
    // Openings larger than wall area
    expect(
      computeNetArea(
        [{ length: 5, height: 5 }],
        [{ width: 10, height: 10 }],
      ),
    ).toBe(0)
  })

  it('returns 0 for empty walls', () => {
    expect(computeNetArea([], [])).toBe(0)
  })
})
