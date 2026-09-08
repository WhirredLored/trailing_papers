import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getClients(req, res)
  if (req.method === 'POST') return createClient(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getClients(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { search } = req.query
  let query = getServiceRoleClient()
    .from('client')
    .select('id, name, company_name, emails, phones, created_at, updated_at')
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (search && typeof search === 'string') {
    // Basic prefix/ilike search for name/company_name
    query = query.or(`name.ilike.%${search}%,company_name.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

async function createClient(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { name, company_name, emails, phones, billing_address, notes, referral_source } = req.body

  if (!name) return res.status(400).json({ error: 'Client name is required.' })

  const client = getServiceRoleClient()

  // Fuzzy match duplicate guard
  if (name) {
    const { data: existing } = await client
      .from('client')
      .select('id, name')
      .eq('company_id', caller.companyId)
      .is('deleted_at', null)
      .ilike('name', `%${name}%`)
      .limit(1)

    // In a real app we might prompt the user, but for the API, if duplicate guard is strict:
    // If the frontend sets a ?force=true, we might bypass. We'll let the frontend handle the prompt by checking before calling POST, or by handling a 409.
    // For now, let's just create it, but we can do a duplicate check route or just return a warning if not forced.
    const duplicate = existing?.[0]
    if (duplicate && req.query.force !== 'true') {
      return res.status(409).json({
        error: 'Duplicate client detected.',
        existingId: duplicate.id,
        existingName: duplicate.name,
      })
    }
  }

  const { data, error } = await client
    .from('client')
    .insert({
      company_id: caller.companyId,
      name,
      company_name: company_name || null,
      emails: Array.isArray(emails) ? emails : [],
      phones: Array.isArray(phones) ? phones : [],
      billing_address: billing_address || null,
      notes: notes || null,
      referral_source: referral_source || null,
      created_by: caller.id,
    })
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(201).json(data)
}
