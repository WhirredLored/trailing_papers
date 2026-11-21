import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import { formatCentsStable, type Cents } from '@/lib/money'

/**
 * Deterministic document rendering (C09).
 *
 * THE ONE RULE THAT SHAPES THIS WHOLE FILE: rendering the same issued version
 * twice must produce byte-identical output, because the sha256 of these bytes is
 * what makes the evidence chain provable (Law 3 / Law 8). "The contractor's copy
 * hashes the same as the copy the homeowner signed" is the claim; a renderer that
 * drifts turns that claim into noise.
 *
 * What that rules out, all of it load-bearing:
 *   - `new Date()` anywhere in here. Every date arrives as an ISO string from a
 *     frozen column and is formatted in UTC against a fixed month table, so no
 *     machine's clock or zone can change a byte.
 *   - `Intl` for money. See `formatCentsStable` in lib/money.ts — ICU version is
 *     part of the runtime, not part of the document.
 *   - pdf-lib's default metadata. It stamps CreationDate/ModDate with the current
 *     time and a Producer string carrying its own version, so all four are set
 *     explicitly from the document's frozen issued_at.
 *   - Embedded font files. The standard 14 fonts are referenced by name, so no
 *     font binary (or its version) is in the output.
 *
 * Verified in lib/pdf.test.ts: two renders of the same model hash identically,
 * including a render separated by a clock tick.
 *
 * PRINT CONSTRAINTS the spec calls for and this file implements: US Letter,
 * legible in grayscale (no information is carried by colour — an optional line
 * says "optional", it is not blue), and no clipped columns however long a
 * description or address runs, which is what `wrapText` is for.
 */

// ---------------------------------------------------------------------------
// Page geometry — US Letter, 0.75" margins
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 612
const PAGE_HEIGHT = 792
const MARGIN = 54

const CONTENT_LEFT = MARGIN
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN
const CONTENT_WIDTH = CONTENT_RIGHT - CONTENT_LEFT

/** Bottom limit for body content; the footer sits below it. */
const BODY_FLOOR = MARGIN + 36

/**
 * Line-item column geometry, as x positions.
 *
 * Description is the only column that wraps, so it gets the slack. The money
 * columns are defined by their RIGHT edge because they are right-aligned — that
 * is what keeps a four-figure amount from drifting out of its column.
 */
const COL = {
  descLeft: CONTENT_LEFT,
  descWidth: 242,
  qtyRight: CONTENT_LEFT + 296,
  unitLeft: CONTENT_LEFT + 304,
  priceRight: CONTENT_LEFT + 416,
  amountRight: CONTENT_RIGHT,
} as const

// Type sizes.
const SIZE_TITLE = 20
const SIZE_HEADING = 11
const SIZE_BODY = 9.5
const SIZE_SMALL = 8
const LEADING = 12

// Greys. Text is always near-black so it survives a fax, a photocopy and a
// grayscale laser printer; grey is used for rules and secondary labels only.
const INK = rgb(0.1, 0.1, 0.1)
const INK_SOFT = rgb(0.38, 0.38, 0.38)
const RULE = rgb(0.72, 0.72, 0.72)
const RULE_STRONG = rgb(0.25, 0.25, 0.25)

// ---------------------------------------------------------------------------
// Model — everything the renderer needs, fully resolved. No database access.
// ---------------------------------------------------------------------------

export type DocumentKind = 'estimate' | 'change_order' | 'invoice' | 'signed_copy' | 'receipt'
export type DetailLevel = 'itemized' | 'summary'

/** A raster logo. pdf-lib embeds PNG and JPEG only — see `logoOrNull` below. */
export interface DocumentLogo {
  bytes: Uint8Array
  format: 'png' | 'jpg'
}

export interface Letterhead {
  /** Legal name, falling back to the trading name. */
  companyName: string
  dba: string | null
  addressLines: string[]
  phone: string | null
  email: string | null
  website: string | null
  licenseNumber: string | null
  insuranceCarrier: string | null
  insurancePolicy: string | null
  logo: DocumentLogo | null
}

