import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { Tables } from '@/types/db'
import { buildEstimateDocumentModel } from '@/lib/document-server'
import { unitLabel, type DocumentModel } from '@/lib/pdf'

/**
 * Shareable client-facing documents (C10).
 *
 * Implements tokenized, revocable public access to issued documents with access
 * logging and zero internal cost/margin leakage (Law 7 / Law 10).
 */

export const DEFAULT_SHARE_EXPIRY_DAYS = 30

/** Hash a raw share token to 64-char lowercase hex sha256 for storage and lookup. */
export function hashShareToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

/**
 * Generate a cryptographically random share token (32 bytes = 64 hex chars)
 * and its SHA-256 hash.
 */
export function generateShareToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = hashShareToken(rawToken)
  return { rawToken, tokenHash }
}

export interface CreateShareLinkParams {
  companyId: string
  documentId: string
  createdBy?: string | null
  expiresInDays?: number | null
}

export interface CreateShareLinkResult {
  link: Tables<'share_link'>
  rawToken: string
}

/**
 * Create a new revocable share link for an issued document.
 *
 * The raw token is returned once and NEVER stored in the database.
 */
export async function createShareLink(
  db: SupabaseClient<Database>,
  params: CreateShareLinkParams,
): Promise<CreateShareLinkResult> {
  const { companyId, documentId, createdBy, expiresInDays } = params
  const { rawToken, tokenHash } = generateShareToken()

  const days = expiresInDays && expiresInDays > 0 ? expiresInDays : DEFAULT_SHARE_EXPIRY_DAYS
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const { data: link, error } = await db
    .from('share_link')
    .insert({
      company_id: companyId,
      document_id: documentId,
      token_hash: tokenHash,
      created_by: createdBy ?? null,
      expires_at: expiresAt,
    })
    .select()
    .single()

  if (error || !link) {
    throw new Error(`Failed to create share link: ${error?.message ?? 'unknown error'}`)
  }

  return { link, rawToken }
}

export interface RevokeShareLinkParams {
  companyId: string
  linkId: string
  revokedBy?: string | null
}

/**
 * Revoke an existing share link with attribution.
 */
export async function revokeShareLink(
  db: SupabaseClient<Database>,
  params: RevokeShareLinkParams,
): Promise<{ ok: boolean; error?: string }> {
  const { companyId, linkId, revokedBy } = params

  const { data, error } = await db
    .from('share_link')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: revokedBy ?? null,
    })
    .eq('id', linkId)
    .eq('company_id', companyId)
    .select('id')

  if (error) {
    return { ok: false, error: error.message }
  }

  // A zero-row update is not an error from Postgres's point of view, but a
  // wrong-company, stale, mistyped, or already-purged linkId would otherwise
  // report {ok: true} for a revoke that never happened.
  if (!data || data.length === 0) {
    return { ok: false, error: 'Share link not found.' }
  }

  return { ok: true }
}

export interface AccessLogInput {
  ip?: string | null
  userAgent?: string | null
  referer?: string | null
}

export type ShareLinkStatus = 'active' | 'expired' | 'revoked' | 'not_found'

export interface RecordViewResult {
  status: ShareLinkStatus
  shareLinkId: string | null
  documentId: string | null
  companyId: string | null
}

/**
 * Record a public view of a share link via the atomic database RPC.
 */
export async function recordShareLinkView(
  db: SupabaseClient<Database>,
  rawToken: string,
  access?: AccessLogInput,
): Promise<RecordViewResult> {
  const tokenHash = hashShareToken(rawToken)

  const { data, error } = await db.rpc('record_share_link_view', {
    p_token_hash: tokenHash,
    p_ip: access?.ip ?? null,
    p_user_agent: access?.userAgent ?? '',
    p_referer: access?.referer ?? '',
  })

  if (error) {
    throw new Error(`Failed to record share link view: ${error.message}`)
  }

  const row = data?.[0]
  if (!row) {
    return { status: 'not_found', shareLinkId: null, documentId: null, companyId: null }
  }

  return {
    status: (row.status as ShareLinkStatus) ?? 'not_found',
    shareLinkId: row.share_link_id ?? null,
    documentId: row.document_id ?? null,
    companyId: row.company_id ?? null,
  }
}

