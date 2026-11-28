import { describe, expect, it } from 'vitest'
import {
  assertNoInternalCostLeaks,
  generateShareToken,
  hashShareToken,
  type ClientDocumentPayload,
} from './share-server'

describe('share-server — token generation & hashing', () => {
  it('generates a 64-char hex token and a valid 64-char hex sha256 hash', () => {
    const { rawToken, tokenHash } = generateShareToken()
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/)
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(hashShareToken(rawToken)).toBe(tokenHash)
  })

  it('hashing is deterministic', () => {
    const sample = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    const hash1 = hashShareToken(sample)
    const hash2 = hashShareToken(sample)
    expect(hash1).toBe(hash2)
  })

  it('different tokens produce different hashes', () => {
    const tokenA = generateShareToken().rawToken
    const tokenB = generateShareToken().rawToken
    expect(hashShareToken(tokenA)).not.toBe(hashShareToken(tokenB))
  })
})

describe('share-server — zero internal leaks (C10 item 5 & acceptance)', () => {
  it('catches unit_cost in serialized payloads', () => {
    const leaked = JSON.stringify({ description: '2x4 lumber', unit_cost_cents: 400 })
    expect(() => assertNoInternalCostLeaks(leaked)).toThrow(/unit_cost/)
  })

  it('catches margin and profit in serialized payloads', () => {
    expect(() => assertNoInternalCostLeaks(JSON.stringify({ margin: 25 }))).toThrow(/margin/)
    expect(() => assertNoInternalCostLeaks(JSON.stringify({ target_profit: 50000 }))).toThrow(/profit/)
  })

  it('catches internal_notes in serialized payloads', () => {
    expect(() => assertNoInternalCostLeaks(JSON.stringify({ internal_notes: 'difficult client' }))).toThrow(/internal_note/)
  })

  it('passes a legitimate client document payload', () => {
    const cleanPayload: ClientDocumentPayload = {
      shareLinkId: 'link-123',
      documentNumber: 'EST-0001',
      documentTitle: 'Estimate',
      projectTitle: 'Roof Replacement',
      issuedAt: '2026-11-27T00:00:00.000Z',
      expiresAt: '2026-12-27T00:00:00.000Z',
      letterhead: {
        companyName: 'Acme Roofing LLC',
        dba: null,
        addressLines: ['123 Main St', 'Anytown, NY 12345'],
        phone: '555-1234',
        email: 'info@acme.com',
        website: 'https://acme.com',
        licenseNumber: 'LIC-999',
        insuranceCarrier: 'State Insurance',
        insurancePolicy: 'POL-111',
        logoPath: null,
      },
      client: { heading: 'Client', lines: ['John Doe', '555-9876'] },
      property: { heading: 'Property', lines: ['456 Oak Rd', 'Anytown, NY 12345'] },
      detailLevel: 'itemized',
      lines: [
        {
          description: 'Architectural Shingles (sq)',
          quantity: '25',
          unit: 'sq',
          unitPriceCents: 15000,
          amountCents: 375000,
          derivation: 'roof area 2500 sq ft',
          isOptional: false,
          groupLabel: 'Roofing',
        },
      ],
      groups: [
        {
          label: 'Roofing',
          subtotalCents: 375000,
          optionalCents: 0,
          lineCount: 1,
        },
      ],
      totals: [
        { label: 'Subtotal', amountCents: 375000, emphasis: false },
        { label: 'Total', amountCents: 375000, emphasis: true },
      ],
      terms: 'Standard terms',
      notesToClient: 'Thank you for your business.',
      rawToken: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    }

    const serialized = JSON.stringify(cleanPayload)
    expect(() => assertNoInternalCostLeaks(serialized)).not.toThrow()
  })
})
