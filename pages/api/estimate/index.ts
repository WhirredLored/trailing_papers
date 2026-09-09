import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

const ESTIMATE_COLUMNS =
  'id, project_id, version, status, title, detail_level, pricing_mode, pricing_bp, ' +
  'tax_rate_bp, discount_mode, discount_value, deposit_mode, deposit_value, ' +
  'subtotal_cents, discount_cents, taxable_subtotal_cents, tax_cents, total_cents, ' +
  'deposit_due_cents, balance_due_cents, estimated_cost_cents, margin_cents, margin_bp, ' +
  'issued_at, expires_at, pdf_document_id, revised_from_estimate_id, ' +
  'superseded_by_estimate_id, created_at, updated_at'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return listEstimates(req, res)
  if (req.method === 'POST') return createEstimate(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function listEstimates(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { project_id } = req.query

  let query = getServiceRoleClient()
    .from('estimate')
    .select(ESTIMATE_COLUMNS)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .order('version', { ascending: false })

  if (project_id && typeof project_id === 'string') {
    query = query.eq('project_id', project_id)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

/**
 * Start a draft. Tax rate and deposit terms default from the company profile
 * (C03) so the contractor is not retyping their own terms on every job; both
 * remain editable on the estimate.
 *
 * Versions are per project. A project holds at most one open draft at a time —
 * a second one would be two people editing the same estimate in two places,
 * which is how a job ends up quoted twice at two different numbers.
 */
async function createEstimate(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { project_id, title } = req.body as { project_id?: string; title?: string }

  if (!project_id || typeof project_id !== 'string') {
    return res.status(400).json({ error: 'project_id is required.' })
  }

  const db = getServiceRoleClient()

  const { data: project, error: projectError } = await db
    .from('project')
    .select('id, title')
    .eq('id', project_id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .maybeSingle()

  if (projectError) return res.status(500).json({ error: projectError.message })
  if (!project) return res.status(404).json({ error: 'Project not found.' })

  const { data: existing, error: existingError } = await db
    .from('estimate')
    .select('id, version, status')
    .eq('project_id', project_id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .order('version', { ascending: false })

  if (existingError) return res.status(500).json({ error: existingError.message })

  const openDraft = existing?.find((row) => row.status === 'draft')
  if (openDraft) {
    return res.status(409).json({
      error: `This project already has a draft estimate (v${openDraft.version}).`,
      estimate_id: openDraft.id,
    })
  }

  const nextVersion = (existing?.[0]?.version ?? 0) + 1

  const { data: company, error: companyError } = await db
    .from('company')
    .select('default_tax_bp, deposit_pct, deposit_fixed_cents')
    .eq('id', caller.companyId)
    .single()

  if (companyError) return res.status(500).json({ error: companyError.message })

  // The company profile stores the deposit as a percent OR a fixed amount,
  // never both (C03 constraint), so the mode follows whichever is set.
  const depositIsFixed = company.deposit_pct === null && company.deposit_fixed_cents !== null

  const { data, error } = await db
    .from('estimate')
    .insert({
      company_id: caller.companyId,
      project_id,
      version: nextVersion,
      status: 'draft',
      title: typeof title === 'string' && title.trim() !== '' ? title.trim() : project.title,
      tax_rate_bp: company.default_tax_bp ?? 0,
      deposit_mode: depositIsFixed ? 'fixed' : 'percent',
      deposit_value: depositIsFixed
        ? (company.deposit_fixed_cents ?? 0)
        : (company.deposit_pct ?? 0),
      created_by: caller.id,
    })
    .select(ESTIMATE_COLUMNS)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json(data)
}
