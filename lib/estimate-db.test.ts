/**
 * Estimate immutability and versioning — against the live project.
 *
 * This is the C08 acceptance case: issue an estimate, attempt to edit it, and
 * watch the DATABASE refuse. Every write here goes through the service-role
 * client, which bypasses RLS entirely — so what stops these edits is not a
 * policy, an API check or UI state, it is the trigger. If the trigger were
 * removed, every assertion in the first block would fail.
 *
 * The narrative is linear and the blocks run in order: v1 is issued in
 * beforeAll, proven frozen, revised to v2, and v2 is issued so the supersede
 * state can be checked on both rows.
 *
 * HOW TO RUN
 *   npm run test:estimates   (or as part of `npm run test`)
 */

import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import type { Tables } from '@/types/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asJson, rowToDraft, snapshot, termsOf } from './estimate-server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn('[estimate-db.test] Skipping — Supabase env vars not set.')
} else {
  const admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  let companyId: string
  let userId: string
  let projectId: string
  /** A second project, so the draft-bypass fixture cannot disturb v1/v2 numbering. */
  let sideProjectId: string

  let v1Id: string
  let v2Id: string

  const EMAIL = `test-estimate-${Date.now()}@papertrail.test`
  const PASSWORD = 'Test1234!'

  // ─── helpers ───────────────────────────────────────────────────────────────

  /** Create a draft estimate with two lines and return its id. */
  async function createDraft(project: string, version: number): Promise<string> {
    const { data: estimate, error } = await admin
      .from('estimate')
      .insert({
        company_id: companyId,
        project_id: project,
        version,
        title: `Immutability fixture v${version}`,
        tax_rate_bp: 875,
        deposit_mode: 'percent',
        deposit_value: 30,
        created_by: userId,
      })
      .select('id')
      .single()
    expect(error, `draft v${version} insert: ${error?.message}`).toBeNull()

    const { error: linesError } = await admin.from('estimate_line').insert([
      {
        estimate_id: estimate!.id,
        company_id: companyId,
        sort_order: 0,
        kind: 'material',
        description: 'Vinyl siding',
        quantity: 5,
        unit: 'sq',
        unit_price_cents: 15000,
        unit_cost_cents: 12000,
        taxable: true,
        group_label: 'Siding',
        created_by: userId,
      },
      {
        estimate_id: estimate!.id,
        company_id: companyId,
        sort_order: 1,
        kind: 'labor',
        description: 'Lead carpenter',
        quantity: 9,
        unit: 'hour',
        unit_price_cents: 6500,
        unit_cost_cents: 4500,
        taxable: false,
        group_label: 'Siding',
        created_by: userId,
      },
    ])
    expect(linesError, `draft v${version} lines: ${linesError?.message}`).toBeNull()

    return estimate!.id
  }

  /** Issue an estimate the way the API route does: totals from the stored lines. */
  async function issue(estimateId: string) {
    const { data: estimate } = await admin
      .from('estimate')
      .select('*')
      .eq('id', estimateId)
      .single()
    const { data: lines } = await admin
      .from('estimate_line')
      .select('*')
      .eq('estimate_id', estimateId)
      .order('sort_order', { ascending: true })

    const computed = snapshot(
      (lines ?? []).map((line) => rowToDraft(line as Tables<'estimate_line'>)),
      termsOf(estimate as Tables<'estimate'>),
    )

    return admin.rpc('issue_estimate', {
      p_estimate_id: estimateId,
      p_company_id: companyId,
      p_detail_level: 'itemized',
      p_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      p_totals: asJson(computed.totalsJson),
      p_profit: asJson(computed.profitJson),
    })
  }

  async function read(estimateId: string) {
    const { data } = await admin.from('estimate').select('*').eq('id', estimateId).single()
    return data!
  }

  // ─── seed ──────────────────────────────────────────────────────────────────

  beforeAll(async () => {
    const { data: company, error: companyError } = await admin
      .from('company')
      .insert({ name: 'Estimate Immutability Test Co' })
      .select('id')
      .single()
    expect(companyError, `company insert: ${companyError?.message}`).toBeNull()
    companyId = company!.id

    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email: EMAIL,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { company_id: companyId, role: 'owner' },
    })
    expect(authError, `auth user: ${authError?.message}`).toBeNull()
    userId = auth!.user!.id

    await admin
      .from('app_user')
      .insert({ id: userId, company_id: companyId, role: 'owner', created_by: userId })

    const { data: client } = await admin
      .from('client')
      .insert({ company_id: companyId, name: 'Immutability Test Client', created_by: userId })
      .select('id')
      .single()

    const { data: property } = await admin
      .from('property')
      .insert({
        company_id: companyId,
        client_id: client!.id,
        address_line1: '1 Frozen Way',
        created_by: userId,
      })
      .select('id')
      .single()

    const { data: project } = await admin
      .from('project')
      .insert({
        company_id: companyId,
        property_id: property!.id,
        title: 'Immutability Test Project',
        created_by: userId,
      })
      .select('id')
      .single()
    projectId = project!.id

    const { data: sideProject } = await admin
      .from('project')
      .insert({
        company_id: companyId,
        property_id: property!.id,
        title: 'Bypass Fixture Project',
        created_by: userId,
      })
      .select('id')
      .single()
    sideProjectId = sideProject!.id

    v1Id = await createDraft(projectId, 1)

    const { error: issueError } = await issue(v1Id)
    expect(issueError, `issue v1: ${issueError?.message}`).toBeNull()
  })

  afterAll(async () => {
    if (companyId) {
      // Retire, then purge. The forward supersede pointer has to go first or the
      // two versions reference each other and neither can be deleted; after
      // that, deleting highest version first satisfies the revised_from
      // restrict, which is checked per row rather than at end of statement.
      await admin
        .from('estimate')
        .update({ superseded_by_estimate_id: null, deleted_at: new Date().toISOString() })
        .eq('company_id', companyId)

      const { data: rows } = await admin
        .from('estimate')
        .select('id, version')
        .eq('company_id', companyId)
        .order('version', { ascending: false })

      for (const row of rows ?? []) {
        await admin.from('estimate').delete().eq('id', row.id)
      }

      await admin.from('project').delete().eq('company_id', companyId)
      await admin.from('property').delete().eq('company_id', companyId)
      await admin.from('client').delete().eq('company_id', companyId)
    }
    if (userId) await admin.auth.admin.deleteUser(userId)
    if (companyId) await admin.from('company').delete().eq('id', companyId)
  })

  // ─── the acceptance case ───────────────────────────────────────────────────

  describe('an issued estimate is frozen at the database level', () => {
    it('issuing froze the totals onto the row', async () => {
      const v1 = await read(v1Id)
      expect(v1.status).toBe('issued')
      expect(v1.issued_at).not.toBeNull()
      // 5 x $150.00 + 9 x $65.00 = $1,335.00; only the siding line is taxable,
      // so tax is 8.75% of $750.00 = $65.63.
      expect(v1.subtotal_cents).toBe(133500)
      expect(v1.tax_cents).toBe(6563)
      expect(v1.total_cents).toBe(140063)
      // Internal: cost 5 x $120.00 + 9 x $45.00 = $1,005.00.
      expect(v1.estimated_cost_cents).toBe(100500)
      expect(v1.margin_cents).toBe(33000)
    })

    it('refuses to change the terms', async () => {
      const { error } = await admin
        .from('estimate')
        .update({ notes_to_client: 'quietly changed after the client saw it' })
        .eq('id', v1Id)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/immutable/i)
    })

    it('refuses to change the total', async () => {
      const { error } = await admin
        .from('estimate')
        .update({ total_cents: 1 })
        .eq('id', v1Id)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/immutable/i)

      const v1 = await read(v1Id)
      expect(v1.total_cents).toBe(140063)
    })

    it('refuses to add a line', async () => {
      const { error } = await admin.from('estimate_line').insert({
        estimate_id: v1Id,
        company_id: companyId,
        sort_order: 99,
        description: 'Line snuck in after issue',
        quantity: 1,
        unit_price_cents: 50000,
        created_by: userId,
      })

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/frozen/i)
    })

    it('refuses to change a line', async () => {
      const { error } = await admin
        .from('estimate_line')
        .update({ quantity: 500 })
        .eq('estimate_id', v1Id)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/frozen/i)
    })

    it('refuses to delete a line', async () => {
      const { error } = await admin.from('estimate_line').delete().eq('estimate_id', v1Id)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/frozen/i)

      const { count } = await admin
        .from('estimate_line')
        .select('*', { count: 'exact', head: true })
        .eq('estimate_id', v1Id)
      expect(count).toBe(2)
    })

    it('refuses to delete the estimate', async () => {
      const { error } = await admin.from('estimate').delete().eq('id', v1Id)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/cannot be deleted/i)
    })

    it('refuses an illegal status transition back to draft', async () => {
      const { error } = await admin.from('estimate').update({ status: 'draft' }).eq('id', v1Id)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/illegal estimate status transition/i)
    })

    it('refuses a draft save through save_estimate_draft', async () => {
      const { error } = await admin.rpc('save_estimate_draft', {
        p_estimate_id: v1Id,
        p_company_id: companyId,
        p_header: asJson({}),
        p_lines: asJson([]),
        p_totals: asJson({}),
        p_profit: asJson({}),
        p_actor: userId,
      })

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/cannot be edited/i)
    })

    it('allows the lifecycle move it is supposed to allow', async () => {
      const { error } = await admin.from('estimate').update({ status: 'approved' }).eq('id', v1Id)
      expect(error, error?.message).toBeNull()
      expect((await read(v1Id)).status).toBe('approved')
    })
  })

  describe('a draft cannot be issued by hand', () => {
    it('refuses a status flip that bypasses issue_estimate', async () => {
      const draftId = await createDraft(sideProjectId, 1)

      const { error } = await admin
        .from('estimate')
        .update({ status: 'issued', issued_at: new Date().toISOString() })
        .eq('id', draftId)

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/issue_estimate/i)

      // Still a draft, and still editable.
      const draft = await read(draftId)
      expect(draft.status).toBe('draft')

      const { error: editError } = await admin
        .from('estimate')
        .update({ notes_to_client: 'drafts are freely editable' })
        .eq('id', draftId)
      expect(editError, editError?.message).toBeNull()
    })
  })

  describe('the revision flow', () => {
    it('clones the estimate and its lines to version 2 in draft', async () => {
      const { data, error } = await admin.rpc('create_estimate_revision', {
        p_estimate_id: v1Id,
        p_company_id: companyId,
        p_actor: userId,
      })

      expect(error, error?.message).toBeNull()
      v2Id = data!.id
      expect(data!.version).toBe(2)
      expect(data!.status).toBe('draft')
      expect(data!.revised_from_estimate_id).toBe(v1Id)
      expect(data!.issued_at).toBeNull()

      const { data: lines } = await admin
        .from('estimate_line')
        .select('description, quantity, unit_price_cents')
        .eq('estimate_id', v2Id)
        .order('sort_order', { ascending: true })

      expect(lines).toHaveLength(2)
      expect(lines![0]!.description).toBe('Vinyl siding')
      expect(lines![0]!.unit_price_cents).toBe(15000)
    })

    it('leaves the prior version standing until the revision is issued', async () => {
      const v1 = await read(v1Id)
      expect(v1.status).toBe('approved')
      expect(v1.superseded_by_estimate_id).toBeNull()
    })

    it('is idempotent — asking again returns the same draft revision', async () => {
      const { data, error } = await admin.rpc('create_estimate_revision', {
        p_estimate_id: v1Id,
        p_company_id: companyId,
        p_actor: userId,
      })

      expect(error, error?.message).toBeNull()
      expect(data!.id).toBe(v2Id)

      const { count } = await admin
        .from('estimate')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
      expect(count).toBe(2)
    })

    it('refuses to revise a draft — it is already editable', async () => {
      const { error } = await admin.rpc('create_estimate_revision', {
        p_estimate_id: v2Id,
        p_company_id: companyId,
        p_actor: userId,
      })

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/still a draft/i)
    })

    it('refuses to revise across a tenancy boundary', async () => {
      const { error } = await admin.rpc('create_estimate_revision', {
        p_estimate_id: v1Id,
        p_company_id: '00000000-0000-4000-8000-000000000000',
        p_actor: userId,
      })

      expect(error).not.toBeNull()
      expect(error!.message).toMatch(/another company/i)
    })

    it('the revision is editable, and re-prices through the same engine', async () => {
      const { error } = await admin.rpc('save_estimate_draft', {
        p_estimate_id: v2Id,
        p_company_id: companyId,
        p_header: asJson({ tax_rate_bp: 875, discount_mode: 'percent', discount_value: 0 }),
        p_lines: asJson([
          {
            kind: 'material',
            description: 'Vinyl siding',
            quantity: 6,
            unit: 'sq',
            unit_price_cents: 15000,
            unit_cost_cents: 12000,
            taxable: true,
            group_label: 'Siding',
          },
        ]),
        p_totals: asJson({
          subtotalCents: 90000,
          discountCents: 0,
          taxableSubtotalCents: 90000,
          taxCents: 7875,
          totalCents: 97875,
          depositDueCents: 29363,
          balanceDueCents: 68512,
        }),
        p_profit: asJson({ estimatedCostCents: 72000, marginCents: 18000, marginBp: 2000 }),
        p_actor: userId,
      })

      expect(error, error?.message).toBeNull()

      const v2 = await read(v2Id)
      expect(v2.total_cents).toBe(97875)

      const { count } = await admin
        .from('estimate_line')
        .select('*', { count: 'exact', head: true })
        .eq('estimate_id', v2Id)
      expect(count).toBe(1)
    })

    it('supersedes the prior version once the revision is issued', async () => {
      const { error } = await issue(v2Id)
      expect(error, error?.message).toBeNull()

      const v1 = await read(v1Id)
      const v2 = await read(v2Id)

      expect(v2.status).toBe('issued')
      expect(v1.status).toBe('superseded')
      expect(v1.superseded_by_estimate_id).toBe(v2Id)
      // The superseded version keeps its own frozen totals — the record of what
      // the client was actually shown does not change when it is replaced.
      expect(v1.total_cents).toBe(140063)
    })

    it('issuing is idempotent — the second call changes nothing', async () => {
      const before = await read(v2Id)

      const { data, error } = await issue(v2Id)
      expect(error, error?.message).toBeNull()
      expect(data!.id).toBe(v2Id)
      expect(data!.issued_at).toBe(before.issued_at)
      expect(data!.total_cents).toBe(before.total_cents)
    })
  })

  describe('retire before purge', () => {
    it('purges only after the estimate has been retired with attribution', async () => {
      const throwaway = await createDraft(sideProjectId, 2)
      const { error: issueError } = await issue(throwaway)
      expect(issueError, issueError?.message).toBeNull()

      // Straight delete: refused.
      const { error: deleteError } = await admin.from('estimate').delete().eq('id', throwaway)
      expect(deleteError).not.toBeNull()
      expect(deleteError!.message).toMatch(/cannot be deleted/i)

      // Retire it.
      const { error: retireError } = await admin
        .from('estimate')
        .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
        .eq('id', throwaway)
      expect(retireError, retireError?.message).toBeNull()

      // Now the purge is allowed, and it takes the lines with it.
      const { error: purgeError } = await admin.from('estimate').delete().eq('id', throwaway)
      expect(purgeError, purgeError?.message).toBeNull()

      const { count } = await admin
        .from('estimate_line')
        .select('*', { count: 'exact', head: true })
        .eq('estimate_id', throwaway)
      expect(count).toBe(0)
    })
  })
}