export interface PartyBlock {
  heading: string
  lines: string[]
}

export interface DocumentLineRow {
  description: string
  /** Pre-formatted by the caller so quantity formatting is decided in one place. */
  quantity: string
  unit: string
  unitPriceCents: Cents
  amountCents: Cents
  /** The takeoff derivation, kept visible so a quantity stays auditable. */
  derivation: string | null
  isOptional: boolean
  groupLabel: string | null
}

export interface DocumentGroupRow {
  label: string
  subtotalCents: Cents
  optionalCents: Cents
  lineCount: number
}

export interface DocumentTotalRow {
  label: string
  amountCents: Cents
  /** Renders bold with a rule above — the total and the deposit. */
  emphasis?: boolean
}

export interface DocumentModel {
  kind: DocumentKind
  /** e.g. "EST-0001" — allocated by the database, never by the renderer. */
  numberText: string
  documentTitle: string
  projectTitle: string | null
  /** The frozen issue timestamp. Also the source of every PDF metadata date. */
  issuedAtISO: string
  expiresAtISO: string | null
  letterhead: Letterhead
  client: PartyBlock
  property: PartyBlock
  detailLevel: DetailLevel
  lines: DocumentLineRow[]
  groups: DocumentGroupRow[]
  totals: DocumentTotalRow[]
  terms: string | null
  notesToClient: string | null
  /** Draws the signature block. ESIGN/UETA mechanics themselves land in C11. */
  showSignatureBlock: boolean
}

// ---------------------------------------------------------------------------
// Deterministic formatting
// ---------------------------------------------------------------------------

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

/**
 * Format an ISO timestamp as "September 17, 2026", in UTC.
 *
 * UTC rather than a local zone is a deliberate trade: a document rendered in two
 * places must read the same, and `toLocaleDateString` would make the printed date
 * a property of the server's zone and ICU build. The cost is that an estimate
 * issued late evening US-time carries the following UTC date; the frozen
 * `issued_at` remains the authoritative instant either way.
 */
export function formatDateStable(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Not a date: ${iso}`)
  }
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`
}

// ---------------------------------------------------------------------------
// Text measurement and wrapping
// ---------------------------------------------------------------------------

/**
 * Strip characters the standard-14 fonts cannot encode.
 *
 * WinAnsi has no en-dash, curly quote or emoji, and pdf-lib THROWS on them rather
 * than substituting. A contractor pasting a description out of a supplier's web
 * page brings all three, so an un-sanitised renderer fails on real input. The
 * common typographic characters are folded to ASCII equivalents and anything else
 * unrepresentable becomes "?", which is ugly but never a 500.
 */
export function sanitizeForPdf(input: string): string {
  const folded = input
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[•·]/g, '-')
    .replace(/™/g, '(TM)')
    .replace(/®/g, '(R)')
    .replace(/°/g, ' deg')
    .replace(/[\r\n\t]+/g, ' ')

  // WinAnsi covers most of Latin-1; drop the rest rather than throw.
  let out = ''
  for (const ch of folded) {
    const code = ch.codePointAt(0) ?? 0
    out += code >= 0x20 && code <= 0x7e ? ch : code >= 0xa0 && code <= 0xff ? ch : '?'
  }
  return out
}

/**
 * Break text to fit `maxWidth`, measuring against the real font metrics.
 *
 * This is what satisfies "no clipped columns on long descriptions". A word longer
 * than the column (a 40-character part number, a URL) is split mid-word rather
 * than allowed to overhang, because an overhanging description would run under
 * the quantity column and make the money unreadable.
 */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = sanitizeForPdf(text).trim()
  if (clean === '') return ['']

  const lines: string[] = []
  let current = ''

  for (const word of clean.split(/\s+/)) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
      continue
    }

    if (current !== '') {
      lines.push(current)
      current = ''
    }

    // The word alone may still not fit: break it by character.
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word
      continue
    }

    let chunk = ''
    for (const ch of word) {
      if (font.widthOfTextAtSize(chunk + ch, size) > maxWidth && chunk !== '') {
        lines.push(chunk)
        chunk = ch
      } else {
        chunk += ch
      }
    }
    current = chunk
  }

  if (current !== '') lines.push(current)
  return lines.length > 0 ? lines : ['']
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

