import Head from 'next/head'
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
          Scaffold only — no authentication and no domain tables yet. Setup steps are in the
          README; the build order is in MILESTONES.md.
        </p>
      </Shell>
    </>
  )
}
