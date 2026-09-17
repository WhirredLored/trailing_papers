import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'
import { generateEstimateDocument } from '@/lib/document-server'

/**
 * Generate the PDF snapshot for an issued estimate (C09).
 *
 * Normally this happens automatically at issue. This route exists for the case
 * where issuing succeeded but generation did not — a storage blip, a bad logo —
 * which must not leave the estimate permanently without a retrievable document.
 *
 * Idempotent (Law 5): if the snapshot is already taken, this returns it and
 * reports created: false rather than making a second PDF of frozen content.
 *
 * Owner/admin, matching issue: a document carries the company's letterhead,
 * licence and insurance numbers in front of a client.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Invalid estimate id.' })

  const result = await generateEstimateDocument(getServiceRoleClient(), {
    companyId: caller.companyId,
    estimateId: id,
    actorId: caller.id,
  })

  if (!result.ok) return res.status(result.status).json({ error: result.error })

  return res.status(result.created ? 201 : 200).json({
    document: result.document,
    created: result.created,
  })
}