interface Fonts {
  regular: PDFFont
  bold: PDFFont
}

/** Mutable cursor threaded through the drawing helpers. */
interface Cursor {
  page: PDFPage
  y: number
}

/**
 * Render a document to PDF bytes.
 *
 * Pure with respect to its input: same model in, same bytes out, always.
 */
export async function renderDocumentPdf(model: DocumentModel): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  }

  const cursor: Cursor = { page: doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]), y: PAGE_HEIGHT - MARGIN }

  await drawLetterhead(doc, cursor, model, fonts)
  drawDocumentMeta(cursor, model, fonts)
  drawParties(cursor, model, fonts)

  if (model.detailLevel === 'itemized') {
    drawItemizedLines(doc, cursor, model, fonts)
  } else {
    drawSummaryGroups(doc, cursor, model, fonts)
  }

  drawTotals(doc, cursor, model, fonts)
  drawNotesAndTerms(doc, cursor, model, fonts)
  if (model.showSignatureBlock) drawSignatureBlock(doc, cursor, model, fonts)

  // Footers last: "Page 1 of 4" needs the final page count.
  drawFooters(doc, model, fonts)

  // Metadata pinned to the frozen issue date — the last source of drift.
  const issued = new Date(model.issuedAtISO)
  doc.setTitle(`${model.numberText} ${model.documentTitle}`)
  doc.setSubject(model.documentTitle)
  doc.setAuthor(sanitizeForPdf(model.letterhead.companyName))
  doc.setProducer('PaperTrail')
  doc.setCreator('PaperTrail')
  doc.setCreationDate(issued)
  doc.setModificationDate(issued)

  return doc.save({ useObjectStreams: false })
}

/** Start a fresh page and reset the cursor. */
function newPage(doc: PDFDocument, cursor: Cursor): void {
  cursor.page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  cursor.y = PAGE_HEIGHT - MARGIN
}

/** Break to a new page when `needed` points of vertical space are not available. */
function ensureSpace(doc: PDFDocument, cursor: Cursor, needed: number): void {
  if (cursor.y - needed < BODY_FLOOR) newPage(doc, cursor)
}

function drawText(
  cursor: Cursor,
  text: string,
  x: number,
  size: number,
  font: PDFFont,
  color = INK,
): void {
  cursor.page.drawText(sanitizeForPdf(text), { x, y: cursor.y, size, font, color })
}

/** Draw right-aligned at `right`, which is how every money column stays in line. */
function drawRight(
  cursor: Cursor,
  text: string,
  right: number,
  size: number,
  font: PDFFont,
  color = INK,
): void {
  const clean = sanitizeForPdf(text)
  const width = font.widthOfTextAtSize(clean, size)
  cursor.page.drawText(clean, { x: right - width, y: cursor.y, size, font, color })
}

function drawRule(cursor: Cursor, color = RULE, thickness = 0.75): void {
  cursor.page.drawLine({
    start: { x: CONTENT_LEFT, y: cursor.y },
    end: { x: CONTENT_RIGHT, y: cursor.y },
    thickness,
    color,
  })
}

