import { useState, type FormEvent } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { getBrowserClient } from '@/lib/supabase-browser'

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const fd = new FormData(e.currentTarget)
    const companyName = String(fd.get('companyName') ?? '').trim()
    const fullName = String(fd.get('fullName') ?? '').trim()
    const email = String(fd.get('email') ?? '').trim()
    const password = String(fd.get('password') ?? '')

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, fullName, email, password }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error ?? 'Signup failed.')
        return
      }

      // Sign in immediately after account creation.
      const client = getBrowserClient()
      const { error: signInErr } = await client.auth.signInWithPassword({ email, password })
      if (signInErr) {
        setError('Account created — please sign in.')
        void router.push('/auth/login')
        return
      }

      void router.push('/')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Head>
        <title>Create your PaperTrail account</title>
        <meta name="description" content="Sign up for PaperTrail — field-first contracting software." />
      </Head>

      <main className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-title">Create your account</h1>
          <p className="auth-sub">Start with a free company workspace.</p>

          <form onSubmit={handleSubmit} className="auth-form" noValidate>
            <label htmlFor="signup-company" className="field-label">Company name</label>
            <input
              id="signup-company"
              name="companyName"
              type="text"
              required
              autoComplete="organization"
              className="field-input"
              placeholder="e.g. Huestone Holdings"
            />

            <label htmlFor="signup-name" className="field-label">Your name</label>
            <input
              id="signup-name"
              name="fullName"
              type="text"
              autoComplete="name"
              className="field-input"
              placeholder="Optional"
            />

            <label htmlFor="signup-email" className="field-label">Email</label>
            <input
              id="signup-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="field-input"
            />

            <label htmlFor="signup-password" className="field-label">Password</label>
            <input
              id="signup-password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              minLength={8}
              className="field-input"
            />

            {error && <p role="alert" className="auth-error">{error}</p>}

            <button id="signup-submit" type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="auth-footer">
            Already have an account?{' '}
            <Link href="/auth/login" className="auth-link">Sign in</Link>
          </p>
        </div>
      </main>
    </>
  )
}
