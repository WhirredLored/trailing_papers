import { useState, type FormEvent } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'

export default function ResetPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const email = String(fd.get('email') ?? '').trim()

    try {
      const client = getBrowserClient()
      const { error: resetErr } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/update-password`,
      })
      if (resetErr) {
        setError(resetErr.message)
        return
      }
      setSent(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Reset password — PaperTrail</title>
        <meta name="description" content="Reset your PaperTrail account password." />
      </Head>

      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Reset password</h1>

          {sent ? (
            <p className="auth-sub">
              Check your email for a reset link. It expires in one hour.
            </p>
          ) : (
            <>
              <p className="auth-sub">
                Enter your account email and we&apos;ll send a reset link.
              </p>
              <form onSubmit={handleSubmit} className="auth-form" noValidate>
                <label htmlFor="reset-email" className="field-label">Email</label>
                <input
                  id="reset-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  className="field-input"
                />

                {error && <p role="alert" className="auth-error">{error}</p>}

                <button id="reset-submit" type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Sending…' : 'Send reset link'}
                </button>
              </form>
            </>
          )}

          <p className="auth-footer">
            <Link href="/auth/login" className="auth-link">Back to sign in</Link>
          </p>
        </div>
      </main>
    </>
  )
}
