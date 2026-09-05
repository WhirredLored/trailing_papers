import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getCatalogItems(req, res)
  if (req.method === 'POST') return createCatalogItem(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getCatalogItems(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { search, kind, active } = req.query

  let query = getServiceRoleClient()
    .from('catalog_item')
    .select(
      'id, code, name, description, kind, unit, unit_cost_cents, default_markup_bp, taxable, active, notes, created_at, updated_at',
    )
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .order('code', { ascending: true })

  if (search && typeof search === 'string') {
    query = query.or(`code.ilike.%${search}%,name.ilike.%${search}%`)
  }

  if (kind && typeof kind === 'string') {
    query = query.eq('kind', kind)
  }

  // Default to active-only unless explicitly requesting all or inactive
  if (active === 'false') {
    query = query.eq('active', false)
  } else if (active !== 'all') {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

async function createCatalogItem(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const {
    code,
    name,
    description,
    kind,
    unit,
    unit_cost_cents,
    default_markup_bp,
    taxable,
    notes,
  } = req.body

  if (!code || !name) {
    return res.status(400).json({ error: 'Code and name are required.' })
  }

  if (unit_cost_cents !== undefined && (!Number.isInteger(unit_cost_cents) || unit_cost_cents < 0)) {
    return res.status(400).json({ error: 'unit_cost_cents must be a non-negative integer.' })
  }

  const { data, error } = await getServiceRoleClient()
    .from('catalog_item')
    .insert({
      company_id: caller.companyId,
      code,
      name,
      description: description || null,
      kind: kind || 'material',
      unit: unit || 'ea',
      unit_cost_cents: unit_cost_cents ?? 0,
      default_markup_bp: default_markup_bp ?? 0,
      taxable: taxable !== undefined ? taxable : true,
      notes: notes || null,
      created_by: caller.id,
    })
    .select('id')
    .single()

  if (error) {
    // Unique constraint on (company_id, code) — handle duplicate codes
    if (error.code === '23505') {
      return res.status(409).json({ error: `Item code "${code}" already exists.` })
    }
    return res.status(500).json({ error: error.message })
  }

  return res.status(201).json(data)
}
