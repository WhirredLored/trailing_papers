import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getProperties(req, res)
  if (req.method === 'POST') return createProperty(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getProperties(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { client_id } = req.query
  let query = getServiceRoleClient()
    .from('property')
    .select('*, client(name)')
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (client_id && typeof client_id === 'string') {
    query = query.eq('client_id', client_id)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

async function createProperty(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { client_id, address_line1, address_line2, city, state, zip, unit_lot, access_notes, year_built, notes } = req.body

  if (!client_id || !address_line1) {
    return res.status(400).json({ error: 'client_id and address_line1 are required.' })
  }

  const client = getServiceRoleClient()

  const { data, error } = await client
    .from('property')
    .insert({
      company_id: caller.companyId,
      client_id,
      address_line1,
      address_line2: address_line2 || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      unit_lot: unit_lot || null,
      access_notes: access_notes || null,
      year_built: year_built ? Number(year_built) : null,
      notes: notes || null,
      created_by: caller.id
    })
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json(data)
}
