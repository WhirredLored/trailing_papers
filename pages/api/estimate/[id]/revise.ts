import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'

/**
 * Create a revision — the only way to change an issued estimate (Law 3).
 *
 * create_estimate_revision() clones the estimate and its lines to version N+1 in
 * draft. The version being revised is NOT superseded here: it stays standing
 * until the revision is actually issued, so an abandoned draft leaves the client
 * holding a live estimate rather than a cancelled one.
 *
 * Idempotent: asking twice returns the same draft revision (Law 5).
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Invalid estimate id.' })

  const { data, error } = await getServiceRoleClient().rpc('create_estimate_revision', {
    p_estimate_id: id,
    p_company_id: caller.companyId,
    p_actor: caller.id,
  })

  if (error) {
    // P0002 is the function's "not found"; everything else it raises is a
    // refusal the contractor should read (still a draft, wrong company).
    const status = error.code === 'P0002' ? 404 : 400
    return res.status(status).json({ error: error.message })
  }

  return res.status(201).json({ estimate: data })
}