async function drawLetterhead(
  doc: PDFDocument,
  cursor: Cursor,
  model: DocumentModel,
  fonts: Fonts,
): Promise<void> {
  const { letterhead } = model
  const topY = cursor.y
  let textLeft = CONTENT_LEFT

  // Logo, if there is an embeddable one. A failed embed must not cost the
  // contractor their estimate, so a broken image is skipped, not thrown.
  if (letterhead.logo) {
    try {
      const image =
        letterhead.logo.format === 'png'
          ? await doc.embedPng(letterhead.logo.bytes)
          : await doc.embedJpg(letterhead.logo.bytes)

      const maxW = 108
      const maxH = 54
      const scale = Math.min(maxW / image.width, maxH / image.height, 1)
      const w = image.width * scale
      const h = image.height * scale

      cursor.page.drawImage(image, { x: CONTENT_LEFT, y: topY - h, width: w, height: h })
      textLeft = CONTENT_LEFT + w + 14
    } catch {
      // Unreadable logo bytes: fall through to the text-only letterhead.
    }
  }

  cursor.y = topY - 11
  drawText(cursor, letterhead.companyName, textLeft, SIZE_HEADING + 2, fonts.bold)

  if (letterhead.dba) {
    cursor.y -= LEADING
    drawText(cursor, `d/b/a ${letterhead.dba}`, textLeft, SIZE_SMALL, fonts.regular, INK_SOFT)
  }

  for (const line of letterhead.addressLines) {
    cursor.y -= LEADING - 1
    drawText(cursor, line, textLeft, SIZE_SMALL, fonts.regular, INK_SOFT)
  }

  const contact = [letterhead.phone, letterhead.email, letterhead.website]
    .filter((v): v is string => Boolean(v))
    .join('  ·  ')
  if (contact) {
    cursor.y -= LEADING - 1
    drawText(cursor, contact, textLeft, SIZE_SMALL, fonts.regular, INK_SOFT)
  }

  // Licence and insurance. Contractors are often required to show these, and a
  // homeowner comparing bids looks for them.
  const credentials: string[] = []
  if (letterhead.licenseNumber) credentials.push(`Lic. ${letterhead.licenseNumber}`)
  if (letterhead.insuranceCarrier || letterhead.insurancePolicy) {
    const insurance = [letterhead.insuranceCarrier, letterhead.insurancePolicy]
      .filter((v): v is string => Boolean(v))
      .join(' ')
    credentials.push(`Insured: ${insurance}`)
  }
  if (credentials.length > 0) {
    cursor.y -= LEADING - 1
    drawText(cursor, credentials.join('  ·  '), textLeft, SIZE_SMALL, fonts.regular, INK_SOFT)
  }

  // Keep the rule clear of a tall logo.
  cursor.y = Math.min(cursor.y - 10, topY - 64)
  drawRule(cursor, RULE_STRONG, 1)
  cursor.y -= 22
}

function drawDocumentMeta(cursor: Cursor, model: DocumentModel, fonts: Fonts): void {
  drawText(cursor, model.documentTitle, CONTENT_LEFT, SIZE_TITLE, fonts.bold)
  drawRight(cursor, model.numberText, CONTENT_RIGHT, SIZE_TITLE, fonts.bold)
  cursor.y -= LEADING + 4

  if (model.projectTitle) {
    drawText(cursor, model.projectTitle, CONTENT_LEFT, SIZE_BODY, fonts.regular, INK_SOFT)
  }
  drawRight(cursor, `Issued ${formatDateStable(model.issuedAtISO)}`, CONTENT_RIGHT, SIZE_SMALL, fonts.regular, INK_SOFT)
  cursor.y -= LEADING - 1

  if (model.expiresAtISO) {
    drawRight(
      cursor,
      `Valid until ${formatDateStable(model.expiresAtISO)}`,
      CONTENT_RIGHT,
      SIZE_SMALL,
      fonts.regular,
      INK_SOFT,
    )
  }
  cursor.y -= 18
}

/**
 * Client and property, side by side.
 *
 * Both columns wrap, which is the "long address" half of the acceptance case: a
 * rural address with a unit and a long street name must not run into the other
 * column or off the page.
 */