// ---------------------------------------------------------------------------
// Public Client View Model (Sanitized - Zero Internal Leaks)
// ---------------------------------------------------------------------------

export interface ClientDocumentPayload {
  shareLinkId: string
  documentNumber: string
  documentTitle: string
  projectTitle: string | null
  issuedAt: string
  expiresAt: string | null
  letterhead: {
    companyName: string
    dba: string | null
    addressLines: string[]
    phone: string | null
    email: string | null
    website: string | null
    licenseNumber: string | null
    insuranceCarrier: string | null
    insurancePolicy: string | null
    logoPath: string | null
  }
  client: { heading: string; lines: string[] }
  property: { heading: string; lines: string[] }
  detailLevel: 'itemized' | 'summary'
  lines: Array<{
    description: string
    quantity: string
    unit: string
    unitPriceCents: number
    amountCents: number
    derivation: string | null
    isOptional: boolean
    groupLabel: string | null
  }>
  groups: Array<{
    label: string
    subtotalCents: number
    optionalCents: number
    lineCount: number
  }>
  totals: Array<{
    label: string
    amountCents: number
    emphasis: boolean
  }>
  terms: string | null
  notesToClient: string | null
  rawToken: string
}

export type ResolveShareResult =
  | {
      ok: true
      status: 'active'
      document: ClientDocumentPayload
    }
  | {
      ok: false
      status: 'expired' | 'revoked' | 'not_found'
      contractor?: {
        name: string
        phone: string | null
        email: string | null
      }
    }

interface EstimateJoinResult {
  project?: {
    title: string | null
    property?: {
      address_line1: string
      address_line2: string | null
      unit_lot: string | null
      city: string
      state: string
      zip: string
      client?: {
        name: string
        company_name: string | null
        emails: string[] | null
        phones: string[] | null
        billing_address: string | null
      } | null
    } | null
  } | null
}

/**
 * Resolve a share token from an incoming public HTTP request, logging access
 * and returning the sanitized document payload.
 */
