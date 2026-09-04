import { useState, type FormEvent } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { getBrowserClient } from '@/lib/supabase-browser'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const email = String(fd.get('email') ?? '').trim()
    const password = String(fd.get('password') ?? '')

    try {
      const client = getBrowserClient()
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
      if (signInErr) {
        setError(signInErr.message)
        return
      }
      const next = typeof router.query.next === 'string' ? router.query.next : '/'
      void router.push(next)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Sign in — PaperTrail</title>
        <meta name="description" content="Sign in to your PaperTrail account." />
      </Head>

      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Sign in</h1>
          <p className="auth-sub">Welcome back to PaperTrail.</p>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <label htmlFor="login-email" className="field-label">Email</label>
            <input
              id="login-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="field-input"
            />

            <label htmlFor="login-password" className="field-label">Password</label>
            <input
              id="login-password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="field-input"
            />

            {error && <p role="alert" className="auth-error">{error}</p>}

            <button id="login-submit" type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="auth-footer">
            <Link href="/auth/reset-password" className="auth-link">Forgot password?</Link>
            {' · '}
            <Link href="/auth/signup" className="auth-link">Create account</Link>
          </div>
        </div>
      </main>
    </>
  )
}
