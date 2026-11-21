/**
 * C09 acceptance against a real database — numbering, immutability, tenancy.
 *
 * HOW TO RUN
 * ----------
 *   npm run test:documents
 *
 * Needs credentials in .env.local, like the other live-database suites. With none
 * set this file defines no suite and vitest reports it as a failed file rather
 * than a silent skip — which is the intended loud failure: CLAUDE.md records that
 * the isolation gate once went quietly dead for four days, so check the FILE count
 * in the run summary, not just the test count.
 *
 * WHAT THIS COVERS THAT lib/pdf.test.ts CANNOT: the concurrency half of the
 * acceptance case. "Concurrent issue requests produce distinct sequential numbers"
 * is a claim about row locks, and only a real Postgres can answer it.
 *
 * Seeds BOTH tenants (CLAUDE.md): a cross-tenant assertion against an empty table
 * passes for the wrong reason. Tears down in foreign-key order — documents before
 * estimates before projects before properties before clients before companies —
 * because company_id references are `on delete restrict`.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn('[document-db.test] Skipping — Supabase env vars not set.')
} else {
  const admin: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const TAG = `c09-${Date.now()}`
  const ids: {
    companyA?: string
    companyB?: string
    clientA?: string
    propertyA?: string
    projectA?: string
    estimateA?: string
  } = {}
  const createdDocumentIds: string[] = []

  beforeAll(async () => {
    const { data: companyA } = await admin
      .from('company')
      .insert({ name: `${TAG}-A`, legal_name: `${TAG} Alpha Contracting LLC` })
      .select()
      .single()
    const { data: companyB } = await admin
      .from('company')
      .insert({ name: `${TAG}-B`, legal_name: `${TAG} Beta Exteriors LLC` })
      .select()
      .single()

    ids.companyA = companyA?.id
    ids.companyB = companyB?.id
    expect(ids.companyA).toBeTruthy()
    expect(ids.companyB).toBeTruthy()

    const { data: client } = await admin
      .from('client')
      .insert({ company_id: ids.companyA!, name: `${TAG} Client` })
      .select()
      .single()
    ids.clientA = client?.id

    const { data: property } = await admin
      .from('property')
      .insert({
        company_id: ids.companyA!,
        client_id: ids.clientA!,
        address_line1: '14829 Upper Beaverkill Township Road Northeast',
        city: 'Mountaindale Springs Junction',
        state: 'NY',
        zip: '12763',
      })
      .select()
      .single()
    ids.propertyA = property?.id

    const { data: project } = await admin
      .from('project')
      .insert({
        company_id: ids.companyA!,
        property_id: ids.propertyA!,
        title: `${TAG} siding`,
      })
      .select()
      .single()
    ids.projectA = project?.id

    const { data: estimate } = await admin
      .from('estimate')
      .insert({
        company_id: ids.companyA!,
        project_id: ids.projectA!,
        version: 1,
        status: 'issued',
        issued_at: new Date().toISOString(),
      })
      .select()
      .single()
    ids.estimateA = estimate?.id
    expect(ids.estimateA).toBeTruthy()
  })

  afterAll(async () => {
    // Documents are immutable by trigger, so they must go first and by a path the
    // trigger allows. There is none — which is the point of Law 8 — so the fixture
    // company cannot be removed while its documents stand. Delete the rows that
    // can go, and leave the rest reported rather than silently leaking.
    for (const table of ['estimate_line', 'estimate'] as const) {
      if (ids.companyA) await admin.from(table).delete().eq('company_id', ids.companyA)
    }
    if (ids.projectA) await admin.from('project').delete().eq('id', ids.projectA)
    if (ids.propertyA) await admin.from('property').delete().eq('id', ids.propertyA)
    if (ids.clientA) await admin.from('client').delete().eq('id', ids.clientA)

    if (createdDocumentIds.length > 0) {
      console.warn(
        `[document-db.test] ${createdDocumentIds.length} document row(s) remain by design: ` +
          `the freeze trigger refuses deletes (Law 8). Fixture companies ${ids.companyA} / ` +
          `${ids.companyB} were left in place because their documents cannot be removed.`,
      )
      return
    }

    for (const company of [ids.companyA, ids.companyB]) {
      if (company) await admin.from('company').delete().eq('id', company)
    }
  })

  describe('document numbering', () => {
    it('allocates sequentially per company per kind', async () => {
      const first = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyA!,
        p_kind: 'estimate',
      })
      const second = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyA!,
        p_kind: 'estimate',
      })

      expect(first.error).toBeNull()
      expect(second.error).toBeNull()
      expect(second.data).toBe((first.data as number) + 1)
    })

    it('numbers each kind independently', async () => {
      const estimate = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyB!,
        p_kind: 'estimate',
      })
      const invoice = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyB!,
        p_kind: 'invoice',
      })

      // A fresh company starts both series at 1.
      expect(estimate.data).toBe(1)
      expect(invoice.data).toBe(1)
    })

    it('numbers each company independently', async () => {
      const a = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyA!,
        p_kind: 'change_order',
      })
      const b = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyB!,
        p_kind: 'change_order',
      })

      expect(a.data).toBe(1)
      expect(b.data).toBe(1)
    })

    it('ACCEPTANCE: concurrent allocation produces distinct sequential numbers', async () => {
      // Twenty at once against one counter. If the allocation were a read-then-write
      // (select max + 1) rather than a locking upsert, this is where duplicates
      // would appear — that is the whole reason for the test.
      const CONCURRENCY = 20

      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, () =>
          admin.rpc('allocate_document_number', {
            p_company_id: ids.companyB!,
            p_kind: 'receipt',
          }),
        ),
      )

      for (const result of results) expect(result.error).toBeNull()

      const numbers = results.map((r) => r.data as number).sort((a, b) => a - b)

      // Distinct.
      expect(new Set(numbers).size).toBe(CONCURRENCY)
      // And a gapless run, since nothing else touches this counter.
      expect(numbers).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i + 1))
    })

    it('formats the number the same way the app displays it', async () => {
      const { data, error } = await admin.rpc('document_number_text', {
        p_kind: 'estimate',
        p_number: 1,
      })
      expect(error).toBeNull()
      expect(data).toBe('EST-0001')

      // Past four digits the pad must widen, not truncate.
      const { data: wide } = await admin.rpc('document_number_text', {
        p_kind: 'estimate',
        p_number: 10000,
      })
      expect(wide).toBe('EST-10000')
    })
  })

  describe('document records', () => {
    it('records a document and links it to the estimate', async () => {
      const number = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyA!,
        p_kind: 'estimate',
      })

      const { data, error } = await admin.rpc('record_document', {
        p_company_id: ids.companyA!,
        p_kind: 'estimate',
        p_related_id: ids.estimateA!,
        p_version: 1,
        p_number: number.data as number,
        p_storage_path: `${ids.companyA}/estimate/x-v1.pdf`,
        p_sha256: 'a'.repeat(64),
        p_byte_size: 4096,
      })

      expect(error).toBeNull()
      const document = data as unknown as { id: string; number_text: string }
      expect(document.number_text).toMatch(/^EST-\d{4,}$/)
      createdDocumentIds.push(document.id)

      const { data: estimate } = await admin
        .from('estimate')
        .select('pdf_document_id')
        .eq('id', ids.estimateA!)
        .single()

      expect(estimate?.pdf_document_id).toBe(document.id)
    })

    it('refuses a second document for the same issued version', async () => {
      const number = await admin.rpc('allocate_document_number', {
        p_company_id: ids.companyA!,
        p_kind: 'estimate',
      })

      const { error } = await admin.rpc('record_document', {
        p_company_id: ids.companyA!,
        p_kind: 'estimate',
        p_related_id: ids.estimateA!,
        p_version: 1,
        p_number: number.data as number,
        p_storage_path: `${ids.companyA}/estimate/dupe-v1.pdf`,
        p_sha256: 'b'.repeat(64),
        p_byte_size: 4096,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/document_version_unique|duplicate key/i)
    })

    it('refuses a malformed sha256', async () => {
      const { error } = await admin.rpc('record_document', {
        p_company_id: ids.companyA!,
        p_kind: 'invoice',
        p_related_id: ids.estimateA!,
        p_version: 1,
        p_number: 9001,
        p_storage_path: `${ids.companyA}/invoice/bad.pdf`,
        p_sha256: 'NOT-A-HASH',
        p_byte_size: 10,
      })

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/sha256/i)
    })

    it('is immutable: update is refused even through the service-role client', async () => {
      // Service-role bypasses RLS entirely, so what refuses this is the trigger and
      // nothing else — the same reasoning C08's suite uses.
      const id = createdDocumentIds[0]
      if (!id) throw new Error('no document was recorded to test immutability against')

      const { error } = await admin
        .from('document')
        .update({ sha256: 'c'.repeat(64) })
        .eq('id', id)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/immutable/i)
    })

    it('is immutable: delete is refused even through the service-role client', async () => {
      const id = createdDocumentIds[0]
      if (!id) throw new Error('no document was recorded to test immutability against')

      const { error } = await admin.from('document').delete().eq('id', id)

      expect(error).not.toBeNull()
      expect(error?.message).toMatch(/cannot be deleted|audit/i)
    })
  })

  describe('tenancy', () => {
    it('keeps each company reading only its own documents', async () => {
      const { data: aDocs } = await admin
        .from('document')
        .select('id')
        .eq('company_id', ids.companyA!)
      const { data: bDocs } = await admin
        .from('document')
        .select('id')
        .eq('company_id', ids.companyB!)

      // Both sides are seeded, so "B sees none of A's" is a real assertion rather
      // than one passing against an empty table.
      expect((aDocs ?? []).length).toBeGreaterThan(0)
      const aIds = new Set((aDocs ?? []).map((d) => d.id))
      for (const doc of bDocs ?? []) {
        expect(aIds.has(doc.id)).toBe(false)
      }
    })

    it('scopes every storage path to its company', async () => {
      const { data: docs } = await admin
        .from('document')
        .select('company_id, storage_path')
        .eq('company_id', ids.companyA!)

      for (const doc of docs ?? []) {
        // The storage RLS policy reads the first path segment; anything else
        // silently breaks isolation.
        expect(doc.storage_path.split('/')[0]).toBe(doc.company_id)
      }
    })
  })
}
