import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { Enums, Tables } from '@/types/db'
import { isBillable, summarizeGroups } from '@/lib/estimate'
import { rowToDraft, termsOf, snapshot } from '@/lib/estimate-server'
import { multiplyCents } from '@/lib/money'
import {
  renderDocumentPdf,
  type DocumentGroupRow,
  type DocumentLineRow,
  type DocumentLogo,
  type DocumentModel,
  type DocumentTotalRow,
  type Letterhead,
} from '@/lib/pdf'

/**
 * Document generation, storage and hashing (C09).
 *
 * The sequence matters and is not rearrangeable:
 *
 *   1. allocate the number   — atomically, in the database
 *   2. render the PDF        — the number is printed ON it, so it must exist first
 *   3. hash the bytes        — sha256 of exactly what gets stored
 *   4. upload                — company-scoped path, never overwriting
 *   5. record the row        — and link it to what it renders
 *
 * Steps 4 and 5 are in that order deliberately. If recording fails after a
 * successful upload the result is an unreferenced file, which is litter; the other
 * order would leave a document row pointing at a file that does not exist, which
 * is a broken evidence chain. Litter is the better failure.
 *
 * Generation is idempotent (Law 5): an estimate that already carries a snapshot
 * returns that snapshot instead of making a second one. The database backs this
 * up with a unique constraint on (company, kind, related, version), so even two
 * simultaneous callers cannot produce two PDFs of one frozen version.
 */

export const DOCUMENTS_BUCKET = 'documents'

/** Lowercase hex sha256 — the format the document.sha256 check constraint requires. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Company-scoped storage path.
 *
 * The FIRST segment is the company id and nothing else, because that is what the
 * storage RLS policy reads to decide tenancy (`storage.foldername(name))[1]`). Any
 * other shape silently breaks isolation, so this is the only place that builds it.
 */
export function documentStoragePath(
  companyId: string,
  kind: Enums<'document_kind'>,
  numberText: string,
  version: number,
): string {
  return `${companyId}/${kind}/${numberText}-v${version}.pdf`
}

/**
 * Format a line quantity deterministically.
 *
 * Quantities are numeric(12,4), so they arrive as 20, 20.5 or 20.25. Trailing
 * zeros are trimmed so a whole number reads "20" rather than "20.0000", and the
 * output never depends on Intl (see formatCentsStable for why that matters).
 */
export function formatQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return '0'
  const fixed = quantity.toFixed(4)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

// ---------------------------------------------------------------------------
// Letterhead
// ---------------------------------------------------------------------------

/**
 * Fetch the company logo for embedding, or null.
 *
 * pdf-lib embeds PNG and JPEG only. The C03 logo route also accepts SVG, which
 * cannot be embedded without rasterising it, so an SVG logo is skipped and the
 * letterhead falls back to type. Skipping beats both alternatives: throwing would
 * make a valid logo choice block issuing, and shipping a rasteriser is far outside
 * what this commit is for.
 */
export async function loadCompanyLogo(
  db: SupabaseClient<Database>,
  logoPath: string | null,
): Promise<DocumentLogo | null> {
  if (!logoPath) return null

  const lower = logoPath.toLowerCase()
  const format: DocumentLogo['format'] | null = lower.endsWith('.png')
    ? 'png'
    : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'jpg'
      : null

  if (!format) return null

  const { data, error } = await db.storage.from('company-assets').download(logoPath)
  if (error || !data) return null

  return { bytes: new Uint8Array(await data.arrayBuffer()), format }
}

function buildLetterhead(company: Tables<'company'>, logo: DocumentLogo | null): Letterhead {
  const cityLine = [company.city, company.state].filter(Boolean).join(', ')
  const cityZip = [cityLine, company.zip].filter(Boolean).join(' ').trim()

  const addressLines = [company.address_line1, company.address_line2, cityZip]
    .map((v) => (v ?? '').trim())
    .filter((v) => v !== '')

  return {
    // Legal name is what belongs on a document that may be enforced; the trading
    // name is the fallback when the profile has not been filled in yet.
    companyName: (company.legal_name ?? '').trim() || company.name,
    dba: (company.dba ?? '').trim() || null,
    addressLines,
    phone: (company.phone ?? '').trim() || null,
    email: (company.email ?? '').trim() || null,
    website: (company.website ?? '').trim() || null,
    licenseNumber: (company.license_number ?? '').trim() || null,
    insuranceCarrier: (company.insurance_carrier ?? '').trim() || null,
    insurancePolicy: (company.insurance_policy ?? '').trim() || null,
    logo,
  }
}