function drawParties(cursor: Cursor, model: DocumentModel, fonts: Fonts): void {
  const colWidth = (CONTENT_WIDTH - 24) / 2
  const rightLeft = CONTENT_LEFT + colWidth + 24
  const startY = cursor.y

  const drawBlock = (block: PartyBlock, left: number): number => {
    cursor.y = startY
    drawText(cursor, block.heading.toUpperCase(), left, SIZE_SMALL, fonts.bold, INK_SOFT)
    cursor.y -= LEADING + 1
    for (const raw of block.lines) {
      for (const line of wrapText(raw, fonts.regular, SIZE_BODY, colWidth)) {
        drawText(cursor, line, left, SIZE_BODY, fonts.regular)
        cursor.y -= LEADING - 1
      }
    }
    return cursor.y
  }

  const afterLeft = drawBlock(model.client, CONTENT_LEFT)
  const afterRight = drawBlock(model.property, rightLeft)

  cursor.y = Math.min(afterLeft, afterRight) - 10
}

function drawLineColumnHeader(cursor: Cursor, fonts: Fonts): void {
  drawText(cursor, 'DESCRIPTION', COL.descLeft, SIZE_SMALL, fonts.bold, INK_SOFT)
  drawRight(cursor, 'QTY', COL.qtyRight, SIZE_SMALL, fonts.bold, INK_SOFT)
  drawText(cursor, 'UNIT', COL.unitLeft, SIZE_SMALL, fonts.bold, INK_SOFT)
  drawRight(cursor, 'RATE', COL.priceRight, SIZE_SMALL, fonts.bold, INK_SOFT)
  drawRight(cursor, 'AMOUNT', COL.amountRight, SIZE_SMALL, fonts.bold, INK_SOFT)
  cursor.y -= 5
  drawRule(cursor)
  cursor.y -= LEADING
}

function drawItemizedLines(
  doc: PDFDocument,
  cursor: Cursor,
  model: DocumentModel,
  fonts: Fonts,
): void {
  ensureSpace(doc, cursor, 80)
  drawLineColumnHeader(cursor, fonts)

  let lastGroup: string | null | undefined
  let sawOptional = false

  for (const line of model.lines) {
    const descLines = wrapText(line.description, fonts.regular, SIZE_BODY, COL.descWidth)
    const derivationLines = line.derivation
      ? wrapText(line.derivation, fonts.regular, SIZE_SMALL, COL.descWidth)
      : []
    const rowHeight = (descLines.length + derivationLines.length) * (LEADING - 1) + 6

    const groupChanged = line.groupLabel !== lastGroup && line.groupLabel != null

    // Keep a group heading attached to its first row rather than orphaning it at
    // the foot of a page.
    ensureSpace(doc, cursor, rowHeight + (groupChanged ? LEADING + 6 : 0))

    // A page break inside the table repeats the column header; a table whose
    // columns are only labelled on page one is unreadable on page three.
    if (cursor.y === PAGE_HEIGHT - MARGIN) {
      drawLineColumnHeader(cursor, fonts)
    }

    if (groupChanged) {
      lastGroup = line.groupLabel
      drawText(cursor, line.groupLabel ?? '', COL.descLeft, SIZE_BODY, fonts.bold)
      cursor.y -= LEADING + 2
    }

    const rowTop = cursor.y

    descLines.forEach((text, index) => {
      const label = index === 0 && line.isOptional ? `${text}` : text
      drawText(cursor, label, COL.descLeft, SIZE_BODY, fonts.regular)
      cursor.y -= LEADING - 1
    })

    for (const text of derivationLines) {
      drawText(cursor, text, COL.descLeft + 8, SIZE_SMALL, fonts.regular, INK_SOFT)
      cursor.y -= LEADING - 1
    }

    // Numbers sit on the row's first line, whatever the description's height.
    const numbersY = cursor.y
    cursor.y = rowTop
    drawRight(cursor, line.quantity, COL.qtyRight, SIZE_BODY, fonts.regular)
    drawText(cursor, line.unit, COL.unitLeft, SIZE_BODY, fonts.regular)
    drawRight(cursor, formatCentsStable(line.unitPriceCents), COL.priceRight, SIZE_BODY, fonts.regular)

    if (line.isOptional) {
      sawOptional = true
      // Grayscale-safe: the word carries the meaning, not a colour.
      drawRight(cursor, 'optional', COL.amountRight, SIZE_SMALL, fonts.regular, INK_SOFT)
    } else {
      drawRight(cursor, formatCentsStable(line.amountCents), COL.amountRight, SIZE_BODY, fonts.regular)
    }

    cursor.y = numbersY - 6
  }

  cursor.y += 2
  drawRule(cursor)
  cursor.y -= LEADING

  if (sawOptional) {
    drawText(
      cursor,
      'Lines marked optional are quoted but not included in the total below.',
      CONTENT_LEFT,
      SIZE_SMALL,
      fonts.regular,
      INK_SOFT,
    )
    cursor.y -= LEADING
  }
}

