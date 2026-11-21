import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { routeParam } from '@/lib/api-params'
import { DOCUMENTS_BUCKET, sha256Hex } from '@/lib/document-server'

/**
 * Download a stored document, authorized by session (C09 item 5).
 *
 * Staff only, and only their own company's documents. Public token access for
 * clients — no account, unguessable link, access logged — is C10's job and
 * deliberately not bolted on here (Law 7 wants that logged, which needs the
 * share-link table C10 introduces).
 *
 * The bytes are streamed THROUGH this route rather than handed out as a signed
 * storage URL. A signed URL is a bearer token in a query string: it outlives the
 * session, survives in history and chat logs, and cannot be revoked. Proxying
 * costs a hop and keeps every retrieval behind a live session check.
 *
 * Any role may download. Crew standing on site needs the estimate they are
 * working from, and the document is already the client-facing artifact — it
 * carries no cost or margin figures, which is what `internal_notes` and the
 * profitability columns are for, and neither is rendered.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res)
  if (!caller) return

  const id = routeParam(req, 'id')
  if (!id) return res.status(400).json({ error: 'Invalid document id.' })

  const db = getServiceRoleClient()

  // Tenancy is re-checked here even though storage RLS also scopes the path: this
  // client holds the service-role key and bypasses RLS, so the filter IS the
  // control on this path (Law 2 — re-check in every route).
  const { data: document, error } = await db
    .from('document')
    .select('*')
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .maybeSingle()

  if (error) return res.status(500).json({ error: error.message })
  if (!document) return res.status(404).json({ error: 'Document not found.' })

  const { data: file, error: downloadError } = await db.storage
    .from(DOCUMENTS_BUCKET)
    .download(document.storage_path)

  if (downloadError || !file) {
    return res.status(502).json({
      error: `Stored document could not be read: ${downloadError?.message ?? 'missing file'}`,
    })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())

  // Tamper evidence, checked on the way out (Law 3 / Law 8). If the stored bytes
  // no longer hash to what was recorded at generation, something replaced the
  // file — so refuse to serve it rather than pass off an altered document as the
  // one that was issued. This is the entire reason the hash is stored.
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
  // A frozen document never changes, so it is safe to cache hard — privately,
  // since it is client data behind a session.
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable')
  res.setHeader('X-Document-Sha256', document.sha256)

  return res.status(200).send(Buffer.from(bytes))
}
