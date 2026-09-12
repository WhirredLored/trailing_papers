/**
 * SEED SCRIPT — a complete demo tenant you can actually log into.
 *
 * THIS IS SAMPLE DATA in a real project. It creates a company, an owner you can
 * sign in as, and enough of a client/property/project chain to reach the
 * estimate builder. Everything it creates is named with the DEMO_TAG below so it
 * can be found and removed again.
 *
 * The owner's company_id and role go in app_metadata, never user_metadata —
 * user_metadata is user-writable, and trusting it for authorization is privilege
 * escalation (Architecture Law 2). This is the same reason signing up through
 * the UI does not produce a usable account on its own: nothing has granted the
 * new user a tenant.
 *
 * Usage:
 *   npx tsx scripts/seed-demo-tenant.ts
 *   npx tsx scripts/seed-demo-tenant.ts --teardown
 *
 * Then follow the printed instructions to seed the catalog and assemblies.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase'

for (const file of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    // File doesn't exist — fine.
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

/** Everything this script creates carries this marker, so teardown can find it. */
const DEMO_TAG = 'DEMO'
const COMPANY_NAME = `${DEMO_TAG} — Ridgeline Exteriors`
const EMAIL = 'demo.owner@papertrail.test'
const PASSWORD = 'PaperTrail!2026'

const db = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function teardown() {
  const { data: companies } = await db.from('company').select('id, name').eq('name', COMPANY_NAME)

  for (const company of companies ?? []) {
    // Estimates first, and retire before purge: an issued estimate refuses a
    // hard delete until deleted_at is set (Law 8). Null the supersede pointer
    // too, or a v1/v2 pair references itself in both directions and neither can
    // go first.
    await db
      .from('estimate')
      .update({ superseded_by_estimate_id: null, deleted_at: new Date().toISOString() })
      .eq('company_id', company.id)

    const { data: estimates } = await db
      .from('estimate')
      .select('id')
      .eq('company_id', company.id)
      .order('version', { ascending: false })

    for (const estimate of estimates ?? []) {
      await db.from('estimate').delete().eq('id', estimate.id)
    }

    await db.from('assembly_component').delete().eq('company_id', company.id)
    await db.from('assembly').delete().eq('company_id', company.id)
    await db.from('catalog_item_price_history').delete().eq('company_id', company.id)
    await db.from('catalog_item').delete().eq('company_id', company.id)
    await db.from('project').delete().eq('company_id', company.id)
    await db.from('property').delete().eq('company_id', company.id)
    await db.from('client').delete().eq('company_id', company.id)

    const { data: users } = await db.auth.admin.listUsers()
    for (const user of users.users) {
      if (user.email === EMAIL) await db.auth.admin.deleteUser(user.id)
    }

    await db.from('app_user').delete().eq('company_id', company.id)

    const { error } = await db.from('company').delete().eq('id', company.id)
    console.log(error ? `  company delete failed: ${error.message}` : `  removed ${company.name}`)
  }

  console.log('Teardown complete.')
}

async function seed() {
  // Refuse to stack demo tenants on top of each other.
  const { data: existing } = await db.from('company').select('id').eq('name', COMPANY_NAME)
  if (existing && existing.length > 0) {
    console.error(
      `A demo tenant already exists (company ${existing[0]!.id}).\n` +
        `Run with --teardown first if you want a fresh one.`,
    )
    process.exit(1)
  }

  const { data: company, error: companyError } = await db
    .from('company')
    .insert({
      name: COMPANY_NAME,
      legal_name: 'Ridgeline Exteriors LLC',
      address_line1: '412 Contractor Row',
      city: 'Bellingham',
      state: 'WA',
      zip: '98225',
      phone: '(360) 555-0142',
      email: 'office@ridgeline.test',
      default_tax_bp: 875, // 8.75%
      payment_terms_days: 30,
      deposit_pct: 30,
    })
    .select('id')
    .single()

  if (companyError) {
    console.error(`company insert failed: ${companyError.message}`)
    process.exit(1)
  }
  const companyId = company!.id

  const { data: auth, error: authError } = await db.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    // Law 2: authorization comes from app_metadata.
    app_metadata: { company_id: companyId, role: 'owner' },
  })

  if (authError) {
    console.error(`auth user failed: ${authError.message}`)
    process.exit(1)
  }
  const userId = auth!.user!.id

  await db.from('app_user').insert({
    id: userId,
    company_id: companyId,
    role: 'owner',
    full_name: 'Dana Ridge',
    created_by: userId,
  })

  const { data: client } = await db
    .from('client')
    .insert({
      company_id: companyId,
      name: 'Marta Ellis',
      emails: ['marta.ellis@example.test'],
      phones: ['(360) 555-0177'],
      created_by: userId,
    })
    .select('id')
    .single()

  const { data: property } = await db
    .from('property')
    .insert({
      company_id: companyId,
      client_id: client!.id,
      address_line1: '88 Cedar Bluff Lane',
      city: 'Bellingham',
      state: 'WA',
      zip: '98226',
      access_notes: 'Gate code 4412. Dog in the back yard — friendly.',
      year_built: 1978,
      created_by: userId,
    })
    .select('id')
    .single()

  const { data: project } = await db
    .from('project')
    .insert({
      company_id: companyId,
      property_id: property!.id,
      title: 'Rear elevation siding replacement',
      status: 'estimating',
      scope_summary: 'Strip and replace vinyl siding on the rear elevation. Two windows to trim.',
      created_by: userId,
    })
    .select('id')
    .single()

  console.log('')
  console.log('  Demo tenant created.')
  console.log('')
  console.log('  Sign in at   http://localhost:3000/auth/login')
  console.log(`    email      ${EMAIL}`)
  console.log(`    password   ${PASSWORD}`)
  console.log('')
  console.log(`  company_id   ${companyId}`)
  console.log(`  project      http://localhost:3000/projects/${project!.id}`)
  console.log('')
  console.log('  Next, so the price book and takeoff panels are not empty:')
  console.log(`    npx tsx scripts/seed-catalog.ts ${companyId}`)
  console.log(`    npx tsx scripts/seed-assemblies.ts ${companyId}`)
  console.log('')
  console.log('  To remove everything this created:')
  console.log('    npx tsx scripts/seed-demo-tenant.ts --teardown')
  console.log('')
}

if (process.argv.includes('--teardown')) {
  await teardown()
} else {
  await seed()
}
