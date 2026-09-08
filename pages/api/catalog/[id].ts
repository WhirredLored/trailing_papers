import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'
import type { Update } from '@/types/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getCatalogItem(req, res)
  if (req.method === 'PATCH') return updateCatalogItem(req, res)
  if (req.method === 'DELETE') return archiveCatalogItem(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getCatalogItem(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Missing id.' })
  const client = getServiceRoleClient()

  // Fetch the item
  const { data, error } = await client
    .from('catalog_item')
    .select('*')
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Not found' })

  // Fetch price history for this item
  const { data: history } = await client
    .from('catalog_item_price_history')
    .select('id, old_price_cents, new_price_cents, changed_at, changed_by')
    .eq('catalog_item_id', id)
    .eq('company_id', caller.companyId)
    .order('changed_at', { ascending: false })
    .limit(50)

  return res.status(200).json({ ...data, price_history: history || [] })
}

const PATCHABLE = new Set([
  'code',
  'name',
  'description',
  'kind',
  'unit',
  'unit_cost_cents',
  'default_markup_bp',
  'taxable',
  'active',
  'notes',
])

async function updateCatalogItem(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Missing id.' })
  const patch: Update<'catalog_item'> = {}
  for (const [k, v] of Object.entries(req.body)) {
    if (PATCHABLE.has(k)) (patch as Record<string, unknown>)[k] = v
  }

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No changes.' })

  // Validate money fields if present
  if (
    'unit_cost_cents' in patch &&
    (!Number.isInteger(patch.unit_cost_cents) || (patch.unit_cost_cents as number) < 0)
  ) {
    return res.status(400).json({ error: 'unit_cost_cents must be a non-negative integer.' })
  }

  const { data, error } = await getServiceRoleClient()
    .from('catalog_item')
    .update(patch)
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `Item code already exists.` })
    }
    return res.status(500).json({ error: error.message })
  }
  return res.status(200).json({ ok: true, id: data.id })
}

/** Soft-delete (archive) rather than hard delete. Law 8: audit, don't delete. */
async function archiveCatalogItem(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Missing id.' })
  const { error } = await getServiceRoleClient()
    .from('catalog_item')
    .update({ deleted_at: new Date().toISOString(), deleted_by: caller.id })
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
