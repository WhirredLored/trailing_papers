import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'
import { asJson, rowToDraft, snapshot, termsOf } from '@/lib/estimate-server'
import { generateEstimateDocument } from '@/lib/document-server'
import type { Enums } from '@/types/db'

const DETAIL_LEVELS: Enums<'estimate_detail_level'>[] = ['itemized', 'summary']

/** How long an issued estimate stands unless the contractor says otherwise. */
const DEFAULT_VALID_DAYS = 30

/**
 * Issue an estimate — the moment it stops being editable (Law 3).
 *
 * The route recomputes the totals from the stored lines and hands them to
 * issue_estimate(), which locks the row, freezes the content, stamps issued_at
 * and supersedes the version this one revises. Issuing twice is a no-op: the
 * function returns the already-frozen row rather than re-freezing it (Law 5).
 *
 * Issuing puts a number in front of a client, so it is an owner/admin action.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Invalid estimate id.' })

  const body = req.body as Record<string, unknown>

  const detailLevel = (body['detail_level'] ?? 'itemized') as Enums<'estimate_detail_level'>
  if (!DETAIL_LEVELS.includes(detailLevel)) {
    return res.status(400).json({ error: 'detail_level must be itemized or summary.' })
  }

  let expiresAt: string
  if (body['expires_at'] === undefined || body['expires_at'] === null) {
    const fallback = new Date()
    fallback.setDate(fallback.getDate() + DEFAULT_VALID_DAYS)
    expiresAt = fallback.toISOString()
  } else if (
    typeof body['expires_at'] === 'string' &&
    !Number.isNaN(Date.parse(body['expires_at']))
  ) {
    expiresAt = new Date(body['expires_at']).toISOString()
  } else {
    return res.status(400).json({ error: 'expires_at must be a date.' })
  }

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

  // Already issued — say so plainly and hand back the frozen row.
  if (estimate.status !== 'draft') {
    return res.status(200).json({ estimate, already_issued: true })
  }

  const { data: lines, error: linesError } = await db
    .from('estimate_line')
    .select('*')
    .eq('estimate_id', id)
    .order('sort_order', { ascending: true })

  if (linesError) return res.status(500).json({ error: linesError.message })
  if (!lines || lines.length === 0) {
    return res.status(400).json({ error: 'Add at least one line before issuing.' })
  }

  // Totals come from the stored lines, computed here — never from the client.
  const computed = snapshot(lines.map(rowToDraft), termsOf(estimate))

  const { data, error: issueError } = await db.rpc('issue_estimate', {
    p_estimate_id: id,
    p_company_id: caller.companyId,
    p_detail_level: detailLevel,
    p_expires_at: expiresAt,
    p_totals: asJson(computed.totalsJson),
    p_profit: asJson(computed.profitJson),
  })

  if (issueError) return res.status(400).json({ error: issueError.message })

  // Take the PDF snapshot (C09). The estimate is already frozen and committed by
  // this point, so a generation failure must NOT be reported as a failure to
  // issue: that would tell the contractor their estimate did not go out when it
  // did, and a retry would find it already issued. Instead the estimate comes
  // back with document: null and a reason, and POST /api/estimate/:id/document
  // retries generation on its own.
  const generated = await generateEstimateDocument(db, {
    companyId: caller.companyId,
    estimateId: id,
    actorId: caller.id,
  })

  return res.status(200).json({
    estimate: data,
    already_issued: false,
    document: generated.ok ? generated.document : null,
    document_error: generated.ok ? null : generated.error,
  })
}