// ---------------------------------------------------------------------------
// Model assembly
// ---------------------------------------------------------------------------

export interface EstimateDocumentInput {
  estimate: Tables<'estimate'>
  lines: Tables<'estimate_line'>[]
  company: Tables<'company'>
  client: Tables<'client'> | null
  property: Tables<'property'> | null
  projectTitle: string | null
  numberText: string
  logo: DocumentLogo | null
}

/**
 * Turn stored rows into the renderer's model.
 *
 * Pure and synchronous on purpose: the acceptance case for hash stability tests
 * this function's output through the renderer, with no database in the way.
 *
 * The money here is READ FROM THE FROZEN COLUMNS, not recomputed. An issued
 * estimate's totals were computed and frozen at issue, and the document has to say
 * what the client agreed to — even if the engine were later to round differently,
 * the PDF must still match the row. That is the whole point of freezing them.
 */
export function buildEstimateDocumentModel(input: EstimateDocumentInput): DocumentModel {
  const { estimate, lines, company, client, property } = input

  const drafts = lines.map(rowToDraft)

  const lineRows: DocumentLineRow[] = lines.map((row) => {
    const draft = rowToDraft(row)
    return {
      description: row.description,
      quantity: formatQuantity(Number(row.quantity)),
      unit: row.unit,
      unitPriceCents: row.unit_price_cents,
      amountCents: multiplyCents(row.unit_price_cents, Number(row.quantity)),
      derivation: row.derivation,
      // An optional line that was selected is part of the job, so it prints as a
      // normal priced line; only an unselected one is still an offer.
      isOptional: !isBillable(draft),
      groupLabel: (row.group_label ?? '').trim() || null,
    }
  })

  const groups: DocumentGroupRow[] = summarizeGroups(drafts).map((group) => ({
    label: group.label,
    subtotalCents: group.subtotalCents,
    optionalCents: group.optionalCents,
    lineCount: group.lineCount,
  }))

  const totals: DocumentTotalRow[] = [{ label: 'Subtotal', amountCents: estimate.subtotal_cents }]

  if (estimate.discount_cents !== 0) {
    totals.push({ label: 'Discount', amountCents: -estimate.discount_cents })
  }
  if (estimate.tax_cents !== 0 || estimate.tax_rate_bp !== 0) {
    totals.push({
      label: `Tax (${formatBasisPoints(estimate.tax_rate_bp)}%)`,
      amountCents: estimate.tax_cents,
    })
  }

  totals.push({ label: 'Total', amountCents: estimate.total_cents, emphasis: true })

  if (estimate.deposit_due_cents !== 0) {
    totals.push({ label: 'Deposit due now', amountCents: estimate.deposit_due_cents, emphasis: true })
    totals.push({ label: 'Balance on completion', amountCents: estimate.balance_due_cents })
  }

  const clientLines: string[] = []
  if (client) {
    clientLines.push(client.name)
    if (client.company_name) clientLines.push(client.company_name)
    const email = client.emails?.[0]
    const phone = client.phones?.[0]
    if (email) clientLines.push(email)
    if (phone) clientLines.push(phone)
    if (client.billing_address) clientLines.push(client.billing_address)
  }

  const propertyLines: string[] = []
  if (property) {
    propertyLines.push(property.address_line1)
    if (property.address_line2) propertyLines.push(property.address_line2)
    if (property.unit_lot) propertyLines.push(`Unit ${property.unit_lot}`)
    const cityLine = [
      [property.city, property.state].filter(Boolean).join(', '),
      property.zip,
    ]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (cityLine) propertyLines.push(cityLine)
  }

  return {
    kind: 'estimate',
    numberText: input.numberText,
    documentTitle: 'Estimate',
    projectTitle: (estimate.title ?? '').trim() || input.projectTitle,
    // Non-null by the estimate_issued_has_timestamp constraint once issued; the
    // fallback keeps a preview of a draft renderable rather than crashing.
    issuedAtISO: estimate.issued_at ?? estimate.created_at,
    expiresAtISO: estimate.expires_at,
    letterhead: buildLetterhead(company, input.logo),
    client: { heading: 'Client', lines: clientLines.length > 0 ? clientLines : ['—'] },
    property: { heading: 'Property', lines: propertyLines.length > 0 ? propertyLines : ['—'] },
    detailLevel: estimate.detail_level,
    lines: lineRows,
    groups,
    totals,
    terms: (estimate.terms ?? '').trim() || null,
    notesToClient: (estimate.notes_to_client ?? '').trim() || null,
    showSignatureBlock: true,
  }
}

