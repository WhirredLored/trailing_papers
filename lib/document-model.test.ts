/**
 * Tests for buildEstimateDocumentModel — the pure function that turns stored
 * rows into what a client actually reads.
 *
 * It had no coverage at all, which is how two of the findings from C09's first
 * browser pass reached a rendered page: the tax line could not be reconciled
 * from the figures printed beside it, and an optional line stated no amount.
 * Both live here, both are pure, and both are cheap to pin.
 */
import { describe, expect, it } from 'vitest'
import { buildEstimateDocumentModel, type EstimateDocumentInput } from '@/lib/document-server'
import type { Tables } from '@/types/db'

const COMPANY_ID = '00000000-0000-4000-8000-00000000c0de'
const ESTIMATE_ID = '00000000-0000-4000-8000-00000000e571'
const NOW = '2026-09-12T17:00:00+00:00'

const company: Tables<'company'> = {
  address_line1: '412 Contractor Row',
  address_line2: null,
  city: 'Bellingham',
  created_at: NOW,
  currency: 'USD',
  dba: null,
  default_tax_bp: 875,
  deleted_at: null,
  deleted_by: null,
  deposit_fixed_cents: null,
  deposit_pct: 30,
  email: 'office@ridgeline.test',
  id: COMPANY_ID,
  insurance_carrier: null,
  insurance_expires_at: null,
  insurance_policy: null,
  legal_name: 'Ridgeline Exteriors LLC',
  license_expires_at: null,
  license_number: null,
  logo_path: null,
  name: 'DEMO — Ridgeline Exteriors',
  payment_terms_days: 30,
  phone: '(360) 555-0142',
  state: 'WA',
  tax_id: null,
  updated_at: NOW,
  website: null,
  zip: '98225',
}

const baseEstimate: Tables<'estimate'> = {
  balance_due_cents: 18233,
  company_id: COMPANY_ID,
  created_at: NOW,
  created_by: null,
  deleted_at: null,
  deleted_by: null,
  deposit_due_cents: 7814,
  deposit_mode: 'percent',
  deposit_value: 30,
  detail_level: 'itemized',
  discount_cents: 0,
  discount_mode: 'percent',
  discount_value: 0,
  estimated_cost_cents: 0,
  expires_at: null,
  id: ESTIMATE_ID,
  internal_notes: 'Not for client eyes.',
  issued_at: NOW,
  margin_bp: 0,
  margin_cents: 0,
  notes_to_client: null,
  pdf_document_id: null,
  pricing_bp: 0,
  pricing_mode: 'markup',
  project_id: '00000000-0000-4000-8000-0000000940b1',
  revised_from_estimate_id: null,
  status: 'issued',
  subtotal_cents: 24474,
  superseded_by_estimate_id: null,
  // The labour line is untaxed, so the taxable base is BELOW the subtotal.
  taxable_subtotal_cents: 17974,
  tax_cents: 1573,
  tax_rate_bp: 875,
  terms: null,
  title: null,
  total_cents: 26047,
  updated_at: NOW,
  version: 1,
}

function line(over: Partial<Tables<'estimate_line'>>): Tables<'estimate_line'> {
  return {
    assembly_group_id: null,
    assembly_id: null,
    catalog_item_id: null,
    company_id: COMPANY_ID,
    created_at: NOW,
    created_by: null,
    derivation: null,
    description: 'A line',
    driver_quantity: null,
    estimate_id: ESTIMATE_ID,
    group_label: null,
    id: '00000000-0000-4000-8000-00000000line',
    is_optional: false,
    is_selected: false,
    kind: 'material',
    quantity: 1,
    sort_order: 0,
    taxable: true,
    unit: 'ea',
    unit_cost_cents: 0,
    unit_price_cents: 1000,
    updated_at: NOW,
    ...over,
  }
}

function build(over: Partial<EstimateDocumentInput> = {}) {
  return buildEstimateDocumentModel({
    estimate: baseEstimate,
    lines: [line({ description: 'Lead installer', kind: 'labor', unit: 'hour', taxable: false })],
    company,
    client: null,
    property: null,
    projectTitle: 'Siding replacement',
    numberText: 'EST-0001',
    logo: null,
    ...over,
  })
}

const labelsOf = (model: ReturnType<typeof build>) => model.totals.map((t) => t.label)

describe('buildEstimateDocumentModel — totals', () => {
  it('discloses the taxable base when it differs from the subtotal', () => {
    // The defect this pins: the page printed Subtotal 244.74 and Tax (8.75%)
    // 15.73, and 244.74 × 8.75% is 21.41. Every figure was correct — the base
    // the tax was charged on was simply never stated, so the document could not
    // be reconciled by the person it is written for.
    const model = build()

    expect(labelsOf(model)).toContain('Taxable subtotal')

    const taxable = model.totals.find((t) => t.label === 'Taxable subtotal')
    expect(taxable?.amountCents).toBe(17974)

    // And it reconciles: base × rate, rounded, is the tax actually printed.
    const tax = model.totals.find((t) => t.label.startsWith('Tax ('))
    expect(Math.round(17974 * 0.0875)).toBe(tax?.amountCents)
  })

  it('orders the taxable base immediately before the tax it explains', () => {
    const labels = labelsOf(build())
    expect(labels.indexOf('Taxable subtotal')).toBe(labels.findIndex((l) => l.startsWith('Tax (')) - 1)
  })

  it('omits the row when everything is taxable, rather than repeating the subtotal', () => {
    // A row that always restates the line above is noise, and this document is
    // read by clients.
    const model = build({
      estimate: { ...baseEstimate, taxable_subtotal_cents: baseEstimate.subtotal_cents },
    })
    expect(labelsOf(model)).not.toContain('Taxable subtotal')
  })

  it('compares against the post-discount base, not the raw subtotal', () => {
    // With a discount, the taxable base legitimately equals subtotal - discount;
    // comparing against the raw subtotal would print a redundant row.
    const model = build({
      estimate: {
        ...baseEstimate,
        discount_cents: 2000,
        taxable_subtotal_cents: baseEstimate.subtotal_cents - 2000,
      },
    })
    expect(labelsOf(model)).not.toContain('Taxable subtotal')
  })
})

describe('buildEstimateDocumentModel — optional lines', () => {
  it('carries an optional line amount so the renderer can state what it costs', () => {
    // The renderer used to print the word "optional" INSTEAD of a figure, so the
    // price of the upsell appeared nowhere on an itemized document — and it can
    // exceed the job total. The model must at least carry it.
    const model = build({
      lines: [
        line({ description: 'Siding', quantity: 1, unit_price_cents: 24474 }),
        line({
          description: 'Gutter guards, rear elevation',
          quantity: 40,
          unit: 'lin_ft',
          unit_price_cents: 650,
          is_optional: true,
        }),
      ],
    })

    const optional = model.lines.find((l) => l.isOptional)
    expect(optional).toBeDefined()
    expect(optional?.amountCents).toBe(26000)
  })

  it('keeps optional lines out of the subtotal', () => {
    const model = build({
      lines: [line({ description: 'Gutter guards', quantity: 40, unit_price_cents: 650, is_optional: true })],
    })
    // The frozen subtotal is authoritative and unchanged by an optional line.
    expect(model.totals.find((t) => t.label === 'Subtotal')?.amountCents).toBe(24474)
  })
})
