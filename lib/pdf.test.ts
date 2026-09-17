import { describe, expect, it } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { createHash } from 'node:crypto'
import {
  formatDateStable,
  renderDocumentPdf,
  sanitizeForPdf,
  wrapText,
  type DocumentLineRow,
  type DocumentModel,
} from '@/lib/pdf'
import { formatCentsStable } from '@/lib/money'

/**
 * C09 acceptance: a 30-line estimate with a long address renders correctly, and
 * regeneration of an issued version yields a byte-identical hash.
 *
 * These run with no database: the renderer takes a fully-resolved model, which is
 * exactly what makes determinism testable in a unit suite rather than only against
 * the live project.
 */

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

/** How pdf-lib serialises a text string: UTF-16BE, BOM first, as a hex string. */
function utf16beHex(value: string): string {
  let hex = 'FEFF'
  for (let i = 0; i < value.length; i += 1) {
    hex += value.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase()
  }
  return `<${hex}>`
}

/** A long rural address — the acceptance case's "long address". */
const LONG_ADDRESS = [
  '14829 Upper Beaverkill Township Road Northeast',
  'Building C, Rear Entrance Past The Second Gate',
  'Unit 17-B',
  'Mountaindale Springs Junction, NY 12763-4417',
]

function lineRow(index: number): DocumentLineRow {
  return {
    description:
      index % 4 === 0
        ? // A description long enough to wrap several times, which is what would
          // clip into the quantity column if wrapping were wrong.
          `Remove and dispose of existing cedar shingle siding on elevation ${index}, including ` +
          `all fasteners, building paper, and incidental trim; inspect sheathing and report any ` +
          `rot or insect damage before covering (line ${index})`
        : `Install vinyl siding, elevation ${index}`,
    quantity: index % 3 === 0 ? '12.5' : '100',
    unit: index % 3 === 0 ? 'hr' : 'sqft',
    unitPriceCents: 1250 + index * 37,
    amountCents: (1250 + index * 37) * (index % 3 === 0 ? 13 : 100),
    derivation: index % 5 === 0 ? `20 lin ft x 1.10 waste = 22 lin ft` : null,
    isOptional: index === 7 || index === 19,
    groupLabel: index < 10 ? 'Demolition' : index < 20 ? 'Water barrier' : 'Siding',
  }
}

function model(overrides: Partial<DocumentModel> = {}): DocumentModel {
  const lines = Array.from({ length: 30 }, (_, i) => lineRow(i + 1))

  return {
    kind: 'estimate',
    numberText: 'EST-0042',
    documentTitle: 'Estimate',
    projectTitle: 'Full siding replacement, south and west elevations',
    issuedAtISO: '2026-09-17T14:30:00.000Z',
    expiresAtISO: '2026-10-17T14:30:00.000Z',
    letterhead: {
      companyName: 'Whitfield & Sons Exterior Contracting LLC',
      dba: 'Whitfield Siding',
      addressLines: ['2291 Industrial Park Way', 'Suite 140', 'Pawtucket, RI 02860'],
      phone: '(401) 555-0148',
      email: 'office@whitfieldsiding.test',
      website: 'whitfieldsiding.test',
      licenseNumber: 'RI-GC-118842',
      insuranceCarrier: 'Narragansett Mutual',
      insurancePolicy: 'GL-8841203',
      logo: null,
    },
    client: {
      heading: 'Client',
      lines: ['Dana Whitfield-Abernathy', 'dana@example.test', '(401) 555-0199'],
    },
    property: { heading: 'Property', lines: LONG_ADDRESS },
    detailLevel: 'itemized',
    lines,
    groups: [
      { label: 'Demolition', subtotalCents: 412300, optionalCents: 0, lineCount: 10 },
      { label: 'Water barrier', subtotalCents: 288100, optionalCents: 45000, lineCount: 10 },
      { label: 'Siding', subtotalCents: 1904400, optionalCents: 0, lineCount: 10 },
    ],
    totals: [
      { label: 'Subtotal', amountCents: 2604800 },
      { label: 'Discount', amountCents: -130240 },
      { label: 'Tax (7%)', amountCents: 173219 },
      { label: 'Total', amountCents: 2647779, emphasis: true },
      { label: 'Deposit due now', amountCents: 794334, emphasis: true },
      { label: 'Balance on completion', amountCents: 1853445 },
    ],
    terms: 'Payment due within 30 days of completion. Materials remain the property of the contractor until paid in full.',
    notesToClient: 'Access to the rear elevation requires the side gate to be unlocked by 7:30am.',
    showSignatureBlock: true,
    ...overrides,
  }
}

