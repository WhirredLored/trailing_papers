import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'
import { formatCents } from '@/lib/money'
import type { Tables } from '@/types/db'

type EstimateSummary = Pick<
  Tables<'estimate'>,
  'id' | 'version' | 'status' | 'total_cents' | 'issued_at'
>

// Mirrors the API's select: '*, property(address_line1, client(name))'
type ProjectDetail = Tables<'project'> & {
  property:
    | (Pick<Tables<'property'>, 'address_line1'> & {
        client: Pick<Tables<'client'>, 'name'> | null
      })
    | null
}

export default function ProjectDetailPage() {
  const router = useRouter()
  const { id } = router.query

  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'estimate' | 'photos' | 'money'>(
    'overview',
  )

  const fetchProject = useCallback(async () => {
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch(`/api/project/${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })

    if (res.ok) setProject(await res.json())
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (id) fetchProject()
  }, [id, fetchProject])

  if (loading)
    return (
      <main className="crm-shell">
        <p className="settings-loading">Loading...</p>
      </main>
    )
  if (!project)
    return (
      <main className="crm-shell">
        <p className="settings-loading">Not found.</p>
      </main>
    )

  return (
    <>
      <Head>
        <title>{project.title} — PaperTrail</title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <Link href={`/properties/${project.property_id}`} className="crm-back-link">
            ← Back to Property
          </Link>
          <h1 className="crm-title">{project.title}</h1>
          <p className="field-hint">
            {project.property?.client?.name} · {project.property?.address_line1} · Status:{' '}
            <strong>{project.status}</strong>
          </p>
        </div>

        {/* Tab shell as requested in C04 */}
        <div className="tab-bar" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`tab-btn${activeTab === 'overview' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'estimate'}
            className={`tab-btn${activeTab === 'estimate' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('estimate')}
          >
            Estimate
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'photos'}
            className={`tab-btn${activeTab === 'photos' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('photos')}
          >
            Photos
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'money'}
            className={`tab-btn${activeTab === 'money' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('money')}
          >
            Money
          </button>
        </div>

        <div className="settings-container" style={{ margin: 0 }}>
          {activeTab === 'overview' && (
            <div className="settings-section">
              <h2 className="settings-section-title">Scope & Dates</h2>
              <div
                className="field-row"
                style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}
              >
                <div>
                  <strong>Scope Summary:</strong> {project.scope_summary || 'None'}
                </div>
                <div>
                  <strong>Start Date:</strong> {project.start_date || 'TBD'}
                </div>
                <div>
                  <strong>Target Date:</strong> {project.target_date || 'TBD'}
                </div>
              </div>
              <p className="field-hint" style={{ marginTop: '2rem' }}>
                More fields will be added in future commits.
              </p>
            </div>
          )}

          {activeTab === 'estimate' && <EstimatesTab projectId={project.id} />}

          {activeTab === 'photos' && (
            <div className="settings-section">
              <p className="field-hint">Photos tab (stubbed for future commit)</p>
            </div>
          )}

          {activeTab === 'money' && (
            <div className="settings-section">
              <p className="field-hint">Money tab (stubbed for future commit)</p>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

/**
 * Every version of the estimate for this project, newest first. Superseded
 * versions stay listed — the evidence chain is the point, so nothing that was
 * ever put in front of a client disappears from the record.
 */
function EstimatesTab({ projectId }: { projectId: string }) {
  const [estimates, setEstimates] = useState<EstimateSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const fetchEstimates = useCallback(async () => {
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch(`/api/estimate?project_id=${projectId}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (res.ok) setEstimates((await res.json()) as EstimateSummary[])
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    fetchEstimates()
  }, [fetchEstimates])

  const createEstimate = async () => {
    setCreating(true)
    setError(null)

    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setError('Your session expired. Sign in again.')
      setCreating(false)
      return
    }

    const res = await fetch('/api/estimate', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ project_id: projectId }),
    })
    const body = await res.json().catch(() => ({ error: 'Could not start an estimate.' }))
    setCreating(false)

    if (res.ok) {
      router.push(`/estimates/${body.id}`)
      return
    }
    // A project holds one open draft at a time; the API points at it.
    if (res.status === 409 && body.estimate_id) {
      router.push(`/estimates/${body.estimate_id}`)
      return
    }
    setError(body.error ?? 'Could not start an estimate.')
  }

  if (loading) return <p className="settings-loading">Loading estimates...</p>

  return (
    <div className="settings-section">
      <div className="crm-section-header">
        <h2 className="settings-section-title">Estimates</h2>
        <button type="button" className="btn-secondary" onClick={createEstimate} disabled={creating}>
          {creating ? 'Starting...' : 'New estimate'}
        </button>
      </div>

      {error ? <p className="auth-error">{error}</p> : null}

      {estimates.length === 0 ? (
        <p className="crm-empty">No estimates yet.</p>
      ) : (
        <div className="crm-list">
          {estimates.map((estimate) => (
            <Link key={estimate.id} href={`/estimates/${estimate.id}`} className="crm-list-item">
              <span className="crm-list-title">
                Version {estimate.version} - {formatCents(estimate.total_cents)}
              </span>
              <span className="crm-list-subtitle">
                <span className={`est-status est-status--${estimate.status}`}>
                  {estimate.status}
                </span>
                {estimate.issued_at
                  ? ` - issued ${new Date(estimate.issued_at).toLocaleDateString()}`
                  : ' - not yet issued'}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
