import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getProjects(req, res)
  if (req.method === 'POST') return createProject(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getProjects(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { property_id } = req.query
  let query = getServiceRoleClient()
    .from('project')
    .select('*, property(address_line1, client(name))')
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (property_id && typeof property_id === 'string') {
    query = query.eq('property_id', property_id)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

async function createProject(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { property_id, title, status, scope_summary, start_date, target_date } = req.body

  if (!property_id || !title) {
    return res.status(400).json({ error: 'property_id and title are required.' })
  }

  const client = getServiceRoleClient()

  const { data, error } = await client
    .from('project')
    .insert({
      company_id: caller.companyId,
      property_id,
      title,
      status: status || 'lead',
      scope_summary: scope_summary || null,
      start_date: start_date || null,
      target_date: target_date || null,
      created_by: caller.id
    })
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json(data)
}
