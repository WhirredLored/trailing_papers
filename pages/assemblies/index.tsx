import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'

// ─── Types ───────────────────────────────────────────────────────────────────
interface CatalogItemRef {
  id: string
  code: string
  name: string
  unit: string
  unit_cost_cents: number
}

interface AssemblyComponent {
  id: string
  catalog_item_id: string
  quantity_per_driver: number
  waste_percent_bp: number
  rounding_rule: string
  package_size: number
  sort_order: number
  notes: string | null
  catalog_item: CatalogItemRef
}

interface Assembly {
  id: string
  name: string
  description: string | null
  driver_unit: string
  notes: string | null
  active: boolean
  created_at: string
  assembly_component: AssemblyComponent[]
}

const DRIVER_UNIT_LABELS: Record<string, string> = {
  sq_ft: 'sq ft',
  lin_ft: 'lin ft',
  ea: 'each',
  sq: 'square (100 sf)',
  opening: 'opening',
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function AssembliesPage() {
  const [assemblies, setAssemblies] = useState<Assembly[]>([])
  const [search, setSearch] = useState('')
  const [showActive, setShowActive] = useState<'true' | 'false' | 'all'>('true')
  const [loading, setLoading] = useState(true)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    driver_unit: 'sq_ft',
    notes: '',
  })
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const getToken = useCallback(async () => {
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token
  }, [])

  const fetchAssemblies = useCallback(async () => {
    const token = await getToken()
    if (!token) return

    const params = new URLSearchParams()
    if (search) params.set('search', search)
    params.set('active', showActive)

    const res = await fetch(`/api/assembly?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      setAssemblies(await res.json())
    }
    setLoading(false)
  }, [search, showActive, getToken])

  useEffect(() => {
    fetchAssemblies()
  }, [fetchAssemblies])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)

    const token = await getToken()
    if (!token) return

    const res = await fetch('/api/assembly', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: createForm.name,
        description: createForm.description || null,
        driver_unit: createForm.driver_unit,
        notes: createForm.notes || null,
      }),
    })

    if (res.ok) {
      setShowCreate(false)
      setCreateForm({ name: '', description: '', driver_unit: 'sq_ft', notes: '' })
      fetchAssemblies()
    } else {
      const j = await res.json()
      setCreateError(j.error || 'Failed to create assembly')
    }
    setCreating(false)
  }

  async function handleArchive(id: string) {
    const token = await getToken()
    if (!token) return

    const res = await fetch(`/api/assembly/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.ok) {
      fetchAssemblies()
    }
  }

  return (
    <>
      <Head>
        <title>Assemblies — PaperTrail</title>
        <meta
          name="description"
          content="Material takeoff assemblies — recipes that convert measurements into materials, waste, and labor."
        />
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <h1 className="crm-title">Assemblies</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'Cancel' : 'New Assembly'}
            </button>
          </div>
        </div>

        {/* ── Create Form ──────────────────────────────────────────────────── */}
        {showCreate && (
          <div className="crm-form-card">
            <h2>New Assembly</h2>
            <form onSubmit={handleCreate} className="settings-form">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="field-label">Name *</label>
                  <input
                    required
                    className="field-input"
                    placeholder="e.g. Vinyl Siding — per sq ft"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">Driver Unit</label>
                  <select
                    className="field-input"
                    value={createForm.driver_unit}
                    onChange={(e) => setCreateForm({ ...createForm, driver_unit: e.target.value })}
                  >
                    {Object.entries(DRIVER_UNIT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="field-label">Description</label>
              <input
                className="field-input"
                placeholder="What this assembly covers"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              />

              <label className="field-label">Notes</label>
              <textarea
                className="field-input"
                rows={2}
                value={createForm.notes}
                onChange={(e) => setCreateForm({ ...createForm, notes: e.target.value })}
              />

              {createError && <p className="auth-error">{createError}</p>}

              <button
                type="submit"
                className="btn-primary"
                disabled={creating}
                style={{ marginTop: '1rem' }}
              >
                {creating ? 'Creating...' : 'Create Assembly'}
              </button>
            </form>
          </div>
        )}

        {/* ── Filters ──────────────────────────────────────────────────────── */}
        <div className="crm-search-bar" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search assemblies..."
            className="field-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: '200px' }}
          />
          <select
            className="field-input"
            value={showActive}
            onChange={(e) => setShowActive(e.target.value as 'true' | 'false' | 'all')}
            style={{ width: '150px' }}
          >
            <option value="true">Active only</option>
            <option value="false">Archived</option>
            <option value="all">All</option>
          </select>
        </div>

        {/* ── Assembly List ────────────────────────────────────────────────── */}
        {loading ? (
          <p className="settings-loading">Loading...</p>
        ) : assemblies.length === 0 ? (
          <div className="crm-empty">
            <p>No assemblies found. Create one to get started with material takeoffs.</p>
          </div>
        ) : (
          <div className="assembly-grid">
            {assemblies.map((asm) => (
              <div key={asm.id} className="assembly-card">
                <div className="assembly-card-header">
                  <Link href={`/assemblies/${asm.id}`} className="assembly-card-title">
                    {asm.name}
                  </Link>
                  <span className="assembly-card-driver">
                    per {DRIVER_UNIT_LABELS[asm.driver_unit] || asm.driver_unit}
                  </span>
                </div>
                {asm.description && (
                  <p className="assembly-card-desc">{asm.description}</p>
                )}
                <div className="assembly-card-meta">
                  <span>
                    {asm.assembly_component?.length || 0} component
                    {(asm.assembly_component?.length || 0) !== 1 ? 's' : ''}
                  </span>
                  {asm.assembly_component && asm.assembly_component.length > 0 && (
                    <span className="assembly-card-items">
                      {asm.assembly_component
                        .slice(0, 3)
                        .map((c) => c.catalog_item?.code || c.catalog_item?.name)
                        .join(', ')}
                      {asm.assembly_component.length > 3 && ` +${asm.assembly_component.length - 3} more`}
                    </span>
                  )}
                </div>
                <div className="assembly-card-actions">
                  <Link href={`/assemblies/${asm.id}`} className="btn-secondary btn-sm">
                    Edit
                  </Link>
                  <button
                    className="btn-secondary btn-sm btn-danger"
                    onClick={() => handleArchive(asm.id)}
                  >
                    Archive
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
