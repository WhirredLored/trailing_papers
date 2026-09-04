/* eslint-disable @next/next/no-img-element */
import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { getBrowserClient } from '@/lib/supabase-browser'

// ─── Types ────────────────────────────────────────────────────────────────────
interface CompanyProfile {
  id: string
  name: string
  legal_name: string | null
  dba: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  zip: string | null
  phone: string | null
  email: string | null
  website: string | null
  tax_id: string | null
  default_tax_bp: number
  payment_terms_days: number
  deposit_pct: number | null
  deposit_fixed_cents: number | null
  license_number: string | null
  license_expires_at: string | null
  insurance_carrier: string | null
  insurance_policy: string | null
  insurance_expires_at: string | null
  logo_path: string | null
}

interface TeamMember {
  id: string
  role: string
  full_name: string | null
  created_at: string
  deleted_at: string | null
}

// ─── Expiry warning helper ────────────────────────────────────────────────────
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function ExpiryBadge({ label, dateStr }: { label: string; dateStr: string | null }) {
  const days = daysUntil(dateStr)
  if (days === null) return null
  if (days > 30) return null
  const urgent = days <= 7
  return (
    <div
      role="alert"
      className={`expiry-badge ${urgent ? 'expiry-badge--urgent' : 'expiry-badge--warn'}`}
    >
      ⚠️ {label} {days <= 0 ? 'EXPIRED' : `expires in ${days} day${days === 1 ? '' : 's'}`}
      {dateStr ? ` (${dateStr})` : ''}
    </div>
  )
}