/**
 * Summary presentation: group totals only.
 *
 * Same stored rows as itemized — no quantities and no unit prices, because a
 * contractor often does not want to publish what they pay for material.
 */
function drawSummaryGroups(
  doc: PDFDocument,
  cursor: Cursor,
  model: DocumentModel,
  fonts: Fonts,
): void {
  ensureSpace(doc, cursor, 80)

  drawText(cursor, 'SCOPE OF WORK', COL.descLeft, SIZE_SMALL, fonts.bold, INK_SOFT)
  drawRight(cursor, 'AMOUNT', COL.amountRight, SIZE_SMALL, fonts.bold, INK_SOFT)
  cursor.y -= 5
  drawRule(cursor)
  cursor.y -= LEADING

  for (const group of model.groups) {
    const labelLines = wrapText(group.label, fonts.regular, SIZE_BODY, COL.descWidth + 120)
    ensureSpace(doc, cursor, labelLines.length * LEADING + 8)

    const rowTop = cursor.y
    labelLines.forEach((text) => {
      drawText(cursor, text, COL.descLeft, SIZE_BODY, fonts.regular)
      cursor.y -= LEADING - 1
    })

    const afterLabel = cursor.y
    cursor.y = rowTop
    drawRight(cursor, formatCentsStable(group.subtotalCents), COL.amountRight, SIZE_BODY, fonts.regular)
    cursor.y = afterLabel

    if (group.optionalCents !== 0) {
      drawText(
        cursor,
        `optional additions available: ${formatCentsStable(group.optionalCents)}`,
        COL.descLeft + 8,
        SIZE_SMALL,
        fonts.regular,
        INK_SOFT,
      )
      cursor.y -= LEADING - 1
    }
    cursor.y -= 4
  }

  cursor.y += 2
  drawRule(cursor)
  cursor.y -= LEADING
}

function drawTotals(doc: PDFDocument, cursor: Cursor, model: DocumentModel, fonts: Fonts): void {
  ensureSpace(doc, cursor, model.totals.length * LEADING + 40)

  const labelRight = COL.priceRight

  for (const row of model.totals) {
    if (row.emphasis) {
      cursor.y += 3
      cursor.page.drawLine({
        start: { x: labelRight - 120, y: cursor.y + 8 },
        end: { x: CONTENT_RIGHT, y: cursor.y + 8 },
        thickness: 0.75,
        color: RULE,
      })
      cursor.y -= 3
    }

    const font = row.emphasis ? fonts.bold : fonts.regular
    drawRight(cursor, row.label, labelRight, SIZE_BODY, font, row.emphasis ? INK : INK_SOFT)
    drawRight(cursor, formatCentsStable(row.amountCents), COL.amountRight, SIZE_BODY, font)
    cursor.y -= LEADING + (row.emphasis ? 2 : 0)
  }

  cursor.y -= 10
}

