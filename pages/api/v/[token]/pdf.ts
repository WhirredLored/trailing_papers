import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { routeParam } from '@/lib/api-params'
import { hashShareToken } from '@/lib/share-server'
import { DOCUMENTS_BUCKET, sha256Hex } from '@/lib/document-server'

/**
 * Public document PDF download authorized by share token (C10 item 2).
 *
 * Checks that the token is active (not revoked, not expired), streams the stored
 * PDF snapshot, and verifies the SHA-256 evidence chain before responding.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const token = routeParam(req, 'token')
  if (!token) {
    return res.status(400).json({ error: 'Invalid share token.' })
  }

  const tokenHash = hashShareToken(token)
  const db = getServiceRoleClient()

  const { data: link, error: linkError } = await db
    .from('share_link')
    .select('id, company_id, document_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (linkError) return res.status(500).json({ error: linkError.message })
  if (!link) return res.status(404).json({ error: 'Link not found.' })

  if (link.revoked_at) {
    return res.status(410).json({ error: 'This share link has been revoked.' })
  }

  if (new Date(link.expires_at).getTime() <= Date.now()) {
    return res.status(410).json({ error: 'This share link has expired.' })
  }

  const { data: document, error: docError } = await db
    .from('document')
    .select('storage_path, sha256, number_text')
    .eq('id', link.document_id)
    .eq('company_id', link.company_id)
    .maybeSingle()

  if (docError || !document) {
    return res.status(404).json({ error: 'Document not found.' })
  }

  const { data: file, error: downloadError } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .download(document.storage_path)

  if (downloadError || !file) {
    return res.status(502).json({
      error: `Stored document could not be read: ${downloadError?.message ?? 'missing file'}`,
    })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const actual = sha256Hex(bytes)
  if (actual !== document.sha256) {
    return res.status(409).json({
      error:
        `Stored document ${document.number_text} does not match its recorded hash and was not served. ` +
        `Expected ${document.sha256}, found ${actual}.`,
    })
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', String(bytes.length))
  res.setHeader('Content-Disposition', `inline; filename="${document.number_text}.pdf"`)
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('X-Document-Sha256', document.sha256)

  return res.status(200).send(Buffer.from(bytes))
}
