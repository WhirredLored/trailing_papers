import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { routeParam } from '@/lib/api-params'
import { recordShareLinkView } from '@/lib/share-server'
import { loadVerifiedDocumentBytes, sendDocumentPdf } from '@/lib/document-server'

/**
 * Public document PDF download authorized by share token (C10 item 2).
 *
 * Goes through recordShareLinkView — the same status check and access-logging
 * path pages/v/[token].tsx uses — rather than re-deriving revoked/expired here,
 * so a direct download (a bookmarked link, an email client's link-prefetcher)
 * logs an open and increments view_count exactly like opening the viewer page
 * does (Law 7). Then streams the stored PDF snapshot, verifying the SHA-256
 * evidence chain before responding.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const token = routeParam(req, 'token')
  if (!token) {
    return res.status(400).json({ error: 'Invalid share token.' })
  }

  const db = getServiceRoleClient()

  const forwarded = req.headers['x-forwarded-for']
  const forwardedIp = typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : null
  const ip = forwardedIp || req.socket?.remoteAddress || null
  const userAgent = req.headers['user-agent'] ?? null
  const referer = req.headers['referer'] ?? null

  const view = await recordShareLinkView(db, token, { ip, userAgent, referer })

  if (view.status === 'revoked') {
    return res.status(410).json({ error: 'This share link has been revoked.' })
  }
  if (view.status === 'expired') {
    return res.status(410).json({ error: 'This share link has expired.' })
  }
  if (view.status !== 'active' || !view.documentId || !view.companyId) {
    return res.status(404).json({ error: 'Link not found.' })
  }

  const { data: document, error: docError } = await db
    .from('document')
    .select('storage_path, sha256, number_text')
    .eq('id', view.documentId)
    .eq('company_id', view.companyId)
    .maybeSingle()

  if (docError || !document) {
    return res.status(404).json({ error: 'Document not found.' })
  }

  const result = await loadVerifiedDocumentBytes(db, document)
  if (!result.ok) {
    return res.status(result.status).json({ error: result.error })
  }

  sendDocumentPdf(res, document, result.bytes, 'private, max-age=3600')
}
