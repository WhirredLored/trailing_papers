import { describe, expect, it } from 'vitest'
import { assertCents, formatCents } from './money'

describe('money', () => {
  it('formats integer cents as currency', () => {
    expect(formatCents(125000)).toBe('$1,250.00')
    expect(formatCents(0)).toBe('$0.00')
    expect(formatCents(-4999)).toBe('-$49.99')
  })

  it('rejects a float where cents are expected', () => {
    expect(() => assertCents(12.5)).toThrow(TypeError)
    expect(() => formatCents(0.1 + 0.2)).toThrow(TypeError)
  })
})
