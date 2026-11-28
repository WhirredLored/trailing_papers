import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'
import { revokeShareLink } from '@/lib/share-server'

/**
 * Revoke a share link (C10).
 *
 * Owner/admin only (Law 2). Revocation is final and immutable.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const linkId = routeParam(req, 'id')
  if (!linkId) {
    return res.status(400).json({ error: 'Invalid share link id.' })
  }

  const result = await revokeShareLink(getServiceRoleClient(), {
    companyId: caller.companyId,
    linkId,
    revokedBy: caller.id,
  })

  if (!result.ok) {
    const status = result.error === 'Share link not found.' ? 404 : 400
    return res.status(status).json({ error: result.error ?? 'Could not revoke share link.' })
  }

  return res.status(200).json({ ok: true })
}
