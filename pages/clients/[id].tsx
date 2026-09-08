import { useState, useEffect, useCallback, type FormEvent } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'
import type { Tables } from '@/types/db'

export default function ClientDetailPage() {
  const router = useRouter()
  const { id } = router.query

  const [client, setClient] = useState<Tables<'client'> | null>(null)
  const [properties, setProperties] = useState<Tables<'property'>[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // Prop create form
  const [showAddProp, setShowAddProp] = useState(false)
  const [propAddr, setPropAddr] = useState('')

  const fetchAll = useCallback(async () => {
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const [cRes, pRes] = await Promise.all([
      fetch(`/api/client/${id}`, { headers: { Authorization: `Bearer ${session.access_token}` } }),
      fetch(`/api/property?client_id=${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }),
    ])

    if (cRes.ok) setClient(await cRes.json())
    if (pRes.ok) setProperties(await pRes.json())
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (id) fetchAll()
  }, [id, fetchAll])

  async function handleUpdate(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const fd = new FormData(e.target as HTMLFormElement)
    const patch = Object.fromEntries(fd.entries())

    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    await fetch(`/api/client/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(patch),
    })
    setSaving(false)
    fetchAll()
  }

  async function handleAddProperty(e: FormEvent) {
    e.preventDefault()
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch(`/api/property`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ client_id: id, address_line1: propAddr }),
    })

    if (res.ok) {
      setShowAddProp(false)
      setPropAddr('')
      fetchAll()
    }
  }

  if (loading)
    return (
      <main className="crm-shell">
        <p className="settings-loading">Loading...</p>
      </main>
    )
  if (!client)
    return (
      <main className="crm-shell">
        <p className="settings-loading">Not found.</p>
      </main>
    )

  return (
    <>
      <Head>
        <title>{client.name} — PaperTrail</title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <Link href="/clients" className="crm-back-link">
            ← All Clients
          </Link>
          <h1 className="crm-title">{client.name}</h1>
        </div>

        <div className="settings-grid">
          <div className="settings-form-col">
            <div className="settings-section">
              <h2 className="settings-section-title">Client Details</h2>
              <form onSubmit={handleUpdate} className="settings-form">
                <label className="field-label">Name</label>
                <input name="name" className="field-input" defaultValue={client.name} required />

                <label className="field-label">Company Name</label>
                <input
                  name="company_name"
                  className="field-input"
                  defaultValue={client.company_name || ''}
                />

                <label className="field-label">Primary Email</label>
                <input
                  name="emails"
                  type="email"
                  className="field-input"
                  defaultValue={client.emails?.[0] || ''}
                  onChange={(e) => (e.target.name = e.target.value ? 'emails[0]' : '')}
                />
                <p className="field-hint">
                  For API simplicity we only edit the first email here in v1.
                </p>

                <label className="field-label">Phone</label>
                <input
                  name="phones"
                  type="tel"
                  className="field-input"
                  defaultValue={client.phones?.[0] || ''}
                />

                <label className="field-label">Billing Address</label>
                <textarea
                  name="billing_address"
                  className="field-input"
                  defaultValue={client.billing_address || ''}
                  rows={3}
                />

                <button
                  type="submit"
                  className="btn-primary"
                  disabled={saving}
                  style={{ marginTop: '1rem' }}
                >
                  {saving ? 'Saving...' : 'Update Details'}
                </button>
              </form>
            </div>
          </div>

          <div className="settings-preview-col">
            <div className="settings-section">
              <div className="crm-section-header">
                <h2 className="settings-section-title" style={{ margin: 0 }}>
                  Properties
                </h2>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddProp(!showAddProp)}
                >
                  Add
                </button>
              </div>

              {showAddProp && (
                <form onSubmit={handleAddProperty} className="crm-inline-form">
                  <input
                    required
                    className="field-input"
                    placeholder="Street address..."
                    value={propAddr}
                    onChange={(e) => setPropAddr(e.target.value)}
                  />
                  <button type="submit" className="btn-primary">
                    Save
                  </button>
                </form>
              )}

              <div className="crm-list" style={{ marginTop: '1rem' }}>
                {properties.map((p) => (
                  <Link href={`/properties/${p.id}`} key={p.id} className="crm-list-item">
                    <div className="crm-list-title">{p.address_line1}</div>
                    <div className="crm-list-subtitle">
                      {p.city ? `${p.city}, ${p.state}` : 'No city'}
                    </div>
                  </Link>
                ))}
                {properties.length === 0 && <p className="field-hint">No properties yet.</p>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
