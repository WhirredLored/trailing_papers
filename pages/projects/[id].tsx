import { useState, useEffect, useCallback } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { getBrowserClient } from '@/lib/supabase-browser'

export default function ProjectDetailPage() {
  const router = useRouter()
  const { id } = router.query

  const [project, setProject] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'overview' | 'estimate' | 'photos' | 'money'>('overview')

  const fetchProject = useCallback(async () => {
    const supabase = getBrowserClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch(`/api/project/${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }
    })
    
    if (res.ok) setProject(await res.json())
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (id) fetchProject()
  }, [id, fetchProject])

  if (loading) return <main className="crm-shell"><p className="settings-loading">Loading...</p></main>
  if (!project) return <main className="crm-shell"><p className="settings-loading">Not found.</p></main>

  return (
    <>
      <Head>
        <title>{project.title} — PaperTrail</title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <Link href={`/properties/${project.property_id}`} className="crm-back-link">← Back to Property</Link>
          <h1 className="crm-title">{project.title}</h1>
          <p className="field-hint">
            {project.property?.client?.name} · {project.property?.address_line1} · Status: <strong>{project.status}</strong>
          </p>
        </div>

        {/* Tab shell as requested in C04 */}
        <div className="tab-bar" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === 'overview'}
            className={`tab-btn${activeTab === 'overview' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >Overview</button>
          <button
            role="tab"
            aria-selected={activeTab === 'estimate'}
            className={`tab-btn${activeTab === 'estimate' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('estimate')}
          >Estimate</button>
          <button
            role="tab"
            aria-selected={activeTab === 'photos'}
            className={`tab-btn${activeTab === 'photos' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('photos')}
          >Photos</button>
          <button
            role="tab"
            aria-selected={activeTab === 'money'}
            className={`tab-btn${activeTab === 'money' ? ' tab-btn--active' : ''}`}
            onClick={() => setActiveTab('money')}
          >Money</button>
        </div>

        <div className="settings-container" style={{ margin: 0 }}>
          {activeTab === 'overview' && (
            <div className="settings-section">
              <h2 className="settings-section-title">Scope & Dates</h2>
              <div className="field-row" style={{ flexDirection: 'column', gap: '0.5rem', alignItems: 'stretch' }}>
                <div><strong>Scope Summary:</strong> {project.scope_summary || 'None'}</div>
                <div><strong>Start Date:</strong> {project.start_date || 'TBD'}</div>
                <div><strong>Target Date:</strong> {project.target_date || 'TBD'}</div>
              </div>
              <p className="field-hint" style={{ marginTop: '2rem' }}>More fields will be added in future commits.</p>
            </div>
          )}

          {activeTab === 'estimate' && (
            <div className="settings-section">
              <p className="field-hint">Estimates tab (stubbed for future commit)</p>
            </div>
          )}

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
