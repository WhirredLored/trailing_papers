import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'
import { createShareLink, getDocumentShareLinks } from '@/lib/share-server'

/**
 * Manage share links for an issued document (C10).
 *
 * GET  — list share links and access logs for this document (staff)
 * POST — create a new revocable, tokenized share link (owner/admin)
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const documentId = routeParam(req, 'id')
  if (!documentId) {
    return res.status(400).json({ error: 'Invalid document id.' })
  }

  const db = getServiceRoleClient()

  // Ensure document exists and belongs to the caller's company (Law 1 / Law 2)
  const { data: document, error: docError } = await db
    .from('document')
    .select('id, company_id')
    .eq('id', documentId)
    .eq('company_id', caller.companyId)
    .maybeSingle()

  if (docError) return res.status(500).json({ error: docError.message })
  if (!document) return res.status(404).json({ error: 'Document not found.' })

  if (req.method === 'GET') {
    try {
      const links = await getDocumentShareLinks(db, {
        companyId: caller.companyId,
        documentId,
      })
      return res.status(200).json({ links })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load share links.'
      return res.status(500).json({ error: message })
    }
  }

  if (req.method === 'POST') {
    if (caller.role !== 'owner' && caller.role !== 'admin') {
      return res.status(403).json({ error: 'Only owners and admins can create share links.' })
    }

    const expiresInDays =
      typeof req.body?.expiresInDays === 'number' ? req.body.expiresInDays : undefined

    try {
      const { link, rawToken } = await createShareLink(db, {
        companyId: caller.companyId,
        documentId,
        createdBy: caller.id,
        expiresInDays,
      })

      const origin =
        process.env.NEXT_PUBLIC_APP_URL ||
        (req.headers['x-forwarded-proto'] && req.headers.host
          ? `${req.headers['x-forwarded-proto']}://${req.headers.host}`
          : req.headers.host
            ? `http://${req.headers.host}`
            : '')

      const shareUrl = `${origin}/v/${rawToken}`

      return res.status(201).json({
        link,
        rawToken,
        shareUrl,
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create share link.'
      return res.status(500).json({ error: message })
    }
  }

  return res.status(405).json({ error: 'Method not allowed.' })
}
