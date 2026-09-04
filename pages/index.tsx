import Head from 'next/head'
import Link from 'next/link'
import Shell from '@/components/Shell'

export default function Home() {
  return (
    <>
      <Head>
        <title>PaperTrail</title>
        <meta name="description" content="Field-first contracting software." />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <Shell
        title="PaperTrail"
        subtitle="Field-first contracting software. Estimate, sign, document, invoice, get paid."
      >
        <p className="text-slate-600">
          Auth and multi-tenancy are live (C02). Cross-tenant isolation is enforced in the database.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <Link href="/auth/login" className="auth-link">Sign in →</Link>
          <Link href="/auth/signup" className="auth-link">Create account →</Link>
        </div>
      </Shell>
    </>
  )
}

