import { useState, useEffect, type FormEvent } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'

/**
 * /auth/update-password — Supabase redirects here after the user clicks the
 * password-reset email link. The URL contains a recovery token which Supabase
 * automatically exchanges for a session via the hash fragment.
 */
export default function UpdatePasswordPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Supabase exchanges the recovery token from the hash fragment on page load.
  useEffect(() => {
    const client = getBrowserClient()
    const { data: { subscription } } = client.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const password = String(fd.get('password') ?? '')
    const confirm = String(fd.get('confirm') ?? '')

    if (password !== confirm) {
      setError('Passwords do not match.')
      setLoading(false)
      return
    }

    try {
      const client = getBrowserClient()
      const { error: updateErr } = await client.auth.updateUser({ password })
      if (updateErr) {
        setError(updateErr.message)
        return
      }
      setDone(true)
      setTimeout(() => { void router.push('/') }, 2000)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Set new password — PaperTrail</title>
        <meta name="description" content="Set a new password for your PaperTrail account." />
      </Head>

      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Set new password</h1>

          {done ? (
            <p className="auth-sub">Password updated — redirecting…</p>
          ) : !ready ? (
            <p className="auth-sub">Verifying reset link…</p>
          ) : (
            <form onSubmit={handleSubmit} className="auth-form" noValidate>
              <label htmlFor="update-password" className="field-label">New password</label>
              <input
                id="update-password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                className="field-input"
              />

              <label htmlFor="update-confirm" className="field-label">Confirm password</label>
              <input
                id="update-confirm"
                name="confirm"
                type="password"
                required
                autoComplete="new-password"
                minLength={8}
                className="field-input"
              />

              {error && <p role="alert" className="auth-error">{error}</p>}

              <button id="update-password-submit" type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}

          <p className="auth-footer">
            <Link href="/auth/login" className="auth-link">Back to sign in</Link>
          </p>
        </div>
      </main>
    </>
  )
}