export async function resolveShareLink(
  db: SupabaseClient<Database>,
  rawToken: string,
  access?: AccessLogInput,
): Promise<ResolveShareResult> {
  const viewRecord = await recordShareLinkView(db, rawToken, access)

  if (viewRecord.status !== 'active' || !viewRecord.documentId || !viewRecord.companyId) {
    let contractor: { name: string; phone: string | null; email: string | null } | undefined
    if (viewRecord.companyId) {
      const { data: comp } = await db
        .from('company')
        .select('name, legal_name, phone, email')
        .eq('id', viewRecord.companyId)
        .maybeSingle()
      if (comp) {
        contractor = {
          name: comp.legal_name || comp.name,
          phone: comp.phone,
          email: comp.email,
        }
      }
    }
    const inactiveStatus: 'expired' | 'revoked' | 'not_found' =
      viewRecord.status === 'expired' || viewRecord.status === 'revoked'
        ? viewRecord.status
        : 'not_found'

    return {
      ok: false,
      status: inactiveStatus,
      contractor,
    }
  }

  // Load document row
  const { data: doc, error: docErr } = await db
    .from('document')
    .select('*')
    .eq('id', viewRecord.documentId)
    .eq('company_id', viewRecord.companyId)
    .maybeSingle()

  if (docErr || !doc) {
    return { ok: false, status: 'not_found' }
  }

  // Load estimate with relations
  const { data: estimate, error: estErr } = await db
    .from('estimate')
    .select('*, project:project_id ( title, property:property_id ( *, client:client_id ( * ) ) )')
    .eq('id', doc.related_id)
    .eq('company_id', viewRecord.companyId)
    .maybeSingle()

  if (estErr || !estimate) {
    return { ok: false, status: 'not_found' }
  }

  // Load estimate lines and company
  const [{ data: lines }, { data: company }] = await Promise.all([
    db
      .from('estimate_line')
      .select('*')
      .eq('estimate_id', doc.related_id)
      .order('sort_order', { ascending: true }),
    db.from('company').select('*').eq('id', viewRecord.companyId).maybeSingle(),
  ])

  if (!lines || !company) {
    return { ok: false, status: 'not_found' }
  }

  const join = estimate as unknown as EstimateJoinResult
  const project = join.project ?? null
  const property = project?.property ?? null
  const client = property?.client ?? null

  const model: DocumentModel = buildEstimateDocumentModel({
    estimate,
    lines,
    company,
    client: client as unknown as Tables<'client'> | null,
    property: property as unknown as Tables<'property'> | null,
    projectTitle: project?.title ?? null,
    numberText: doc.number_text,
    logo: null,
  })

  const payload: ClientDocumentPayload = {
    shareLinkId: viewRecord.shareLinkId!,
    documentNumber: model.numberText,
    documentTitle: model.documentTitle,
    projectTitle: model.projectTitle,
    issuedAt: model.issuedAtISO,
    expiresAt: model.expiresAtISO,
    letterhead: {
      companyName: model.letterhead.companyName,
      dba: model.letterhead.dba,
      addressLines: model.letterhead.addressLines,
      phone: model.letterhead.phone,
      email: model.letterhead.email,
      website: model.letterhead.website,
      licenseNumber: model.letterhead.licenseNumber,
      insuranceCarrier: model.letterhead.insuranceCarrier,
      insurancePolicy: model.letterhead.insurancePolicy,
      logoPath: company.logo_path,
    },
    client: model.client,
    property: model.property,
    detailLevel: model.detailLevel,
    lines: model.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      // DocumentModel stores the raw enum slug (`lin_ft`); the PDF renderer
      // humanizes it at the point of drawing (lib/pdf.ts's unitLabel()) and
      // this page is the other renderer of the same model, so it must too —
      // otherwise a client sees "lin_ft" in the table and "lin ft" two lines
      // below in the derivation, the exact mismatch unitLabel()'s own comment
      // describes.
      unit: unitLabel(l.unit),
      unitPriceCents: l.unitPriceCents,
      amountCents: l.amountCents,
      derivation: l.derivation,
      isOptional: l.isOptional,
      groupLabel: l.groupLabel,
    })),
    groups: model.groups.map((g) => ({
      label: g.label,
      subtotalCents: g.subtotalCents,
      optionalCents: g.optionalCents,
      lineCount: g.lineCount,
    })),
    totals: model.totals.map((t) => ({
      label: t.label,
      amountCents: t.amountCents,
      // getServerSideProps rejects `undefined` in its JSON-serialized props,
      // and DocumentModel's `emphasis` is an optional boolean that is simply
      // absent on non-emphasized rows — coalesce it to the false every other
      // reader of this field already treats an absent emphasis as.
      emphasis: t.emphasis ?? false,
    })),
    terms: model.terms,
    notesToClient: model.notesToClient,
    rawToken,
  }

  return {
    ok: true,
    status: 'active',
    document: payload,
  }
}

// ---------------------------------------------------------------------------
// Security: Leakage Assertions (for testing serialized JSON)
// ---------------------------------------------------------------------------

const FORBIDDEN_SUBSTRINGS = [
  'unit_cost',
  'unitcost',
  'internal_note',
  'internalnote',
  'profit',
  'margin',
  'markup_cents',
  'catalog_item_id',
  'assembly_id',
]

/**
 * Assert that a serialized string contains zero internal cost/margin or notes fields.
 */
export function assertNoInternalCostLeaks(serializedJson: string): void {
  const lower = serializedJson.toLowerCase()
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (lower.includes(needle)) {
      throw new Error(`Security defect: serialized client payload contains forbidden key "${needle}"`)
    }
  }
}

// ---------------------------------------------------------------------------
// Staff Share Links Query
// ---------------------------------------------------------------------------

export interface ShareLinkWithHistory extends Tables<'share_link'> {
  access_logs?: Tables<'share_link_access'>[]
}

export async function getDocumentShareLinks(
  db: SupabaseClient<Database>,
  params: { companyId: string; documentId: string },
): Promise<ShareLinkWithHistory[]> {
  const { companyId, documentId } = params

  const { data: links, error } = await db
    .from('share_link')
    .select('*, access_logs:share_link_access(*)')
    .eq('company_id', companyId)
    .eq('document_id', documentId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`Failed to load document share links: ${error.message}`)
  }

  return (links ?? []) as unknown as ShareLinkWithHistory[]
}
