import { useCallback, useEffect, useState } from 'react'
import type { Tables } from '@/types/db'
import { getBrowserClient } from '@/lib/supabase-browser'

/**
 * Share an issued document with the client (C10).
 *
 * Staff-facing control that generates revocable, tokenized links, provides copy
 * and message shortcuts (email/SMS), and displays client view analytics.
 */

/**
 * The staff API routes authorise on `Authorization: Bearer`, not a cookie (same
 * reasoning as the estimate page's own authHeaders()), so every fetch here needs
 * the current session's access token or the route 401s with "Missing
 * authorization header."
 */
async function authHeaders(): Promise<{ Authorization: string; 'Content-Type': string } | null> {
  const {
    data: { session },
  } = await getBrowserClient().auth.getSession()
  if (!session) return null
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

interface AccessLog {
  id: string
  viewed_at: string
  ip: string | null
  user_agent: string | null
  referer: string | null
}

interface ShareLinkWithLogs extends Tables<'share_link'> {
  access_logs?: AccessLog[]
}

interface SharePanelProps {
  documentId: string
  documentNumber: string
  companyName: string
  clientName?: string | null
  clientEmail?: string | null
  clientPhone?: string | null
  isOwnerOrAdmin: boolean
}

/** View counter, last-opened time, and the expandable access log for one link. */
function ShareStats({
  link,
  showLogs,
  onToggleLogs,
}: {
  link: ShareLinkWithLogs
  showLogs: boolean
  onToggleLogs: () => void
}) {
  return (
    <>
      <div className="share-stats-summary">
        <div>
          <strong>Views:</strong> {link.view_count}
        </div>
        {link.last_viewed_at && (
          <div>
            <strong>Last opened:</strong> {new Date(link.last_viewed_at).toLocaleString()}
          </div>
        )}
        {link.access_logs && link.access_logs.length > 0 && (
          <button type="button" className="btn-link" onClick={onToggleLogs}>
            {showLogs ? 'Hide access logs' : `View logs (${link.access_logs.length})`}
          </button>
        )}
      </div>

      {showLogs && link.access_logs && link.access_logs.length > 0 && (
        <ul className="share-log-list">
          {link.access_logs.map((log) => (
            <li key={log.id} className="share-log-item">
              <span className="share-log-time">{new Date(log.viewed_at).toLocaleString()}</span>
              <span className="share-log-ip">{log.ip || 'unknown IP'}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

export default function SharePanel({
  documentId,
  documentNumber,
  companyName,
  clientName,
  clientEmail,
  clientPhone,
  isOwnerOrAdmin,
}: SharePanelProps) {
  const [links, setLinks] = useState<ShareLinkWithLogs[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [expiryDays, setExpiryDays] = useState<number>(30)
  const [newlyCreatedUrl, setNewlyCreatedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  const loadLinks = useCallback(async () => {
    try {
      const headers = await authHeaders()
      if (!headers) throw new Error('Your session has expired. Please sign in again.')
      const res = await fetch(`/api/document/${documentId}/share`, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to load share links.')
      }
      const data = await res.json()
      setLinks(data.links ?? [])
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading links.')
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    loadLinks()
  }, [loadLinks])

  const handleCreate = async () => {
    if (!isOwnerOrAdmin) return
    setCreating(true)
    setError(null)
    setNewlyCreatedUrl(null)
    setCopied(false)

    try {
      const headers = await authHeaders()
      if (!headers) throw new Error('Your session has expired. Please sign in again.')
      const res = await fetch(`/api/document/${documentId}/share`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expiresInDays: expiryDays }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to create share link.')

      setNewlyCreatedUrl(body.shareUrl)
      await loadLinks()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create share link.')
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (linkId: string) => {
    if (!isOwnerOrAdmin) return
    if (!window.confirm('Are you sure you want to revoke this link? The client will no longer be able to open it.')) {
      return
    }

    setRevokingId(linkId)
    setError(null)
    try {
      const headers = await authHeaders()
      if (!headers) throw new Error('Your session has expired. Please sign in again.')
      const res = await fetch(`/api/share/${linkId}/revoke`, { method: 'POST', headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error || 'Failed to revoke link.')
      if (newlyCreatedUrl) setNewlyCreatedUrl(null)
      await loadLinks()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke link.')
    } finally {
      setRevokingId(null)
    }
  }

  const handleCopy = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 3000)
  }

  // Find most recent active link
  const now = Date.now()
  const activeLink = links.find(
    (l) => !l.revoked_at && new Date(l.expires_at).getTime() > now,
  )

  const totalViews = links.reduce((sum, l) => sum + (l.view_count || 0), 0)

  // The raw token is shown exactly once, at creation (it is never stored, so it
  // cannot be reconstructed from `token_hash` — that is the SHA-256 digest, and
  // building a URL from it would hand out a link that can never match any token).
  // A link created in an earlier session is therefore active but not copyable
  // here; only `newlyCreatedUrl` from THIS session's create call is ever a real URL.
  const greeting = clientName ? `Hi ${clientName}, ` : 'Hi, '
  const messageText = `${greeting}please find your estimate ${documentNumber} from ${companyName} here: ${newlyCreatedUrl ?? ''}`

  return (
    <div className="share-panel">
      <div className="share-panel-header">
        <h3 className="share-panel-title">Client Share Links</h3>
        {totalViews > 0 && (
          <span className="share-view-pill">
            {totalViews === 1 ? 'Client viewed 1 time' : `Client viewed ${totalViews} times`}
          </span>
        )}
      </div>

      <p className="field-hint">
        Generate an unguessable, secure link for the homeowner to review on their phone without logging in.
      </p>

      {loading && <p className="field-hint">Loading share links…</p>}
      {error && <div className="share-panel-error">{error}</div>}

      {/* Active Link or Creation Form */}
      {newlyCreatedUrl ? (
        <div className="share-active-box">
          <div className="share-status-row">
            <span className="badge-active">Active Link</span>
            {activeLink && (
              <span className="share-expires-text">
                Expires {new Date(activeLink.expires_at).toLocaleDateString()}
              </span>
            )}
          </div>

          <div className="share-link-input-group">
            <input type="text" readOnly value={newlyCreatedUrl} className="share-url-input" />
            <button type="button" className="btn-secondary" onClick={() => handleCopy(newlyCreatedUrl)}>
              {copied ? 'Copied!' : 'Copy Link'}
            </button>
          </div>

          <div className="share-action-buttons">
            <a
              href={`mailto:${clientEmail || ''}?subject=${encodeURIComponent(
                `Estimate ${documentNumber} from ${companyName}`,
              )}&body=${encodeURIComponent(messageText)}`}
              className="btn-secondary share-btn-link"
            >
              Email Client
            </a>
            <a
              href={`sms:${clientPhone || ''}?body=${encodeURIComponent(messageText)}`}
              className="btn-secondary share-btn-link"
            >
              SMS Client
            </a>
            {isOwnerOrAdmin && activeLink && (
              <button
                type="button"
                className="btn-danger-outline"
                disabled={revokingId === activeLink.id}
                onClick={() => handleRevoke(activeLink.id)}
              >
                {revokingId === activeLink.id ? 'Revoking…' : 'Revoke Link'}
              </button>
            )}
          </div>

          {activeLink && (
            <ShareStats
              link={activeLink}
              showLogs={showLogs}
              onToggleLogs={() => setShowLogs(!showLogs)}
            />
          )}
        </div>
      ) : activeLink ? (
        <div className="share-active-box">
          <div className="share-status-row">
            <span className="badge-active">Active Link</span>
            <span className="share-expires-text">
              Expires {new Date(activeLink.expires_at).toLocaleDateString()}
            </span>
          </div>

          <p className="field-hint">
            This link&rsquo;s URL was shown only once, right when it was created, and cannot be
            displayed again — generate a new link to get a fresh URL to copy or send. The
            existing link keeps working until it expires or is revoked.
          </p>

          {isOwnerOrAdmin && (
            <div className="share-create-controls">
              <label htmlFor="expiry-select" className="share-label">
                New Link Expiration:
              </label>
              <select
                id="expiry-select"
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="select-field"
                disabled={creating}
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days (default)</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <button type="button" className="btn-secondary" disabled={creating} onClick={handleCreate}>
                {creating ? 'Generating…' : 'Generate New Link'}
              </button>
              <button
                type="button"
                className="btn-danger-outline"
                disabled={revokingId === activeLink.id}
                onClick={() => handleRevoke(activeLink.id)}
              >
                {revokingId === activeLink.id ? 'Revoking…' : 'Revoke Link'}
              </button>
            </div>
          )}

          <ShareStats
            link={activeLink}
            showLogs={showLogs}
            onToggleLogs={() => setShowLogs(!showLogs)}
          />
        </div>
      ) : (
        <div className="share-create-box">
          {isOwnerOrAdmin ? (
            <div className="share-create-controls">
              <label htmlFor="expiry-select" className="share-label">
                Link Expiration:
              </label>
              <select
                id="expiry-select"
                value={expiryDays}
                onChange={(e) => setExpiryDays(Number(e.target.value))}
                className="select-field"
                disabled={creating}
              >
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days (default)</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </select>
              <button
                type="button"
                className="btn-secondary"
                disabled={creating}
                onClick={handleCreate}
              >
                {creating ? 'Generating…' : 'Create Share Link'}
              </button>
            </div>
          ) : (
            <p className="field-hint">No active share link. An owner or admin can generate one.</p>
          )}
        </div>
      )}

      {/* Historical Links */}
      {links.length > 1 && (
        <div className="share-history-section">
          <h4 className="share-history-title">Previous Links</h4>
          <ul className="share-history-list">
            {links
              .filter((l) => l.id !== activeLink?.id)
              .map((l) => {
                const isRevoked = Boolean(l.revoked_at)
                const isExpired = new Date(l.expires_at).getTime() <= now
                const statusLabel = isRevoked ? 'Revoked' : isExpired ? 'Expired' : 'Active'
                return (
                  <li key={l.id} className="share-history-item">
                    <div className="share-history-meta">
                      <span className={`badge-${statusLabel.toLowerCase()}`}>{statusLabel}</span>
                      <span>Created {new Date(l.created_at).toLocaleDateString()}</span>
                      <span>{l.view_count} views</span>
                    </div>
                  </li>
                )
              })}
          </ul>
        </div>
      )}
    </div>
  )
}