/** Basis points as a percentage string: 625 → "6.25", 700 → "7". */
export function formatBasisPoints(bp: number): string {
  const fixed = (bp / 100).toFixed(2)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface GenerateResult {
  document: Tables<'document'>
  /** False when an existing snapshot was returned rather than a new one made. */
  created: boolean
}

export type GenerateOutcome =
  | ({ ok: true } & GenerateResult)
  | { ok: false; status: number; error: string }

/**
 * Generate and store the PDF snapshot for an issued estimate.
 *
 * Only ever called with the service-role client: it writes to a bucket that has no
 * insert policy at all, which is what stops a browser session from putting a file
 * where a document is supposed to be.
 */
export async function generateEstimateDocument(
  db: SupabaseClient<Database>,
  params: { companyId: string; estimateId: string; actorId: string },
): Promise<GenerateOutcome> {
  const { companyId, estimateId, actorId } = params

  const { data: estimate, error: estimateError } = await db
    .from('estimate')
    .select('*, project:project_id ( title, property:property_id ( *, client:client_id ( * ) ) )')
    .eq('id', estimateId)
    .eq('company_id', companyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (estimateError) return { ok: false, status: 500, error: estimateError.message }
  if (!estimate) return { ok: false, status: 404, error: 'Estimate not found.' }

  // A draft has no frozen content, so there is nothing legitimate to snapshot.
  if (estimate.status === 'draft') {
    return {
      ok: false,
      status: 409,
      error: 'Issue the estimate before generating its document.',
    }
  }

  // Idempotent fast path: the snapshot is write-once and already taken.
  if (estimate.pdf_document_id) {
    const { data: existing, error } = await db
      .from('document')
      .select('*')
      .eq('id', estimate.pdf_document_id)
      .eq('company_id', companyId)
      .maybeSingle()

    if (error) return { ok: false, status: 500, error: error.message }
    if (existing) return { ok: true, document: existing, created: false }
    // Pointer set but row missing: fall through and record it again rather than
    // leaving the estimate permanently without a retrievable document.
  }

  const { data: lines, error: linesError } = await db
    .from('estimate_line')
    .select('*')
    .eq('estimate_id', estimateId)
    .order('sort_order', { ascending: true })

  if (linesError) return { ok: false, status: 500, error: linesError.message }
  if (!lines || lines.length === 0) {
    return { ok: false, status: 409, error: 'Estimate has no line items.' }
  }

  const { data: company, error: companyError } = await db
    .from('company')
    .select('*')
    .eq('id', companyId)
    .maybeSingle()

  if (companyError) return { ok: false, status: 500, error: companyError.message }
  if (!company) return { ok: false, status: 404, error: 'Company not found.' }

  // 1. Allocate the number. Atomic, and the one step that cannot be retried
  //    idly — a retry burns a number and leaves a gap.
  const { data: number, error: numberError } = await db.rpc('allocate_document_number', {
    p_company_id: companyId,
    p_kind: 'estimate',
  })

  if (numberError) return { ok: false, status: 500, error: numberError.message }
  if (typeof number !== 'number') {
    return { ok: false, status: 500, error: 'Document number allocation returned no number.' }
  }

  const { data: numberText, error: textError } = await db.rpc('document_number_text', {
    p_kind: 'estimate',
    p_number: number,
  })

  if (textError) return { ok: false, status: 500, error: textError.message }
  if (typeof numberText !== 'string') {
    return { ok: false, status: 500, error: 'Document number formatting returned no text.' }
  }

  // 2. Render.
  const project = (estimate as unknown as EstimateWithRelations).project ?? null
  const property = project?.property ?? null
  const client = property?.client ?? null

  const model = buildEstimateDocumentModel({
    estimate: estimate as unknown as Tables<'estimate'>,
    lines,
    company,
    client: client ?? null,
    property: property ?? null,
    projectTitle: project?.title ?? null,
    numberText,
    logo: await loadCompanyLogo(db, company.logo_path),
  })

  const bytes = await renderDocumentPdf(model)

  // 3. Hash exactly what will be stored.
  const sha256 = sha256Hex(bytes)

  // 4. Upload. upsert stays false: a stored document is never replaced (Law 3),
  //    so a path collision is a bug to surface, not something to overwrite.
  const storagePath = documentStoragePath(companyId, 'estimate', numberText, estimate.version)

  const { error: uploadError } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false })

  if (uploadError) return { ok: false, status: 500, error: `Storage upload failed: ${uploadError.message}` }

  // 5. Record, and link the estimate to its snapshot.
  const { data: document, error: recordError } = await db.rpc('record_document', {
    p_company_id: companyId,
    p_kind: 'estimate',
    p_related_id: estimateId,
    p_version: estimate.version,
    p_number: number,
    p_storage_path: storagePath,
    p_sha256: sha256,
    p_byte_size: bytes.length,
    p_actor: actorId,
  })

  if (recordError) {
    // Most likely the version-unique constraint: a concurrent caller got there
    // first. Return their document rather than an error — same frozen content,
    // and Law 5 says the second call changes nothing.
    const { data: raced } = await db
      .from('document')
      .select('*')
      .eq('company_id', companyId)
      .eq('kind', 'estimate')
      .eq('related_id', estimateId)
      .eq('version', estimate.version)
      .maybeSingle()

    if (raced) return { ok: true, document: raced, created: false }
    return { ok: false, status: 500, error: recordError.message }
  }

  return { ok: true, document: document as unknown as Tables<'document'>, created: true }
}

