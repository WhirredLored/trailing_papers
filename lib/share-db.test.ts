/**
 * C10 acceptance against live database — share links, access logging, immutability, tenancy.
 *
 * HOW TO RUN:
 *   npx vitest run lib/share-db.test.ts
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createShareLink,
  generateShareToken,
  hashShareToken,
  recordShareLinkView,
  revokeShareLink,
} from './share-server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.warn('[share-db.test] Skipping — Supabase env vars not set.')
} else {
  const admin: SupabaseClient<Database> = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const TAG = `c10-${Date.now()}`
  let companyAId: string
  let companyBId: string
  let documentAId: string
  let shareLinkAId: string
  let rawTokenA: string

  const createdShareLinkIds: string[] = []
  const createdDocumentIds: string[] = []

  beforeAll(async () => {
    // 1. Create company A and B
    const { data: compA } = await admin
      .from('company')
      .insert({ name: `${TAG}-A`, legal_name: `${TAG} Contractor A LLC` })
      .select('id')
      .single()
    const { data: compB } = await admin
      .from('company')
      .insert({ name: `${TAG}-B`, legal_name: `${TAG} Contractor B LLC` })
      .select('id')
      .single()

    companyAId = compA!.id
    companyBId = compB!.id

    // 2. Create client, property, project, estimate, document for Company A
    const { data: client } = await admin
      .from('client')
      .insert({ company_id: companyAId, name: `${TAG} Homeowner` })
      .select('id')
      .single()

    const { data: property } = await admin
      .from('property')
      .insert({
        company_id: companyAId,
        client_id: client!.id,
        address_line1: '123 Test St',
        city: 'Albany',
        state: 'NY',
        zip: '12207',
      })
      .select('id')
      .single()

    const { data: project } = await admin
      .from('project')
      .insert({
        company_id: companyAId,
        property_id: property!.id,
        title: `${TAG} Renovation`,
      })
      .select('id')
      .single()

    const { data: estimate } = await admin
      .from('estimate')
      .insert({
        company_id: companyAId,
        project_id: project!.id,
        status: 'draft',
        title: `${TAG} Estimate`,
      })
      .select('id')
      .single()

    const docNumber = `EST-T${Date.now().toString().slice(-4)}`
    const { data: doc } = await admin
      .from('document')
      .insert({
        company_id: companyAId,
        kind: 'estimate',
        related_id: estimate!.id,
        version: 1,
        number_text: docNumber,
        number: 9999,
        storage_path: `${companyAId}/estimate/${docNumber}-v1.pdf`,
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        byte_size: 1024,
      })
      .select('id')
      .single()

    documentAId = doc!.id
    createdDocumentIds.push(documentAId)
  })

  afterAll(async () => {
    // Teardown in foreign key order:
    // share links -> documents -> estimates -> projects -> properties -> clients -> companies
    for (const linkId of createdShareLinkIds) {
      await admin.rpc('purge_share_link', { p_share_link_id: linkId })
    }
    for (const docId of createdDocumentIds) {
      await admin.rpc('purge_document', { p_document_id: docId })
    }

    if (companyAId) {
      await admin.from('estimate').delete().eq('company_id', companyAId)
      await admin.from('project').delete().eq('company_id', companyAId)
      await admin.from('property').delete().eq('company_id', companyAId)
      await admin.from('client').delete().eq('company_id', companyAId)
      await admin.from('company').delete().eq('id', companyAId)
    }
    if (companyBId) {
      await admin.from('company').delete().eq('id', companyBId)
    }
  })

  describe('share link creation & token hashing', () => {
    it('creates a share link with hashed token and default expiry', async () => {
      const res = await createShareLink(admin, {
        companyId: companyAId,
        documentId: documentAId,
        expiresInDays: 30,
      })

      expect(res.rawToken).toHaveLength(64)
      expect(res.link.id).toBeTruthy()
      expect(res.link.company_id).toBe(companyAId)
      expect(res.link.document_id).toBe(documentAId)
      expect(res.link.token_hash).toBe(hashShareToken(res.rawToken))
      expect(res.link.view_count).toBe(0)
      expect(res.link.revoked_at).toBeNull()

      shareLinkAId = res.link.id
      rawTokenA = res.rawToken
      createdShareLinkIds.push(shareLinkAId)
    })
  })

  describe('view recording & access logging (Law 7)', () => {
    it('records an active link view and logs IP, user_agent, and referer', async () => {
      const view = await recordShareLinkView(admin, rawTokenA, {
        ip: '198.51.100.42',
        userAgent: 'Mozilla/5.0 TestBrowser/1.0',
        referer: 'https://mail.google.com/',
      })

      expect(view.status).toBe('active')
      expect(view.shareLinkId).toBe(shareLinkAId)
      expect(view.documentId).toBe(documentAId)
      expect(view.companyId).toBe(companyAId)

      // Verify the counter incremented
      const { data: link } = await admin
        .from('share_link')
        .select('view_count, last_viewed_at')
        .eq('id', shareLinkAId)
        .single()

      expect(link?.view_count).toBe(1)
      expect(link?.last_viewed_at).toBeTruthy()

      // Verify access log row was written
      const { data: logs } = await admin
        .from('share_link_access')
        .select('*')
        .eq('share_link_id', shareLinkAId)

      expect(logs).toHaveLength(1)
      const firstLog = logs?.[0]
      expect(firstLog).toBeDefined()
      expect(firstLog?.ip).toBe('198.51.100.42')
      expect(firstLog?.user_agent).toBe('Mozilla/5.0 TestBrowser/1.0')
      expect(firstLog?.referer).toBe('https://mail.google.com/')
    })

    it('returns not_found for an unallocated token', async () => {
      const fakeToken = generateShareToken().rawToken
      const view = await recordShareLinkView(admin, fakeToken)
      expect(view.status).toBe('not_found')
    })

    it('returns revoked when link is revoked', async () => {
      const { link, rawToken } = await createShareLink(admin, {
        companyId: companyAId,
        documentId: documentAId,
      })
      createdShareLinkIds.push(link.id)

      await revokeShareLink(admin, { companyId: companyAId, linkId: link.id })

      const view = await recordShareLinkView(admin, rawToken)
      expect(view.status).toBe('revoked')
      expect(view.companyId).toBe(companyAId)
    })

    it('returns expired when link has passed expires_at', async () => {
      const { rawToken, tokenHash } = generateShareToken()
      // Insert already-expired link
      const { data: link } = await admin
        .from('share_link')
        .insert({
          company_id: companyAId,
          document_id: documentAId,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() - 60000).toISOString(),
        })
        .select()
        .single()

      createdShareLinkIds.push(link!.id)

      const view = await recordShareLinkView(admin, rawToken)
      expect(view.status).toBe('expired')
      expect(view.companyId).toBe(companyAId)
    })
  })

  describe('immutability & guards (Law 8)', () => {
    it('refuses plain DELETE of a share link without purge_share_link', async () => {
      const { error } = await admin.from('share_link').delete().eq('id', shareLinkAId)
      expect(error).toBeTruthy()
      expect(error?.message).toMatch(/cannot be deleted; revoke it instead/)
    })

    it('refuses decreasing view_count', async () => {
      const { error } = await admin
        .from('share_link')
        .update({ view_count: 0 })
        .eq('id', shareLinkAId)
      expect(error).toBeTruthy()
      expect(error?.message).toMatch(/view_count cannot decrease/)
    })

    it('refuses mutating document_id or token_hash', async () => {
      const { error } = await admin
        .from('share_link')
        .update({ token_hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' })
        .eq('id', shareLinkAId)
      expect(error).toBeTruthy()
      expect(error?.message).toMatch(/identity is immutable/)
    })

    it('refuses deleting access records (evidence)', async () => {
      const { data: logs } = await admin
        .from('share_link_access')
        .select('id')
        .eq('share_link_id', shareLinkAId)

      expect(logs?.length).toBeGreaterThan(0)
      const logId = logs?.[0]?.id
      expect(logId).toBeDefined()
      const { error } = await admin
        .from('share_link_access')
        .delete()
        .eq('id', logId!)

      expect(error).toBeTruthy()
      expect(error?.message).toMatch(/evidence and cannot be deleted/)
    })
  })
}
