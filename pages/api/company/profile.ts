import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import type { Update } from '@/types/db'

/**
 * GET  /api/company/profile — returns the caller's company profile
 * PATCH /api/company/profile — updates profile fields (owner/admin only)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return getProfile(req, res)
  }
  if (req.method === 'PATCH') {
    return patchProfile(req, res)
  }
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getProfile(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { data, error } = await getServiceRoleClient()
    .from('company')
    .select(
      'id, name, legal_name, dba, address_line1, address_line2, city, state, zip, ' +
        'phone, email, website, tax_id, default_tax_bp, payment_terms_days, ' +
        'deposit_pct, deposit_fixed_cents, currency, license_number, license_expires_at, ' +
        'insurance_carrier, insurance_policy, insurance_expires_at, logo_path, ' +
        'created_at, updated_at',
    )
    .eq('id', caller.companyId)
    .is('deleted_at', null)
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

// Fields the client is allowed to patch — no id, no company_id, no audit cols.
const PATCHABLE = new Set([
  'name',
  'legal_name',
  'dba',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'zip',
  'phone',
  'email',
  'website',
  'tax_id',
  'default_tax_bp',
  'payment_terms_days',
  'deposit_pct',
  'deposit_fixed_cents',
  'license_number',
  'license_expires_at',
  'insurance_carrier',
  'insurance_policy',
  'insurance_expires_at',
])

async function patchProfile(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const body = req.body as Record<string, unknown>
  const patch: Update<'company'> = {}
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE.has(k)) (patch as Record<string, unknown>)[k] = v
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No patchable fields provided.' })
  }

  const { data, error } = await getServiceRoleClient()
    .from('company')
    .update(patch)
    .eq('id', caller.companyId)
    .is('deleted_at', null)
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json({ ok: true, id: data.id })
}