function drawNotesAndTerms(
  doc: PDFDocument,
  cursor: Cursor,
  model: DocumentModel,
  fonts: Fonts,
): void {
  const sections: Array<[string, string]> = []
  if (model.notesToClient) sections.push(['NOTES', model.notesToClient])
  if (model.terms) sections.push(['TERMS', model.terms])

  for (const [heading, body] of sections) {
    const lines = wrapText(body, fonts.regular, SIZE_SMALL, CONTENT_WIDTH)
    ensureSpace(doc, cursor, lines.length * (LEADING - 2) + 28)

    drawText(cursor, heading, CONTENT_LEFT, SIZE_SMALL, fonts.bold, INK_SOFT)
    cursor.y -= LEADING
    for (const line of lines) {
      drawText(cursor, line, CONTENT_LEFT, SIZE_SMALL, fonts.regular)
      cursor.y -= LEADING - 2
    }
    cursor.y -= 10
  }
}

/**
 * Signature block.
 *
 * Deliberately mechanics only — a place to sign, a printed name and a date. No
 * clause language and no legal wording: the spec's legal note says contract and
 * warranty text stays a company-supplied template for the contractor's own
 * attorney. C11 adds the ESIGN/UETA flow around this.
 */
function drawSignatureBlock(
  doc: PDFDocument,
  cursor: Cursor,
  model: DocumentModel,
  fonts: Fonts,
): void {
  ensureSpace(doc, cursor, 96)

  drawText(cursor, 'APPROVAL', CONTENT_LEFT, SIZE_SMALL, fonts.bold, INK_SOFT)
  cursor.y -= LEADING + 2

  const lines = wrapText(
    `Signing below accepts ${model.numberText} as described above.`,
    fonts.regular,
    SIZE_SMALL,
    CONTENT_WIDTH,
  )
  for (const line of lines) {
    drawText(cursor, line, CONTENT_LEFT, SIZE_SMALL, fonts.regular, INK_SOFT)
    cursor.y -= LEADING - 2
  }

  cursor.y -= 26

  const colWidth = (CONTENT_WIDTH - 36) / 2
  const rightLeft = CONTENT_LEFT + colWidth + 36

  for (const [left, label] of [
    [CONTENT_LEFT, 'Signature'],
    [rightLeft, 'Date'],
  ] as Array<[number, string]>) {
    cursor.page.drawLine({
      start: { x: left, y: cursor.y },
      end: { x: left + colWidth, y: cursor.y },
      thickness: 0.75,
      color: RULE_STRONG,
    })
    cursor.page.drawText(label, {
      x: left,
      y: cursor.y - 10,
      size: SIZE_SMALL,
      font: fonts.regular,
      color: INK_SOFT,
    })
  }

  cursor.y -= 34
  cursor.page.drawLine({
    start: { x: CONTENT_LEFT, y: cursor.y },
    end: { x: CONTENT_LEFT + colWidth, y: cursor.y },
    thickness: 0.75,
    color: RULE_STRONG,
  })
  cursor.page.drawText('Printed name', {
    x: CONTENT_LEFT,
    y: cursor.y - 10,
    size: SIZE_SMALL,
    font: fonts.regular,
    color: INK_SOFT,
  })
}

/** Footers, drawn once the page count is known. */
function drawFooters(doc: PDFDocument, model: DocumentModel, fonts: Fonts): void {
  const pages = doc.getPages()
  const total = pages.length

  pages.forEach((page, index) => {
    const left = `${model.letterhead.companyName}  ·  ${model.numberText}`
    const right = `Page ${index + 1} of ${total}`

    page.drawLine({
      start: { x: CONTENT_LEFT, y: MARGIN + 20 },
      end: { x: CONTENT_RIGHT, y: MARGIN + 20 },
      thickness: 0.5,
      color: RULE,
    })
    page.drawText(sanitizeForPdf(left), {
      x: CONTENT_LEFT,
      y: MARGIN + 8,
      size: SIZE_SMALL - 0.5,
      font: fonts.regular,
      color: INK_SOFT,
    })
    const rightWidth = fonts.regular.widthOfTextAtSize(right, SIZE_SMALL - 0.5)
    page.drawText(right, {
      x: CONTENT_RIGHT - rightWidth,
      y: MARGIN + 8,
      size: SIZE_SMALL - 0.5,
      font: fonts.regular,
      color: INK_SOFT,
    })
  })
}
