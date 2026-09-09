import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'
import { summarizeGroups } from '@/lib/estimate'
import {
  asJson,
  parseLines,
  payloadToDraft,
  rowToDraft,
  snapshot,
  termsOf,
} from '@/lib/estimate-server'
import type { Enums, Tables } from '@/types/db'

const PRICING_MODES: Enums<'estimate_pricing_mode'>[] = ['markup', 'margin']
const AMOUNT_MODES: Enums<'amount_mode'>[] = ['percent', 'fixed']

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getEstimate(req, res)
  if (req.method === 'PATCH') return saveDraft(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

/**
 * The estimate, its lines, and the money computed from them.
 *
 * The computed block is derived here rather than read back from the snapshot
 * columns so a draft always shows current numbers, and so the summary view has
 * its group totals without the client having to derive them.
 */
async function getEstimate(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Invalid estimate id.' })

  const db = getServiceRoleClient()

  const { data: estimate, error } = await db
    .from('estimate')
    .select('*, project:project_id ( id, title, property:property_id ( address_line1 ) )')
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!estimate) return res.status(404).json({ error: 'Estimate not found.' })

  const { data: lines, error: linesError } = await db
    .from('estimate_line')
    .select('*')
    .eq('estimate_id', id)
    .order('sort_order', { ascending: true })

  if (linesError) return res.status(500).json({ error: linesError.message })

  const drafts = (lines ?? []).map(rowToDraft)
  const computed = snapshot(drafts, termsOf(estimate as unknown as Tables<'estimate'>))

  return res.status(200).json({
    estimate,
    lines: lines ?? [],
    computed: {
      totals: computed.totals.breakdown,
      lineExtendedCents: computed.totals.lineExtendedCents,
      optionalTotalCents: computed.totals.optionalTotalCents,
      profit: computed.profit,
      groups: summarizeGroups(drafts),
    },
  })
}

/**
 * Save the whole draft — header terms and every line — in one atomic call.
 *
 * The totals written are computed here from the submitted LINES. Nothing the
 * client says about the money is stored (Law 4), and the database refuses the
 * write outright if the estimate is no longer a draft (Law 3).
 */
async function saveDraft(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Invalid estimate id.' })

  const body = req.body as Record<string, unknown>

  const parsed = parseLines(body['lines'] ?? [])
  if (!parsed.ok) return res.status(400).json({ error: parsed.error })

  const db = getServiceRoleClient()

  const { data: estimate, error } = await db
    .from('estimate')
    .select('*')
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!estimate) return res.status(404).json({ error: 'Estimate not found.' })

  if (estimate.status !== 'draft') {
    return res.status(409).json({
      error: `This estimate (v${estimate.version}) was issued and cannot be edited. Create a revision instead.`,
    })
  }

  // Header. Anything omitted keeps the value already stored.
  const header: Record<string, string | number | null> = {
    title: pickString(body['title'], estimate.title),
    terms: pickString(body['terms'], estimate.terms),
    notes_to_client: pickString(body['notes_to_client'], estimate.notes_to_client),
    internal_notes: pickString(body['internal_notes'], estimate.internal_notes),
    pricing_mode: estimate.pricing_mode,
    pricing_bp: estimate.pricing_bp,
    tax_rate_bp: estimate.tax_rate_bp,
    discount_mode: estimate.discount_mode,
    discount_value: estimate.discount_value,
    deposit_mode: estimate.deposit_mode,
    deposit_value: estimate.deposit_value,
  }

  if (body['pricing_mode'] !== undefined) {
    const mode = body['pricing_mode'] as Enums<'estimate_pricing_mode'>
    if (!PRICING_MODES.includes(mode)) {
      return res.status(400).json({ error: 'pricing_mode must be markup or margin.' })
    }
    header['pricing_mode'] = mode
  }

  for (const [field, max] of [
    ['pricing_bp', 50000],
    ['tax_rate_bp', 10000],
  ] as const) {
    if (body[field] !== undefined) {
      const value = body[field]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
        return res.status(400).json({ error: `${field} must be an integer between 0 and ${max}.` })
      }
      header[field] = value
    }
  }

  for (const [modeField, valueField] of [
    ['discount_mode', 'discount_value'],
    ['deposit_mode', 'deposit_value'],
  ] as const) {
    if (body[modeField] !== undefined) {
      const mode = body[modeField] as Enums<'amount_mode'>
      if (!AMOUNT_MODES.includes(mode)) {
        return res.status(400).json({ error: `${modeField} must be percent or fixed.` })
      }
      header[modeField] = mode
    }
    if (body[valueField] !== undefined) {
      const value = body[valueField]
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        return res
          .status(400)
          .json({ error: `${valueField} must be a non-negative integer.` })
      }
      header[valueField] = value
    }
  }

  const terms = {
    taxRateBp: header['tax_rate_bp'] as number,
    discountMode: header['discount_mode'] as Enums<'amount_mode'>,
    discountValue: header['discount_value'] as number,
    depositMode: header['deposit_mode'] as Enums<'amount_mode'>,
    depositValue: header['deposit_value'] as number,
  }

  const computed = snapshot(parsed.lines.map(payloadToDraft), terms)

  const { data, error: saveError } = await db.rpc('save_estimate_draft', {
    p_estimate_id: id,
    p_company_id: caller.companyId,
    p_header: asJson(header),
    p_lines: asJson(parsed.lines),
    p_totals: asJson(computed.totalsJson),
    p_profit: asJson(computed.profitJson),
    p_actor: caller.id,
  })

  if (saveError) return res.status(400).json({ error: saveError.message })

  return res.status(200).json({
    estimate: data,
    computed: {
      totals: computed.totals.breakdown,
      lineExtendedCents: computed.totals.lineExtendedCents,
      optionalTotalCents: computed.totals.optionalTotalCents,
      profit: computed.profit,
    },
  })
}

/** Take a submitted string, or keep what is stored when the field is absent. */
function pickString(value: unknown, fallback: string | null): string | null {
  if (value === undefined) return fallback
  if (value === null) return null
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