/** The shape of the nested select above, which the generated types flatten awkwardly. */
interface EstimateWithRelations {
  project: {
    title: string | null
    property: (Tables<'property'> & { client: Tables<'client'> | null }) | null
  } | null
}

/**
 * Re-render an already-issued estimate's document and return its hash.
 *
 * This is the tamper-evidence check: the same issued version must render to the
 * same bytes, so a hash that differs from the stored one means the file changed.
 * Nothing is written and no number is allocated — it reuses the recorded
 * number_text so the rendered body is identical to the original.
 */
export async function rehashEstimateDocument(
  db: SupabaseClient<Database>,
  params: { companyId: string; documentId: string },
): Promise<{ ok: true; sha256: string; matches: boolean } | { ok: false; status: number; error: string }> {
  const { data: document, error } = await db
    .from('document')
    .select('*')
    .eq('id', params.documentId)
    .eq('company_id', params.companyId)
    .maybeSingle()

  if (error) return { ok: false, status: 500, error: error.message }
  if (!document) return { ok: false, status: 404, error: 'Document not found.' }

  const { data: estimate, error: estimateError } = await db
    .from('estimate')
    .select('*, project:project_id ( title, property:property_id ( *, client:client_id ( * ) ) )')
    .eq('id', document.related_id)
    .eq('company_id', params.companyId)
    .maybeSingle()

  if (estimateError) return { ok: false, status: 500, error: estimateError.message }
  if (!estimate) return { ok: false, status: 404, error: 'Estimate not found.' }

  const [{ data: lines }, { data: company }] = await Promise.all([
    db
      .from('estimate_line')
      .select('*')
      .eq('estimate_id', document.related_id)
      .order('sort_order', { ascending: true }),
    db.from('company').select('*').eq('id', params.companyId).maybeSingle(),
  ])

  if (!lines || !company) return { ok: false, status: 500, error: 'Could not reload the estimate.' }

  const project = (estimate as unknown as EstimateWithRelations).project ?? null
  const property = project?.property ?? null

  const model = buildEstimateDocumentModel({
    estimate: estimate as unknown as Tables<'estimate'>,
    lines,
    company,
    client: property?.client ?? null,
    property: property ?? null,
    projectTitle: project?.title ?? null,
    numberText: document.number_text,
    logo: await loadCompanyLogo(db, company.logo_path),
  })

  const sha256 = sha256Hex(await renderDocumentPdf(model))
  return { ok: true, sha256, matches: sha256 === document.sha256 }
}

/**
 * Recompute an issued estimate's totals from its stored lines.
 *
 * Not used by the renderer, which reads the frozen columns. This exists so a
 * caller can ask whether the frozen numbers still agree with the lines underneath
 * them — a cheap integrity check that C19's evidence packet will want.
 */
export function recomputeIssuedTotals(
  estimate: Tables<'estimate'>,
  lines: Tables<'estimate_line'>[],
): { totalCents: number; matchesFrozen: boolean } {
  const computed = snapshot(lines.map(rowToDraft), termsOf(estimate))
  return {
    totalCents: computed.totals.breakdown.totalCents,
    matchesFrozen: computed.totals.breakdown.totalCents === estimate.total_cents,
  }
}
