import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

type Body = {
  email: string
  role: 'admin' | 'crew'
}

/**
 * POST /api/auth/invite
 *
 * Owners and admins can invite new team members. Creates an invite_token row
 * and sends the Supabase invite email (which includes the token in the link).
 *
 * Law 2: only owners and admins may call this. requireUser verifies from app_metadata.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return // requireUser already sent the error response

  const { email, role } = req.body as Body

  if (!email?.trim() || !['admin', 'crew'].includes(role)) {
    return res.status(400).json({ error: 'email and role (admin | crew) are required.' })
  }

  const client = getServiceRoleClient()

  // Store the invite token so we can look up company_id when the user clicks the link.
  const { data: invite, error: tokenErr } = await client
    .from('invite_token')
    .insert({
      company_id: caller.companyId,
      email: email.trim(),
      role,
      created_by: caller.id,
    })
    .select('token')
    .single()

  if (tokenErr || !invite) {
    console.error('[invite] token insert failed:', tokenErr)
    return res.status(500).json({ error: 'Failed to create invite.' })
  }

  // Supabase sends the magic-link email; the link lands on /auth/invite?token=...
  const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL}/auth/invite?token=${invite.token}`

  const { error: inviteErr } = await client.auth.admin.inviteUserByEmail(email.trim(), {
    redirectTo: inviteUrl,
    data: {
      // These land in user_metadata (NOT authoritative for auth) — purely informational.
      invited_by: caller.email,
    },
  })

  if (inviteErr) {
    // Clean up the token if the email send fails.
    await client.from('invite_token').delete().eq('token', invite.token)
    console.error('[invite] inviteUserByEmail failed:', inviteErr)
    return res.status(500).json({ error: inviteErr.message })
  }

  return res.status(200).json({ ok: true })
}
