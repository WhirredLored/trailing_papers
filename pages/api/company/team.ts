/**
 * Company team management API
 * GET  /api/company/team — list all app_users in the caller's company
 * PATCH /api/company/team — change role or deactivate a user (owner/admin)
 */
import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getTeam(req, res)
  if (req.method === 'PATCH') return patchTeam(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getTeam(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { data, error } = await getServiceRoleClient()
    .from('app_user')
    .select('id, role, full_name, created_at, deleted_at')
    .eq('company_id', caller.companyId)
    .order('created_at')

  if (error) return res.status(500).json({ error: error.message })
  return res.status(200).json(data)
}

async function patchTeam(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const { userId, role, deactivate } = req.body as {
    userId?: string
    role?: string
    deactivate?: boolean
  }

  if (!userId) return res.status(400).json({ error: 'userId is required.' })

  // Prevent self-deactivation.
  if (deactivate && userId === caller.id) {
    return res.status(400).json({ error: 'You cannot deactivate your own account.' })
  }

  // Admins cannot promote to owner.
  if (role === 'owner' && caller.role !== 'owner') {
    return res.status(403).json({ error: 'Only owners can assign the owner role.' })
  }

  const patch: Record<string, unknown> = {}
  if (role && ['owner', 'admin', 'crew'].includes(role)) patch.role = role
  if (deactivate) patch.deleted_at = new Date().toISOString()

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({ error: 'No changes provided.' })
  }

  const client = getServiceRoleClient()

  // Confirm the target user belongs to the caller's company.
  const { data: target, error: targetErr } = await client
    .from('app_user')
    .select('id, company_id')
    .eq('id', userId)
    .eq('company_id', caller.companyId)
    .single()

  if (targetErr || !target) {
    return res.status(404).json({ error: 'User not found in your company.' })
  }

  const { error: updateErr } = await client
    .from('app_user')
    .update({ ...patch, deleted_by: deactivate ? caller.id : undefined })
    .eq('id', userId)

  if (updateErr) return res.status(500).json({ error: updateErr.message })

  // If role changed, update app_metadata so the next JWT reflects it.
  if (role) {
    await client.auth.admin.updateUserById(userId, {
      app_metadata: { company_id: caller.companyId, role },
    })
  }

  return res.status(200).json({ ok: true })
}