describe('formatDateStable', () => {
  it('formats in UTC with fixed month names', () => {
    expect(formatDateStable('2026-09-17T14:30:00.000Z')).toBe('September 17, 2026')
    expect(formatDateStable('2026-01-01T00:00:00.000Z')).toBe('January 1, 2026')
    expect(formatDateStable('2026-12-31T23:59:59.000Z')).toBe('December 31, 2026')
  })

  it('does not shift with the process timezone', () => {
    // The formatter reads UTC parts, so a zone change cannot move the printed date.
    const original = process.env.TZ
    try {
      process.env.TZ = 'Pacific/Kiritimati' // UTC+14
      const plus14 = formatDateStable('2026-09-17T14:30:00.000Z')
      process.env.TZ = 'Pacific/Midway' // UTC-11
      const minus11 = formatDateStable('2026-09-17T14:30:00.000Z')
      expect(plus14).toBe('September 17, 2026')
      expect(minus11).toBe('September 17, 2026')
    } finally {
      process.env.TZ = original
    }
  })

  it('rejects a non-date', () => {
    expect(() => formatDateStable('not a date')).toThrow(TypeError)
  })
})

describe('sanitizeForPdf', () => {
  it('folds typography the standard-14 fonts cannot encode', () => {
    // pdf-lib throws on these rather than substituting, and they arrive whenever a
    // description is pasted from a supplier's web page.
    expect(sanitizeForPdf('6" – 8" “board & batten”')).toBe('6" - 8" "board & batten"')
    expect(sanitizeForPdf('Smith’s Roofing™')).toBe("Smith's Roofing(TM)")
    expect(sanitizeForPdf('45° pitch…')).toBe('45 deg pitch...')
  })

  it('replaces characters outside WinAnsi rather than throwing', () => {
    expect(sanitizeForPdf('siding \u{1F528} install')).toBe('siding ? install')
  })

  it('flattens newlines and tabs so a cell cannot escape its row', () => {
    expect(sanitizeForPdf('line one\nline two\tend')).toBe('line one line two end')
  })
})

describe('wrapText', () => {
  it('never returns a line wider than the column', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const width = 242

    const lines = wrapText(lineRow(4).description, font, 9.5, width)

    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 9.5)).toBeLessThanOrEqual(width)
    }
  })

  it('breaks a single word that cannot fit, rather than letting it overhang', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const width = 60

    // A part number with no spaces is the realistic version of this.
    const lines = wrapText('SKU-AZ88401920394857601928374650', font, 9.5, width)

    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 9.5)).toBeLessThanOrEqual(width)
    }
    // Nothing is lost in the break.
    expect(lines.join('')).toBe('SKU-AZ88401920394857601928374650')
  })

  it('preserves all words across the wrap', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const text = lineRow(4).description

    const rejoined = wrapText(text, font, 9.5, 242).join(' ')

    expect(rejoined.split(/\s+/)).toEqual(sanitizeForPdf(text).trim().split(/\s+/))
  })

  it('handles empty input', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    expect(wrapText('', font, 9.5, 100)).toEqual([''])
    expect(wrapText('   ', font, 9.5, 100)).toEqual([''])
  })
})

describe('renderDocumentPdf — determinism (C09 acceptance)', () => {
  it('produces byte-identical output for the same model', async () => {
    const a = await renderDocumentPdf(model())
    const b = await renderDocumentPdf(model())

    expect(sha(b)).toBe(sha(a))
    expect(b.length).toBe(a.length)
  })

  it('stays identical across a clock tick', async () => {
    // The failure this guards against is pdf-lib's default CreationDate, which is
    // the current time. If metadata pinning regressed, this is what would catch it.
    const a = await renderDocumentPdf(model())
    await new Promise((resolve) => setTimeout(resolve, 1100))
    const b = await renderDocumentPdf(model())

    expect(sha(b)).toBe(sha(a))
  })

  it('stays identical when the process timezone changes', async () => {
    const original = process.env.TZ
    try {
      process.env.TZ = 'Asia/Tokyo'
      const a = await renderDocumentPdf(model())
      process.env.TZ = 'America/Anchorage'
      const b = await renderDocumentPdf(model())
      expect(sha(b)).toBe(sha(a))
    } finally {
      process.env.TZ = original
    }
  })

  it('writes the frozen issue date into the file as both PDF dates, not now', async () => {
    const bytes = await renderDocumentPdf(model())

    // Asserted against the RAW BYTES on purpose. pdf-lib's getModificationDate()
    // recomputes ModDate when a document is loaded, so reading it back through the
    // library reports the current time even when the stored value is correct —
    // which cost an afternoon once. The bytes are what gets hashed and what a
    // reader sees, so the bytes are what this checks.
    const text = Buffer.from(bytes).toString('latin1')
    const dates = [...text.matchAll(/\/(CreationDate|ModDate)\s*\(([^)]*)\)/g)].map(
      (match) => [match[1], match[2]] as const,
    )

    expect(dates).toHaveLength(2)
    for (const [, value] of dates) {
      expect(value).toBe('D:20260917143000Z')
    }

    // The producer must be fixed too: pdf-lib's default carries its own version
    // number, which would move the hash on every dependency bump. It writes strings
    // as UTF-16BE hex with a BOM, so the assertion encodes the same way rather than
    // looking for a plain literal that is never in the file.
    expect(text).toContain(`/Producer ${utf16beHex('PaperTrail')}`)
    expect(text).toContain(`/Creator ${utf16beHex('PaperTrail')}`)
    expect(await PDFDocument.load(bytes).then((d) => d.getCreationDate()?.toISOString())).toBe(
      '2026-09-17T14:30:00.000Z',
    )
  })

  it('changes the hash when the content changes', async () => {
    // Determinism must not be achieved by ignoring the input.
    const base = await renderDocumentPdf(model())
    const changed = await renderDocumentPdf(
      model({ totals: [{ label: 'Total', amountCents: 1, emphasis: true }] }),
    )

    expect(sha(changed)).not.toBe(sha(base))
  })

  it('changes the hash when the document number changes', async () => {
    const base = await renderDocumentPdf(model())
    const renumbered = await renderDocumentPdf(model({ numberText: 'EST-0043' }))

    expect(sha(renumbered)).not.toBe(sha(base))
  })
})

