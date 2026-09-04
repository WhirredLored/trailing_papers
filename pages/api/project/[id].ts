import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getProject(req, res)
  if (req.method === 'PATCH') return updateProject(req, res)
  if (req.method === 'DELETE') return deleteProject(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getProject(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { id } = req.query
  const { data, error } = await getServiceRoleClient()
    .from('project')
    .select('*, property(address_line1, client(name))')
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  if (!data) return res.status(404).json({ error: 'Not found' })
  return res.status(200).json(data)
}

const PATCHABLE = new Set([
  'title', 'status', 'scope_summary', 'start_date', 'target_date'
])

async function updateProject(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { id } = req.query
  const patch: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(req.body)) {
    if (PATCHABLE.has(k)) patch[k] = v
  }

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No changes.' })

  const { data, error } = await getServiceRoleClient()
    .from('project')
    .update(patch)
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true, id: data.id })
}

async function deleteProject(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { id } = req.query
  const { error } = await getServiceRoleClient()
    .from('project')
    .update({ deleted_at: new Date().toISOString(), deleted_by: caller.id })
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true })
}