// ─── Letterhead preview ───────────────────────────────────────────────────────
function LetterheadPreview({ p, logoUrl }: { p: CompanyProfile; logoUrl: string | null }) {
  return (
    <div className="lh-preview">
      <div className="lh-header">
        {logoUrl && <img src={logoUrl} alt="Company logo" className="lh-logo" />}
        <div className="lh-info">
          <div className="lh-company-name">{p.legal_name || p.name}</div>
          {p.dba && <div className="lh-dba">DBA: {p.dba}</div>}
          {(p.address_line1 || p.city) && (
            <div className="lh-address">
              {p.address_line1}{p.address_line2 ? `, ${p.address_line2}` : ''}
              {(p.city || p.state || p.zip) ? ` · ${[p.city, p.state, p.zip].filter(Boolean).join(', ')}` : ''}
            </div>
          )}
          {p.phone && <div className="lh-contact">{p.phone}</div>}
          {p.email && <div className="lh-contact">{p.email}</div>}
          {p.license_number && <div className="lh-lic">Lic. #{p.license_number}</div>}
        </div>
      </div>
      <div className="lh-rule" />
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function CompanySettingsPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<CompanyProfile | null>(null)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'profile' | 'team'>('profile')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'crew'>('crew')
  const [inviting, setInviting] = useState(false)
  const [inviteMsg, setInviteMsg] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Auth gate: crew cannot access settings ──────────────────────────────────
  useEffect(() => {
    const client = getBrowserClient()
    void client.auth.getSession().then(({ data: { session } }) => {
      if (!session) { void router.push('/auth/login?next=/settings/company'); return }
      const role = (session.user.app_metadata as Record<string, string>)?.role
      if (role === 'crew') { void router.push('/'); return }
      fetchAll(session.access_token)
    })
  }, [router])

  async function fetchAll(token: string) {
    const headers = { Authorization: `Bearer ${token}` }
    const [pRes, tRes] = await Promise.all([
      fetch('/api/company/profile', { headers }),
      fetch('/api/company/team', { headers }),
    ])
    if (pRes.ok) {
      const p: CompanyProfile = await pRes.json()
      setProfile(p)
      if (p.logo_path) {
        const client = getBrowserClient()
        const { data } = client.storage.from('company-assets').getPublicUrl(p.logo_path)
        setLogoUrl(data.publicUrl)
      }
    }
    if (tRes.ok) setTeam(await tRes.json())
  }

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    setSaveMsg(null)
    setError(null)

    const fd = new FormData(e.currentTarget)
    const patch: Record<string, unknown> = {}
    for (const [k, v] of fd.entries()) {
      patch[k] = v === '' ? null : v
    }
    // Numeric conversions
    if (patch.default_tax_bp !== null) patch.default_tax_bp = Number(patch.default_tax_bp)
    if (patch.payment_terms_days !== null) patch.payment_terms_days = Number(patch.payment_terms_days)
    if (patch.deposit_pct !== null) patch.deposit_pct = Number(patch.deposit_pct)

    const client = getBrowserClient()
    const { data: { session } } = await client.auth.getSession()
    if (!session) return

    const res = await fetch('/api/company/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(patch),
    })
    if (res.ok) {
      setSaveMsg('Saved.')
      // Refresh profile to keep preview in sync.
      const p: CompanyProfile = await (await fetch('/api/company/profile', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })).json()
      setProfile(p)
    } else {
      const j = await res.json()
      setError(j.error ?? 'Save failed.')
    }
    setSaving(false)
  }

  async function handleLogoChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const MAX = 5 * 1024 * 1024
    if (file.size > MAX) { setError('Logo must be under 5 MB.'); return }

    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
    const reader = new FileReader()
    reader.onload = async (ev) => {
      const b64 = (ev.target?.result as string).split(',')[1]
      const client = getBrowserClient()
      const { data: { session } } = await client.auth.getSession()
      if (!session) return

      const res = await fetch('/api/company/logo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ data: b64, mimeType: file.type, ext }),
      })
      if (res.ok) {
        setLogoUrl(URL.createObjectURL(file))
        setSaveMsg('Logo uploaded.')
      } else {
        const j = await res.json()
        setError(j.error ?? 'Upload failed.')
      }
    }
    reader.readAsDataURL(file)
  }

  async function handleInvite(e: FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteMsg(null)

    const client = getBrowserClient()
    const { data: { session } } = await client.auth.getSession()
    if (!session) return

    const res = await fetch('/api/auth/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
    })
    if (res.ok) {
      setInviteMsg(`Invite sent to ${inviteEmail}.`)
      setInviteEmail('')
    } else {
      const j = await res.json()
      setInviteMsg(j.error ?? 'Invite failed.')
    }
    setInviting(false)
  }

  async function handleDeactivate(userId: string) {
    if (!confirm('Deactivate this team member? They will lose access immediately.')) return

    const client = getBrowserClient()
    const { data: { session } } = await client.auth.getSession()
    if (!session) return

    const res = await fetch('/api/company/team', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ userId, deactivate: true }),
    })
    if (res.ok) {
      setTeam(prev => prev.map(m => m.id === userId ? { ...m, deleted_at: new Date().toISOString() } : m))
    }
  }

  if (!profile) {
    return (
      <main className="settings-shell">
        <p className="settings-loading">Loading…</p>
      </main>
    )
  }

  const licDays = daysUntil(profile.license_expires_at)
  const insDays = daysUntil(profile.insurance_expires_at)

  return (
    <>
      <Head>
        <title>Company Settings — PaperTrail</title>
        <meta name="description" content="Manage your company profile, branding, and team." />
      </Head>

      <main className="settings-shell">
        <div className="settings-container">
          <h1 className="settings-title">Company Settings</h1>

          {/* Expiry warnings — always visible if within 30 days */}
          <ExpiryBadge label="Contractor license" dateStr={profile.license_expires_at} />
          <ExpiryBadge label="Insurance policy" dateStr={profile.insurance_expires_at} />

          {/* Tab bar */}
          <div className="tab-bar" role="tablist">
            <button
              id="tab-profile"
              role="tab"
              aria-selected={activeTab === 'profile'}
              className={`tab-btn${activeTab === 'profile' ? ' tab-btn--active' : ''}`}
              onClick={() => setActiveTab('profile')}
            >Profile</button>
            <button
              id="tab-team"
              role="tab"
              aria-selected={activeTab === 'team'}
              className={`tab-btn${activeTab === 'team' ? ' tab-btn--active' : ''}`}
              onClick={() => setActiveTab('team')}
            >Team</button>
          </div>

          {/* ── Profile tab ─────────────────────────────────────────────────── */}
          {activeTab === 'profile' && (
            <div className="settings-grid">
              {/* Left: form */}
              <div className="settings-form-col">
                <form onSubmit={handleSave} className="settings-form" noValidate>

                  <section className="settings-section">
                    <h2 className="settings-section-title">Business identity</h2>

                    <label htmlFor="s-name" className="field-label">Display name *</label>
                    <input id="s-name" name="name" className="field-input" required defaultValue={profile.name ?? ''} />

                    <label htmlFor="s-legal" className="field-label">Legal name</label>
                    <input id="s-legal" name="legal_name" className="field-input" defaultValue={profile.legal_name ?? ''} />

                    <label htmlFor="s-dba" className="field-label">DBA</label>
                    <input id="s-dba" name="dba" className="field-input" defaultValue={profile.dba ?? ''} />

                    <label htmlFor="s-tax-id" className="field-label">Tax ID / EIN</label>
                    <input id="s-tax-id" name="tax_id" className="field-input" defaultValue={profile.tax_id ?? ''} />
                  </section>

                  <section className="settings-section">
                    <h2 className="settings-section-title">Contact</h2>

                    <label htmlFor="s-phone" className="field-label">Phone</label>
                    <input id="s-phone" name="phone" type="tel" className="field-input" defaultValue={profile.phone ?? ''} />

                    <label htmlFor="s-email" className="field-label">Email</label>
                    <input id="s-email" name="email" type="email" className="field-input" defaultValue={profile.email ?? ''} />

                    <label htmlFor="s-website" className="field-label">Website</label>
                    <input id="s-website" name="website" type="url" className="field-input" defaultValue={profile.website ?? ''} />
                  </section>

                  <section className="settings-section">
                    <h2 className="settings-section-title">Address</h2>

                    <label htmlFor="s-addr1" className="field-label">Street</label>
                    <input id="s-addr1" name="address_line1" className="field-input" defaultValue={profile.address_line1 ?? ''} />

                    <label htmlFor="s-addr2" className="field-label">Suite / unit</label>
                    <input id="s-addr2" name="address_line2" className="field-input" defaultValue={profile.address_line2 ?? ''} />

                    <div className="field-row">
                      <div className="field-row-item" style={{ flex: 2 }}>
                        <label htmlFor="s-city" className="field-label">City</label>
                        <input id="s-city" name="city" className="field-input" defaultValue={profile.city ?? ''} />
                      </div>
                      <div className="field-row-item">
                        <label htmlFor="s-state" className="field-label">State</label>
                        <input id="s-state" name="state" className="field-input" maxLength={2} style={{ textTransform: 'uppercase' }} defaultValue={profile.state ?? ''} />
                      </div>
                      <div className="field-row-item">
                        <label htmlFor="s-zip" className="field-label">ZIP</label>
                        <input id="s-zip" name="zip" className="field-input" maxLength={10} defaultValue={profile.zip ?? ''} />
                      </div>
                    </div>
                  </section>

                  <section className="settings-section">
                    <h2 className="settings-section-title">License &amp; Insurance</h2>

                    <label htmlFor="s-lic" className="field-label">License number</label>
                    <input id="s-lic" name="license_number" className="field-input" defaultValue={profile.license_number ?? ''} />

                    <label htmlFor="s-lic-exp" className="field-label">License expiry</label>
                    <input id="s-lic-exp" name="license_expires_at" type="date" className="field-input" defaultValue={profile.license_expires_at ?? ''} />
                    {licDays !== null && licDays <= 30 && (
                      <p className={`expiry-inline ${licDays <= 7 ? 'expiry-inline--urgent' : 'expiry-inline--warn'}`}>
                        {licDays <= 0 ? '⛔ EXPIRED' : `⚠️ Expires in ${licDays} day${licDays === 1 ? '' : 's'}`}
                      </p>
                    )}

                    <label htmlFor="s-ins-carrier" className="field-label">Insurance carrier</label>
                    <input id="s-ins-carrier" name="insurance_carrier" className="field-input" defaultValue={profile.insurance_carrier ?? ''} />

                    <label htmlFor="s-ins-policy" className="field-label">Policy number</label>
                    <input id="s-ins-policy" name="insurance_policy" className="field-input" defaultValue={profile.insurance_policy ?? ''} />

                    <label htmlFor="s-ins-exp" className="field-label">Insurance expiry</label>
                    <input id="s-ins-exp" name="insurance_expires_at" type="date" className="field-input" defaultValue={profile.insurance_expires_at ?? ''} />
                    {insDays !== null && insDays <= 30 && (
                      <p className={`expiry-inline ${insDays <= 7 ? 'expiry-inline--urgent' : 'expiry-inline--warn'}`}>
                        {insDays <= 0 ? '⛔ EXPIRED' : `⚠️ Expires in ${insDays} day${insDays === 1 ? '' : 's'}`}
                      </p>
                    )}
                  </section>

                  <section className="settings-section">
                    <h2 className="settings-section-title">Billing defaults</h2>

                    <label htmlFor="s-tax" className="field-label">Default tax rate (%)</label>
                    <input id="s-tax" name="default_tax_bp" type="number" min="0" max="100" step="0.01"
                      className="field-input"
                      defaultValue={(profile.default_tax_bp / 100).toFixed(2)} />

                    <label htmlFor="s-terms" className="field-label">Payment terms (days)</label>
                    <input id="s-terms" name="payment_terms_days" type="number" min="0" className="field-input" defaultValue={profile.payment_terms_days} />

                    <label htmlFor="s-deposit-pct" className="field-label">Deposit % (leave blank to use fixed amount)</label>
                    <input id="s-deposit-pct" name="deposit_pct" type="number" min="0" max="100"
                      className="field-input" defaultValue={profile.deposit_pct ?? ''} />
                  </section>

                  <section className="settings-section">
                    <h2 className="settings-section-title">Logo</h2>
                    {logoUrl && <img src={logoUrl} alt="Current logo" className="logo-preview" />}
                    <input
                      ref={fileInputRef}
                      id="s-logo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      onChange={handleLogoChange}
                      style={{ display: 'none' }}
                    />
                    <button
                      id="s-logo-btn"
                      type="button"
                      className="btn-secondary"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {logoUrl ? 'Replace logo' : 'Upload logo'}
                    </button>
                    <p className="field-hint">JPEG, PNG, WebP, or SVG · max 5 MB</p>
                  </section>

                  {error && <p role="alert" className="auth-error">{error}</p>}
                  {saveMsg && <p className="save-msg">{saveMsg}</p>}

                  <button id="settings-save" type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving…' : 'Save changes'}
                  </button>
                </form>
              </div>

              {/* Right: letterhead preview */}
              <div className="settings-preview-col">
                <h2 className="settings-section-title">Document letterhead preview</h2>
                <LetterheadPreview p={profile} logoUrl={logoUrl} />
                <p className="field-hint">This is how your header will appear on estimates, invoices, and other documents.</p>
              </div>
            </div>
          )}

          {/* ── Team tab ────────────────────────────────────────────────────── */}
          {activeTab === 'team' && (
            <div className="team-section">
              <form onSubmit={handleInvite} className="invite-form">
                <h2 className="settings-section-title">Invite team member</h2>
                <div className="field-row">
                  <div className="field-row-item" style={{ flex: 3 }}>
                    <label htmlFor="invite-email" className="field-label">Email</label>
                    <input
                      id="invite-email"
                      type="email"
                      required
                      className="field-input"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                    />
                  </div>
                  <div className="field-row-item">
                    <label htmlFor="invite-role" className="field-label">Role</label>
                    <select
                      id="invite-role"
                      className="field-input"
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as 'admin' | 'crew')}
                    >
                      <option value="crew">Crew</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                {inviteMsg && <p className="save-msg">{inviteMsg}</p>}
                <button id="invite-send" type="submit" className="btn-primary" disabled={inviting}>
                  {inviting ? 'Sending…' : 'Send invite'}
                </button>
              </form>

              <h2 className="settings-section-title" style={{ marginTop: '2rem' }}>Current team</h2>
              <div className="team-list">
                {team.map(m => (
                  <div key={m.id} className={`team-row${m.deleted_at ? ' team-row--inactive' : ''}`}>
                    <div className="team-row-name">
                      {m.full_name || <em>Unnamed</em>}
                      {m.deleted_at && <span className="team-badge team-badge--inactive">Inactive</span>}
                    </div>
                    <div className="team-row-role">{m.role}</div>
                    {!m.deleted_at && (
                      <button
                        id={`deactivate-${m.id}`}
                        type="button"
                        className="btn-danger-sm"
                        onClick={() => void handleDeactivate(m.id)}
                      >
                        Deactivate
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  )
}