describe('renderDocumentPdf — layout (C09 acceptance)', () => {
  it('renders a 30-line estimate with a long address across multiple pages', async () => {
    const bytes = await renderDocumentPdf(model())
    const reloaded = await PDFDocument.load(bytes)

    // 30 wrapping lines plus totals, terms and a signature block do not fit on one
    // US Letter page; the point is that they paginate rather than overflow.
    expect(reloaded.getPageCount()).toBeGreaterThan(1)

    for (const page of reloaded.getPages()) {
      expect(page.getWidth()).toBeCloseTo(612, 1)
      expect(page.getHeight()).toBeCloseTo(792, 1)
    }
  })

  it('renders a single-line estimate on one page', async () => {
    const bytes = await renderDocumentPdf(
      model({ lines: [lineRow(2)], groups: [], totals: [{ label: 'Total', amountCents: 125000, emphasis: true }] }),
    )
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })

  it('renders the summary detail level without quantities or rates', async () => {
    const bytes = await renderDocumentPdf(model({ detailLevel: 'summary' }))
    const reloaded = await PDFDocument.load(bytes)

    expect(reloaded.getPageCount()).toBeGreaterThanOrEqual(1)
    // Summary is materially shorter than itemized from the same rows: that is the
    // whole feature — same stored data, less published.
    const itemized = await renderDocumentPdf(model())
    expect(bytes.length).toBeLessThan(itemized.length)
  })

  it('survives a model with almost nothing filled in', async () => {
    // A contractor who has not completed their company profile must still be able
    // to issue; an incomplete letterhead is not a reason to fail.
    const bytes = await renderDocumentPdf(
      model({
        letterhead: {
          companyName: 'Sole Trader',
          dba: null,
          addressLines: [],
          phone: null,
          email: null,
          website: null,
          licenseNumber: null,
          insuranceCarrier: null,
          insurancePolicy: null,
          logo: null,
        },
        projectTitle: null,
        expiresAtISO: null,
        client: { heading: 'Client', lines: ['—'] },
        property: { heading: 'Property', lines: ['—'] },
        terms: null,
        notesToClient: null,
        lines: [lineRow(1)],
        totals: [{ label: 'Total', amountCents: 0, emphasis: true }],
      }),
    )

    expect(bytes.length).toBeGreaterThan(0)
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1)
  })

  it('does not throw on a description full of unencodable characters', async () => {
    const bytes = await renderDocumentPdf(
      model({
        lines: [
          {
            ...lineRow(1),
            description: 'Trim — 6" × 8" “premium” \u{1F3E0}  caps',
            derivation: '10 × 1.1 ≈ 11',
          },
        ],
      }),
    )
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('renders an invalid logo by falling back to text rather than failing', async () => {
    const bytes = await renderDocumentPdf(
      model({
        letterhead: {
          ...model().letterhead,
          logo: { bytes: new Uint8Array([1, 2, 3, 4]), format: 'png' },
        },
      }),
    )
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThanOrEqual(1)
  })
})

describe('formatCentsStable', () => {
  it('formats without Intl so the hash cannot move with an ICU upgrade', () => {
    expect(formatCentsStable(0)).toBe('0.00')
    expect(formatCentsStable(5)).toBe('0.05')
    expect(formatCentsStable(125000)).toBe('1,250.00')
    expect(formatCentsStable(-4999)).toBe('-49.99')
    expect(formatCentsStable(100000000)).toBe('1,000,000.00')
    expect(formatCentsStable(999)).toBe('9.99')
    expect(formatCentsStable(1000)).toBe('10.00')
  })

  it('groups every thousands boundary correctly', () => {
    expect(formatCentsStable(99999)).toBe('999.99')
    expect(formatCentsStable(100099)).toBe('1,000.99')
    expect(formatCentsStable(1234567890)).toBe('12,345,678.90')
  })

  it('agrees with the Intl formatter for en-US', () => {
    // Same answer today; this one just does not depend on ICU to keep giving it.
    for (const cents of [0, 5, 999, 1000, 125000, -4999, 1234567890]) {
      expect(formatCentsStable(cents)).toBe(
        new Intl.NumberFormat('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(cents / 100),
      )
    }
  })

  it('rejects a non-integer', () => {
    expect(() => formatCentsStable(12.5)).toThrow(TypeError)
  })
})
