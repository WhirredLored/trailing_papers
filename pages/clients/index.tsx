import { useState, useEffect, useCallback, type FormEvent } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'

interface ClientData {
  id: string
  name: string
  company_name: string | null
  emails: string[]
  phones: string[]
}

export default function ClientsPage() {
  const [clients, setClients] = useState<ClientData[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  // Create form state
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createCompany, setCreateCompany] = useState('')
  const [createEmail, setCreateEmail] = useState('')
  const [createPhone, setCreatePhone] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [duplicateWarning, setDuplicateWarning] = useState<Record<string, unknown> | null>(null)
  const [creating, setCreating] = useState(false)

  const fetchClients = useCallback(async (q = search) => {
    const supabase = getBrowserClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const url = q ? `/api/client?search=${encodeURIComponent(q)}` : '/api/client'
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
    if (res.ok) {
      setClients(await res.json())
    }
    setLoading(false)
  }, [search])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    setSearch(e.target.value)
    fetchClients(e.target.value)
  }

  async function handleCreate(e: FormEvent, force = false) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    setDuplicateWarning(null)

    const supabase = getBrowserClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const body = {
      name: createName,
      company_name: createCompany,
      emails: createEmail ? [createEmail] : [],
      phones: createPhone ? [createPhone] : []
    }

    const url = force ? '/api/client?force=true' : '/api/client'
    const res = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify(body)
    })

    if (res.ok) {
      const { id } = await res.json()
      window.location.href = `/clients/${id}`
    } else if (res.status === 409) {
      const j = await res.json()
      setDuplicateWarning(j)
      setCreating(false)
    } else {
      const j = await res.json()
      setCreateError(j.error || 'Failed to create client')
      setCreating(false)
    }
  }

  return (
    <>
      <Head>
        <title>Clients — PaperTrail</title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <h1 className="crm-title">Clients</h1>
          <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'Cancel' : 'New Client'}
          </button>
        </div>

        {showCreate && (
          <div className="crm-form-card">
            <h2>Add New Client</h2>
            <form onSubmit={(e) => handleCreate(e, false)} className="settings-form">
              <label className="field-label">Name *</label>
              <input required className="field-input" value={createName} onChange={e => setCreateName(e.target.value)} />

              <label className="field-label">Company Name</label>
              <input className="field-input" value={createCompany} onChange={e => setCreateCompany(e.target.value)} />

              <label className="field-label">Email</label>
              <input type="email" className="field-input" value={createEmail} onChange={e => setCreateEmail(e.target.value)} />

              <label className="field-label">Phone</label>
              <input type="tel" className="field-input" value={createPhone} onChange={e => setCreatePhone(e.target.value)} />

              {createError && <p className="auth-error">{createError}</p>}

              {duplicateWarning && (
                <div className="expiry-badge expiry-badge--warn">
                  <p>A client named &quot;{String(duplicateWarning.existingName)}&quot; already exists.</p>
                  <div style={{ marginTop: '0.5rem', display: 'flex', gap: '1rem' }}>
                    <Link href={`/clients/${duplicateWarning.existingId}`} className="btn-secondary">
                      View Existing
                    </Link>
                    <button type="button" className="btn-secondary" onClick={(e) => handleCreate(e, true)}>
                      Create Anyway
                    </button>
                  </div>
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={creating} style={{ marginTop: '1rem' }}>
                {creating ? 'Saving...' : 'Save Client'}
              </button>
            </form>
          </div>
        )}

        <div className="crm-search-bar">
          <input 
            type="search" 
            placeholder="Search clients..." 
            className="field-input" 
            value={search}
            onChange={handleSearch}
          />
        </div>

        {loading ? (
          <p className="settings-loading">Loading...</p>
        ) : (
          <div className="crm-list">
            {clients.map(c => (
              <Link href={`/clients/${c.id}`} key={c.id} className="crm-list-item">
                <div className="crm-list-title">{c.name} {c.company_name ? `(${c.company_name})` : ''}</div>
                <div className="crm-list-subtitle">
                  {c.emails[0] || 'No email'} · {c.phones[0] || 'No phone'}
                </div>
              </Link>
            ))}
            {clients.length === 0 && !loading && (
              <p className="settings-loading">No clients found.</p>
            )}
          </div>
        )}
      </main>
    </>
  )
}
