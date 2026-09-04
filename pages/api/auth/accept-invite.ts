import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'

type Body = {
  token: string
  password: string
  fullName?: string
}

/**
 * POST /api/auth/accept-invite
 *
 * Called when a new crew/admin member clicks their invite link and sets a password.
 * Looks up the invite_token, stamps app_metadata with company_id + role, then
 * creates the app_user mirror row and marks the token used.
 *
 * The caller is the newly-confirmed Supabase user (their session token is in the header).
 * We read company_id and role from the invite_token row (server-controlled), never from
 * the request body.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const { token, password, fullName } = req.body as Body

  if (!token?.trim() || !password) {
    return res.status(400).json({ error: 'token and password are required.' })
  }

  const authHeader = req.headers.authorization ?? ''
  const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!sessionToken) {
    return res.status(401).json({ error: 'Missing authorization header.' })
  }

  const client = getServiceRoleClient()

  // Verify the caller's session.
  const { data: { user }, error: userErr } = await client.auth.getUser(sessionToken)
  if (userErr || !user) {
    return res.status(401).json({ error: 'Invalid or expired session.' })
  }

  // Look up invite token — must be unused and unexpired.
  const { data: invite, error: tokenErr } = await client
    .from('invite_token')
    .select('id, company_id, role, email, expires_at, used_at')
    .eq('token', token.trim())
    .single()

  if (tokenErr || !invite) {
    return res.status(400).json({ error: 'Invalid invite token.' })
  }
  if (invite.used_at) {
    return res.status(400).json({ error: 'Invite token has already been used.' })
  }
  if (new Date(invite.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Invite token has expired.' })
  }
  if (invite.email.toLowerCase() !== (user.email ?? '').toLowerCase()) {
    return res.status(403).json({ error: 'Invite token does not match your email.' })
  }

  // Stamp app_metadata with company_id and role (Law 2).
  const { error: metaErr } = await client.auth.admin.updateUserById(user.id, {
    app_metadata: { company_id: invite.company_id, role: invite.role },
    password,
  })
  if (metaErr) {
    console.error('[accept-invite] updateUserById failed:', metaErr)
    return res.status(500).json({ error: 'Failed to set account metadata.' })
  }

  // Create app_user mirror row.
  const { error: appUserErr } = await client.from('app_user').insert({
    id: user.id,
    company_id: invite.company_id,
    role: invite.role,
    full_name: fullName?.trim() ?? null,
    created_by: user.id,
  })
  if (appUserErr) {
    console.error('[accept-invite] app_user insert failed:', appUserErr)
    return res.status(500).json({ error: 'Failed to create user profile.' })
  }

  // Mark token used.
  await client.from('invite_token').update({ used_at: new Date().toISOString() }).eq('id', invite.id)

  return res.status(200).json({ ok: true })
}
