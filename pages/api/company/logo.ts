import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

/**
 * POST /api/company/logo
 *
 * Accepts a base64-encoded image in the request body, validates size and type,
 * uploads to the company-assets Storage bucket, and stores the path on company.
 *
 * Body: { data: string (base64), mimeType: string, ext: string }
 *
 * Storage path: <company_id>/logo.<ext>
 *
 * Law 9: service-role key is server-only; Storage upload uses it.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })

  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const { data: b64, mimeType, ext } = req.body as {
    data: string
    mimeType: string
    ext: string
  }

  const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml'])
  if (!ALLOWED_MIME.has(mimeType)) {
    return res.status(400).json({ error: 'Unsupported image type. Use JPEG, PNG, WebP, or SVG.' })
  }
  if (!ext || !/^[a-z0-9]{1,5}$/.test(ext)) {
    return res.status(400).json({ error: 'Invalid file extension.' })
  }
  if (!b64) return res.status(400).json({ error: 'No image data provided.' })

  // 5 MB cap (base64 is ~4/3 the byte size)
  const MAX_BYTES = 5 * 1024 * 1024
  const byteLen = Math.ceil((b64.length * 3) / 4)
  if (byteLen > MAX_BYTES) {
    return res.status(400).json({ error: 'Image exceeds 5 MB limit.' })
  }

  const buffer = Buffer.from(b64, 'base64')
  const storagePath = `${caller.companyId}/logo.${ext}`
  const client = getServiceRoleClient()

  const { error: uploadErr } = await client.storage
    .from('company-assets')
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: true, // replace existing logo
    })

  if (uploadErr) {
    console.error('[logo] storage upload failed:', uploadErr)
    return res.status(500).json({ error: uploadErr.message })
  }

  // Persist the path on the company row.
  const { error: updateErr } = await client
    .from('company')
    .update({ logo_path: storagePath })
    .eq('id', caller.companyId)

  if (updateErr) {
    console.error('[logo] company update failed:', updateErr)
    return res.status(500).json({ error: updateErr.message })
  }

  return res.status(200).json({ ok: true, path: storagePath })
}

export const config = { api: { bodyParser: { sizeLimit: '8mb' } } }
