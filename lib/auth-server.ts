import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from './supabase-server'

/**
 * Role values as stored in app_metadata — never read from user_metadata
 * (Architecture Law 2).
 */
export type UserRole = 'owner' | 'admin' | 'crew'

export interface AuthUser {
  id: string
  companyId: string
  role: UserRole
  email: string
}

/**
 * requireUser — verifies the session and (optionally) the caller's role in
 * every API route that needs it. This is a control, not a convenience: Law 2
 * says re-check auth in every route; middleware alone is not sufficient.
 *
 * Reads role from app_metadata in the JWT — NEVER from user_metadata, which
 * is user-writable and unsafe for authorization decisions.
 *
 * @param req     The Next.js API request.
 * @param res     The Next.js API response (used to send 401/403 early).
 * @param roles   Optional allowlist of roles. Omit to allow any authenticated user.
 * @returns       The authenticated user, or null if already responded with an error.
 */
export async function requireUser(
  req: NextApiRequest,
  res: NextApiResponse,
  roles?: UserRole[],
): Promise<AuthUser | null> {
  const authHeader = req.headers.authorization ?? ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token) {
    res.status(401).json({ error: 'Missing authorization header.' })
    return null
  }

  const client = getServiceRoleClient()
  const { data, error } = await client.auth.getUser(token)

  if (error || !data.user) {
    res.status(401).json({ error: 'Invalid or expired session.' })
    return null
  }

  const user = data.user
  // Law 2: authorization data MUST come from app_metadata, never user_metadata.
  const appMeta = (user.app_metadata ?? {}) as Record<string, string>
  const companyId = appMeta['company_id']
  const role = appMeta['role'] as UserRole | undefined

  if (!companyId || !role) {
    res
      .status(403)
      .json({ error: 'Account is not associated with a company. Contact your administrator.' })
    return null
  }

  if (roles && !roles.includes(role)) {
    res.status(403).json({ error: 'Insufficient permissions.' })
    return null
  }

  return {
    id: user.id,
    companyId,
    role,
    email: user.email ?? '',
  }
}
