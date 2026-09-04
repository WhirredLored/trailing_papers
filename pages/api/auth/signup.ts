import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'

type Body = {
  companyName: string
  email: string
  password: string
  fullName?: string
}

/**
 * POST /api/auth/signup
 *
 * Creates a new company and an owner user atomically.
 * Sets company_id and role into app_metadata (Law 2) via the Admin API so the
 * JWT carries the correct claims the moment the user first signs in.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const { companyName, email, password, fullName } = req.body as Body

  if (!companyName?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: 'companyName, email, and password are required.' })
  }

  const client = getServiceRoleClient()

  // 1. Create company row (service role bypasses RLS — intentional for signup).
  const { data: company, error: companyErr } = await client
    .from('company')
    .insert({ name: companyName.trim() })
    .select('id')
    .single()

  if (companyErr || !company) {
    console.error('[signup] company insert failed:', companyErr)
    return res.status(500).json({ error: 'Failed to create company.' })
  }

  // 2. Create auth.users row with app_metadata stamped in from the start.
  const { data: authData, error: signupErr } = await client.auth.admin.createUser({
    email: email.trim(),
    password,
    email_confirm: true, // skip confirm email for now; add confirm flow in later commit
    app_metadata: {
      company_id: company.id,
      role: 'owner',
    },
    user_metadata: {
      full_name: fullName?.trim() ?? '',
    },
  })

  if (signupErr || !authData.user) {
    // Roll back company if auth creation failed.
    await client.from('company').delete().eq('id', company.id)
    console.error('[signup] auth.admin.createUser failed:', signupErr)
    return res.status(500).json({ error: signupErr?.message ?? 'Failed to create user.' })
  }

  // 3. Create the app_user mirror row.
  const { error: appUserErr } = await client.from('app_user').insert({
    id: authData.user.id,
    company_id: company.id,
    role: 'owner',
    full_name: fullName?.trim() ?? null,
    created_by: authData.user.id,
  })

  if (appUserErr) {
    // Roll back both if the mirror fails.
    await client.auth.admin.deleteUser(authData.user.id)
    await client.from('company').delete().eq('id', company.id)
    console.error('[signup] app_user insert failed:', appUserErr)
    return res.status(500).json({ error: 'Failed to create user profile.' })
  }

  return res.status(201).json({ ok: true, companyId: company.id, userId: authData.user.id })
}
