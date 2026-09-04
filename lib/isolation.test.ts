/**
 * Cross-tenant RLS isolation tests — C02
 *
 * Seeds two separate companies (A and B), each with one user whose JWT carries
 * app_metadata with their company_id. Then asserts that each user can only read
 * their own company's rows and is denied access to the other company's data.
 *
 * HOW TO RUN
 * ----------
 * These tests talk to the real Supabase project and require valid credentials
 * in .env.local. Run with:
 *   npm run test:isolation
 * (defined in package.json as `vitest run lib/isolation.test.ts`)
 *
 * PATTERN
 * -------
 * This file is the template every future table's isolation tests follow.
 * For each new table:
 *   1. Insert rows via service-role client (bypasses RLS, so setup always works).
 *   2. Create scoped clients with signInWithPassword (real JWT with app_metadata).
 *   3. Query the new table with each scoped client.
 *   4. Assert A's client sees only A's rows; B's client sees nothing of A's (and vice versa).
 */

import { createClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// ─── env guards ──────────────────────────────────────────────────────────────
// These tests require a real Supabase project. Skip in CI unless the env is set.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.warn('[isolation.test] Skipping — Supabase env vars not set.')
} else {
  // ─── clients ───────────────────────────────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // Scoped clients for each test company; initialised in beforeAll.
  let clientA: ReturnType<typeof createClient>
  let clientB: ReturnType<typeof createClient>

  // ─── seed data ─────────────────────────────────────────────────────────────
  let companyAId: string
  let companyBId: string
  let userAId: string
  let userBId: string
  const EMAIL_A = `test-isolation-a-${Date.now()}@papertrail.test`
  const EMAIL_B = `test-isolation-b-${Date.now()}@papertrail.test`
  const PASSWORD = 'Test1234!'

  beforeAll(async () => {
    // Create company A
    const { data: compA, error: compAErr } = await admin
      .from('company')
      .insert({ name: 'Isolation Test Company A' })
      .select('id')
      .single()
    expect(compAErr, `company A insert: ${compAErr?.message}`).toBeNull()
    companyAId = compA!.id

    // Create company B
    const { data: compB, error: compBErr } = await admin
      .from('company')
      .insert({ name: 'Isolation Test Company B' })
      .select('id')
      .single()
    expect(compBErr, `company B insert: ${compBErr?.message}`).toBeNull()
    companyBId = compB!.id

    // Create auth user A with company A in app_metadata
    const { data: authA, error: authAErr } = await admin.auth.admin.createUser({
      email: EMAIL_A,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { company_id: companyAId, role: 'owner' },
    })
    expect(authAErr, `auth user A: ${authAErr?.message}`).toBeNull()
    userAId = authA!.user!.id

    await admin.from('app_user').insert({
      id: userAId,
      company_id: companyAId,
      role: 'owner',
      created_by: userAId,
    })

    // Create auth user B with company B in app_metadata
    const { data: authB, error: authBErr } = await admin.auth.admin.createUser({
      email: EMAIL_B,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { company_id: companyBId, role: 'owner' },
    })
    expect(authBErr, `auth user B: ${authBErr?.message}`).toBeNull()
    userBId = authB!.user!.id

    await admin.from('app_user').insert({
      id: userBId,
      company_id: companyBId,
      role: 'owner',
      created_by: userBId,
    })

    // Sign in as A and B to get real scoped sessions
    clientA = createClient(SUPABASE_URL, ANON_KEY)
    const { error: signInAErr } = await clientA.auth.signInWithPassword({
      email: EMAIL_A,
      password: PASSWORD,
    })
    expect(signInAErr, `sign in A: ${signInAErr?.message}`).toBeNull()

    clientB = createClient(SUPABASE_URL, ANON_KEY)
    const { error: signInBErr } = await clientB.auth.signInWithPassword({
      email: EMAIL_B,
      password: PASSWORD,
    })
    expect(signInBErr, `sign in B: ${signInBErr?.message}`).toBeNull()
  })

  afterAll(async () => {
    // Clean up — delete users and companies (cascade deletes app_user rows)
    if (userAId) await admin.auth.admin.deleteUser(userAId)
    if (userBId) await admin.auth.admin.deleteUser(userBId)
    if (companyAId) await admin.from('company').delete().eq('id', companyAId)
    if (companyBId) await admin.from('company').delete().eq('id', companyBId)
  })

  // ─── isolation tests ───────────────────────────────────────────────────────
  describe('company table — cross-tenant isolation', () => {
    it('user A can read company A', async () => {
      const { data, error } = await clientA.from('company').select('id').eq('id', companyAId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].id).toBe(companyAId)
    })

    it('user A cannot read company B', async () => {
      const { data, error } = await clientA.from('company').select('id').eq('id', companyBId)
      expect(error).toBeNull()
      // RLS returns an empty result set, not an error, for denied rows.
      expect(data).toHaveLength(0)
    })

    it('user B can read company B', async () => {
      const { data, error } = await clientB.from('company').select('id').eq('id', companyBId)
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
      expect(data![0].id).toBe(companyBId)
    })

    it('user B cannot read company A', async () => {
      const { data, error } = await clientB.from('company').select('id').eq('id', companyAId)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  describe('app_user table — cross-tenant isolation', () => {
    it('user A can read their own app_user row', async () => {
      const { data, error } = await clientA.from('app_user').select('id, company_id')
      expect(error).toBeNull()
      expect(data!.every((r) => r.company_id === companyAId)).toBe(true)
    })

    it('user A cannot read user B row', async () => {
      const { data, error } = await clientA.from('app_user').select('id').eq('id', userBId)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })

    it('user B can read their own app_user row', async () => {
      const { data, error } = await clientB.from('app_user').select('id, company_id')
      expect(error).toBeNull()
      expect(data!.every((r) => r.company_id === companyBId)).toBe(true)
    })

    it('user B cannot read user A row', async () => {
      const { data, error } = await clientB.from('app_user').select('id').eq('id', userAId)
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  })

  describe('cross-tenant write attempts', () => {
    it('user A cannot update company B', async () => {
      const { data, error } = await clientA
        .from('company')
        .update({ name: 'hacked by A' })
        .eq('id', companyBId)
        .select('id')
      // RLS silently blocks the update; no error, 0 rows affected.
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })

    it('user B cannot update user A app_user row', async () => {
      const { data, error } = await clientB
        .from('app_user')
        .update({ full_name: 'hacked by B' })
        .eq('id', userAId)
        .select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(0)
    })
  
  // ─── C04: client table ──────────────────────────────────────────────────────
  test('client table — cross-tenant isolation > user A can read company A', async () => {
    const { data, error } = await clientA.from('client').select('*')
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThan(0)
    data!.forEach((row) => expect(row.company_id).toBe(companyAId))
  })

  test('client table — cross-tenant isolation > user A cannot read company B', async () => {
    const { data, error } = await clientA.from('client').select('*').eq('company_id', companyBId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0) // RLS silently filters out rows belonging to companyB
  })

  test('client table — cross-tenant isolation > user B cannot read company A', async () => {
    const { data, error } = await clientB.from('client').select('*').eq('company_id', companyAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  // ─── C04: property table ────────────────────────────────────────────────────
  test('property table — cross-tenant isolation > user A can read company A', async () => {
    const { data, error } = await clientA.from('property').select('*')
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThan(0)
    data!.forEach((row) => expect(row.company_id).toBe(companyAId))
  })

  test('property table — cross-tenant isolation > user A cannot read company B', async () => {
    const { data, error } = await clientA.from('property').select('*').eq('company_id', companyBId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  // ─── C04: project table ─────────────────────────────────────────────────────
  test('project table — cross-tenant isolation > user B can read company B', async () => {
    const { data, error } = await clientB.from('project').select('*')
    expect(error).toBeNull()
    expect(data?.length).toBeGreaterThan(0)
    data!.forEach((row) => expect(row.company_id).toBe(companyBId))
  })

  test('project table — cross-tenant isolation > user B cannot read company A', async () => {
    const { data, error } = await clientB.from('project').select('*').eq('company_id', companyAId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })
})
}
