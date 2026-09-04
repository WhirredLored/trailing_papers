import { useState, type FormEvent } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { getBrowserClient } from '@/lib/supabase-browser'

/**
 * /auth/invite — destination for invite email links.
 * The URL carries ?token=<hex> from our invite_token table.
 * The user sets their password here; we call /api/auth/accept-invite to
 * finalize the account (set app_metadata, create app_user row).
 */
export default function InvitePage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const fullName = String(fd.get('fullName') ?? '').trim()
    const password = String(fd.get('password') ?? '')
    const token = String(router.query.token ?? '').trim()

    if (!token) {
      setError('Missing invite token. Please use the link from your email.')
      setLoading(false)
      return
    }

    try {
      // Get the current session (Supabase auto-exchanges the hash from the invite email).
      const client = getBrowserClient()
      const { data: { session } } = await client.auth.getSession()

      if (!session) {
        setError('Your invite link has expired or is invalid. Ask for a new invite.')
        setLoading(false)
        return
      }

      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ token, password, fullName }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Failed to accept invite.')
        return
      }

      // Re-sign in so the new JWT has the fresh app_metadata claims.
      await client.auth.signOut()
      void router.push('/auth/login?invited=1')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Accept invitation — PaperTrail</title>
        <meta name="description" content="Set up your PaperTrail account." />
      </Head>

      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Join your team</h1>
          <p className="auth-sub">Set your name and a password to activate your account.</p>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <label htmlFor="invite-name" className="field-label">Your name</label>
            <input
              id="invite-name"
              name="fullName"
              type="text"
              autoComplete="name"
              className="field-input"
            />

            <label htmlFor="invite-password" className="field-label">Password</label>
            <input
              id="invite-password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              className="field-input"
            />

            {error && <p role="alert" className="auth-error">{error}</p>}

            <button id="invite-submit" type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Activating…' : 'Activate account'}
            </button>
          </form>
        </div>
      </main>
    </>
  )
}
