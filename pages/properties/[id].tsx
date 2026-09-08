import { useState, useEffect, useCallback, type FormEvent } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'
import type { Tables } from '@/types/db'

// Mirrors the API's select: '*, client(name)'
type PropertyDetail = Tables<'property'> & {
  client: Pick<Tables<'client'>, 'name'> | null
}

export default function PropertyDetailPage() {
  const router = useRouter()
  const { id } = router.query

  const [property, setProperty] = useState<PropertyDetail | null>(null)
  const [projects, setProjects] = useState<Tables<'project'>[]>([])
  const [loading, setLoading] = useState(true)

  const [showAddProject, setShowAddProject] = useState(false)
  const [projectTitle, setProjectTitle] = useState('')

  const fetchAll = useCallback(async () => {
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const [pRes, prRes] = await Promise.all([
      fetch(`/api/property/${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }),
      fetch(`/api/project?property_id=${id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }),
    ])

    if (pRes.ok) setProperty(await pRes.json())
    if (prRes.ok) setProjects(await prRes.json())
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (id) fetchAll()
  }, [id, fetchAll])

  async function handleAddProject(e: FormEvent) {
    e.preventDefault()
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch(`/api/project`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ property_id: id, title: projectTitle }),
    })

    if (res.ok) {
      setShowAddProject(false)
      setProjectTitle('')
      fetchAll()
    }
  }

  if (loading)
    return (
      <main className="crm-shell">
        <p className="settings-loading">Loading...</p>
      </main>
    )
  if (!property)
    return (
      <main className="crm-shell">
        <p className="settings-loading">Not found.</p>
      </main>
    )

  return (
    <>
      <Head>
        <title>{property.address_line1} — PaperTrail</title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <Link href={`/clients/${property.client_id}`} className="crm-back-link">
            ← Back to Client
          </Link>
          <h1 className="crm-title">{property.address_line1}</h1>
          <p className="field-hint">For client: {property.client?.name}</p>
        </div>

        <div className="settings-grid">
          <div className="settings-form-col">
            <div className="settings-section">
              <h2 className="settings-section-title">Property Access & Notes</h2>
              <div
                className="field-row"
                style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}
              >
                <div>
                  <strong>Address:</strong> {property.address_line1} {property.address_line2}{' '}
                  {property.city}, {property.state} {property.zip}
                </div>
                <div>
                  <strong>Year Built:</strong> {property.year_built || 'Unknown'}
                </div>
                <div>
                  <strong>Access Notes:</strong> {property.access_notes || 'None'}
                </div>
                <div>
                  <strong>General Notes:</strong> {property.notes || 'None'}
                </div>
              </div>
            </div>
          </div>

          <div className="settings-preview-col">
            <div className="settings-section">
              <div className="crm-section-header">
                <h2 className="settings-section-title" style={{ margin: 0 }}>
                  Projects
                </h2>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowAddProject(!showAddProject)}
                >
                  Add
                </button>
              </div>

              {showAddProject && (
                <form onSubmit={handleAddProject} className="crm-inline-form">
                  <input
                    required
                    className="field-input"
                    placeholder="Project title (e.g. Roof Replacement)..."
                    value={projectTitle}
                    onChange={(e) => setProjectTitle(e.target.value)}
                  />
                  <button type="submit" className="btn-primary">
                    Save
                  </button>
                </form>
              )}

              <div className="crm-list" style={{ marginTop: '1rem' }}>
                {projects.map((p) => (
                  <Link href={`/projects/${p.id}`} key={p.id} className="crm-list-item">
                    <div className="crm-list-title">{p.title}</div>
                    <div className="crm-list-subtitle">Status: {p.status}</div>
                  </Link>
                ))}
                {projects.length === 0 && <p className="field-hint">No projects yet.</p>}
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
