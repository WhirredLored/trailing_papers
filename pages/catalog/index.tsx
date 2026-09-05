import { useState, useEffect, useCallback, type FormEvent, type ChangeEvent } from 'react'
import Head from 'next/head'
import { getBrowserClient } from '@/lib/supabase-browser'
import { formatCents } from '@/lib/money'

// ─── Types ───────────────────────────────────────────────────────────────────
interface CatalogItem {
  id: string
  code: string
  name: string
  description: string | null
  kind: string
  unit: string
  unit_cost_cents: number
  default_markup_bp: number
  taxable: boolean
  active: boolean
  notes: string | null
}

const UNIT_LABELS: Record<string, string> = {
  ea: 'each',
  sq_ft: 'sq ft',
  lin_ft: 'lin ft',
  sq: 'sq (100 sf)',
  hour: 'hour',
  day: 'day',
  load: 'load',
}

const KIND_LABELS: Record<string, string> = {
  labor: 'Labor',
  material: 'Material',
  equipment: 'Equipment',
  subcontract: 'Subcontract',
  other: 'Other',
}

// ─── Component ───────────────────────────────────────────────────────────────
export default function CatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>([])
  const [search, setSearch] = useState('')
  const [filterKind, setFilterKind] = useState('')
  const [showActive, setShowActive] = useState<'true' | 'false' | 'all'>('true')
  const [loading, setLoading] = useState(true)

  // Create form
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({
    code: '',
    name: '',
    description: '',
    kind: 'material',
    unit: 'ea',
    unit_cost_dollars: '',
    default_markup_pct: '',
    taxable: true,
    notes: '',
  })
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Bulk reprice
  const [showReprice, setShowReprice] = useState(false)
  const [repricePct, setRepricePct] = useState('')
  const [repricePreview, setRepricePreview] = useState<
    Array<{ code: string; name: string; oldPriceCents: number; newPriceCents: number }> | null
  >(null)
  const [repricing, setRepricing] = useState(false)

  // CSV import
  const [showImport, setShowImport] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [importPreview, setImportPreview] = useState<Record<string, unknown> | null>(null)
  const [importing, setImporting] = useState(false)

  // Edit item
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Record<string, unknown>>({})

  // Price history
  const [historyItemId, setHistoryItemId] = useState<string | null>(null)
  const [priceHistory, setPriceHistory] = useState<
    Array<{ old_price_cents: number; new_price_cents: number; changed_at: string }> | null
  >(null)

  const getToken = useCallback(async () => {
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    return session?.access_token
  }, [])

  const fetchItems = useCallback(async () => {
    const token = await getToken()
    if (!token) return

    const params = new URLSearchParams()
    if (search) params.set('search', search)
    if (filterKind) params.set('kind', filterKind)
    params.set('active', showActive)

    const res = await fetch(`/api/catalog?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      setItems(await res.json())
    }
    setLoading(false)
  }, [search, filterKind, showActive, getToken])

  useEffect(() => {
    fetchItems()
  }, [fetchItems])

  // ─── Create ──────────────────────────────────────────────────────────────
  async function handleCreate(e: FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)

    const token = await getToken()
    if (!token) return

    const unitCostCents = Math.round(parseFloat(createForm.unit_cost_dollars || '0') * 100)
    const markupBp = Math.round(parseFloat(createForm.default_markup_pct || '0') * 100)

    const res = await fetch('/api/catalog', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code: createForm.code,
        name: createForm.name,
        description: createForm.description || null,
        kind: createForm.kind,
        unit: createForm.unit,
        unit_cost_cents: unitCostCents,
        default_markup_bp: markupBp,
        taxable: createForm.taxable,
        notes: createForm.notes || null,
      }),
    })

    if (res.ok) {
      setShowCreate(false)
      setCreateForm({
        code: '',
        name: '',
        description: '',
        kind: 'material',
        unit: 'ea',
        unit_cost_dollars: '',
        default_markup_pct: '',
        taxable: true,
        notes: '',
      })
      fetchItems()
    } else {
      const j = await res.json()
      setCreateError(j.error || 'Failed to create item')
    }
    setCreating(false)
  }

  // ─── Edit inline ─────────────────────────────────────────────────────────
  function startEdit(item: CatalogItem) {
    setEditingId(item.id)
    setEditForm({
      code: item.code,
      name: item.name,
      description: item.description || '',
      kind: item.kind,
      unit: item.unit,
      unit_cost_dollars: (item.unit_cost_cents / 100).toFixed(2),
      default_markup_pct: (item.default_markup_bp / 100).toFixed(2),
      taxable: item.taxable,
      active: item.active,
      notes: item.notes || '',
    })
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault()
    const token = await getToken()
    if (!token || !editingId) return

    const unitCostCents = Math.round(parseFloat(String(editForm.unit_cost_dollars || '0')) * 100)
    const markupBp = Math.round(parseFloat(String(editForm.default_markup_pct || '0')) * 100)

    const res = await fetch(`/api/catalog/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code: editForm.code,
        name: editForm.name,
        description: editForm.description || null,
        kind: editForm.kind,
        unit: editForm.unit,
        unit_cost_cents: unitCostCents,
        default_markup_bp: markupBp,
        taxable: editForm.taxable,
        active: editForm.active,
        notes: editForm.notes || null,
      }),
    })

    if (res.ok) {
      setEditingId(null)
      fetchItems()
    }
  }

  // ─── Archive ─────────────────────────────────────────────────────────────
  async function handleArchive(id: string) {
    const token = await getToken()
    if (!token) return

    const res = await fetch(`/api/catalog/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.ok) {
      fetchItems()
    }
  }

  // ─── Bulk Reprice ────────────────────────────────────────────────────────
  async function handleRepricePreview() {
    setRepricing(true)
    const token = await getToken()
    if (!token) return

    const adjustmentBp = Math.round(parseFloat(repricePct || '0') * 100)

    const res = await fetch('/api/catalog/bulk-reprice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        adjustmentBp,
        filter: { kind: filterKind || undefined, search: search || undefined },
        dryRun: true,
      }),
    })

    if (res.ok) {
      const data = await res.json()
      setRepricePreview(data.items)
    }
    setRepricing(false)
  }

  async function handleRepriceApply() {
    setRepricing(true)
    const token = await getToken()
    if (!token) return

    const adjustmentBp = Math.round(parseFloat(repricePct || '0') * 100)

    const res = await fetch('/api/catalog/bulk-reprice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        adjustmentBp,
        filter: { kind: filterKind || undefined, search: search || undefined },
        dryRun: false,
      }),
    })

    if (res.ok) {
      setShowReprice(false)
      setRepricePreview(null)
      setRepricePct('')
      fetchItems()
    }
    setRepricing(false)
  }

  // ─── CSV Export ──────────────────────────────────────────────────────────
  async function handleExport() {
    const token = await getToken()
    if (!token) return

    const res = await fetch('/api/catalog/csv', {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'catalog_export.csv'
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  // ─── CSV Import ──────────────────────────────────────────────────────────
  async function handleImportPreview() {
    setImporting(true)
    const token = await getToken()
    if (!token) return

    const res = await fetch('/api/catalog/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ csv: csvText, dryRun: true }),
    })

    if (res.ok) {
      setImportPreview(await res.json())
    }
    setImporting(false)
  }

  async function handleImportApply() {
    setImporting(true)
    const token = await getToken()
    if (!token) return

    const res = await fetch('/api/catalog/csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ csv: csvText, dryRun: false }),
    })

    if (res.ok) {
      setShowImport(false)
      setCsvText('')
      setImportPreview(null)
      fetchItems()
    }
    setImporting(false)
  }

  function handleCsvFileUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setCsvText(reader.result as string)
    }
    reader.readAsText(file)
  }

  // ─── Price History ───────────────────────────────────────────────────────
  async function showPriceHistory(itemId: string) {
    const token = await getToken()
    if (!token) return

    const res = await fetch(`/api/catalog/${itemId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.ok) {
      const data = await res.json()
      setPriceHistory(data.price_history || [])
      setHistoryItemId(itemId)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Price Book — PaperTrail</title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <h1 className="crm-title">Price Book</h1>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
              {showCreate ? 'Cancel' : 'Add Item'}
            </button>
            <button className="btn-secondary" onClick={() => setShowReprice(!showReprice)}>
              Bulk Reprice
            </button>
            <button className="btn-secondary" onClick={handleExport}>
              Export CSV
            </button>
            <button className="btn-secondary" onClick={() => setShowImport(!showImport)}>
              Import CSV
            </button>
          </div>
        </div>

        {/* ── Create Form ────────────────────────────────────────────────────── */}
        {showCreate && (
          <div className="crm-form-card">
            <h2>Add Catalog Item</h2>
            <form onSubmit={handleCreate} className="settings-form">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="field-label">Code *</label>
                  <input
                    required
                    className="field-input"
                    placeholder="e.g. SID-D45"
                    value={createForm.code}
                    onChange={(e) => setCreateForm({ ...createForm, code: e.target.value })}
                  />
                </div>
                <div>
                  <label className="field-label">Name *</label>
                  <input
                    required
                    className="field-input"
                    placeholder="e.g. Vinyl siding D4.5"
                    value={createForm.name}
                    onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  />
                </div>
              </div>

              <label className="field-label">Description</label>
              <input
                className="field-input"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="field-label">Kind</label>
                  <select
                    className="field-input"
                    value={createForm.kind}
                    onChange={(e) => setCreateForm({ ...createForm, kind: e.target.value })}
                  >
                    {Object.entries(KIND_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">Unit</label>
                  <select
                    className="field-input"
                    value={createForm.unit}
                    onChange={(e) => setCreateForm({ ...createForm, unit: e.target.value })}
                  >
                    {Object.entries(UNIT_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="field-label">
                    <input
                      type="checkbox"
                      checked={createForm.taxable}
                      onChange={(e) => setCreateForm({ ...createForm, taxable: e.target.checked })}
                    />{' '}
                    Taxable
                  </label>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <label className="field-label">Unit Cost ($)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="field-input"
                    placeholder="0.00"
                    value={createForm.unit_cost_dollars}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, unit_cost_dollars: e.target.value })
                    }
                  />
                </div>
                <div>
                  <label className="field-label">Default Markup (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    className="field-input"
                    placeholder="0.00"
                    value={createForm.default_markup_pct}
                    onChange={(e) =>
                      setCreateForm({ ...createForm, default_markup_pct: e.target.value })
                    }
                  />
                </div>
              </div>

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
                {creating ? 'Saving...' : 'Save Item'}
              </button>
            </form>
          </div>
        )}

        {/* ── Bulk Reprice ───────────────────────────────────────────────────── */}
        {showReprice && (
          <div className="crm-form-card">
            <h2>Bulk Reprice</h2>
            <p className="field-label" style={{ marginBottom: '0.5rem' }}>
              Apply a percentage adjustment to all active items matching current filters.
            </p>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
              <div>
                <label className="field-label">Adjustment (%)</label>
                <input
                  type="number"
                  step="0.01"
                  className="field-input"
                  placeholder="e.g. 5 for +5%, -3 for -3%"
                  value={repricePct}
                  onChange={(e) => setRepricePct(e.target.value)}
                  style={{ width: '200px' }}
                />
              </div>
              <button className="btn-secondary" onClick={handleRepricePreview} disabled={repricing}>
                Preview
              </button>
            </div>

            {repricePreview && (
              <div style={{ marginTop: '1rem' }}>
                <p>
                  <strong>{repricePreview.length}</strong> items will be updated:
                </p>
                <div
                  style={{
                    maxHeight: '200px',
                    overflow: 'auto',
                    marginTop: '0.5rem',
                    border: '1px solid var(--color-border, #333)',
                    borderRadius: '0.5rem',
                  }}
                >
                  <table className="catalog-table">
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Name</th>
                        <th>Old Price</th>
                        <th>New Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {repricePreview.map((p) => (
                        <tr key={p.code}>
                          <td>{p.code}</td>
                          <td>{p.name}</td>
                          <td>{formatCents(p.oldPriceCents)}</td>
                          <td>{formatCents(p.newPriceCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  className="btn-primary"
                  onClick={handleRepriceApply}
                  disabled={repricing}
                  style={{ marginTop: '1rem' }}
                >
                  {repricing ? 'Applying...' : 'Apply Changes'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── CSV Import ─────────────────────────────────────────────────────── */}
        {showImport && (
          <div className="crm-form-card">
            <h2>Import CSV</h2>
            <p className="field-label" style={{ marginBottom: '0.5rem' }}>
              Columns: code, name, description, kind, unit, unit_cost_cents, default_markup_bp,
              taxable, notes. Items with existing codes are updated; new codes are created.
            </p>
            <div style={{ marginBottom: '1rem' }}>
              <label className="field-label">Upload CSV file</label>
              <input type="file" accept=".csv" onChange={handleCsvFileUpload} />
            </div>
            <div>
              <label className="field-label">Or paste CSV content</label>
              <textarea
                className="field-input"
                rows={6}
                placeholder="code,name,description,kind,unit,unit_cost_cents,..."
                value={csvText}
                onChange={(e) => setCsvText(e.target.value)}
              />
            </div>
            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button className="btn-secondary" onClick={handleImportPreview} disabled={importing}>
                Dry Run (Preview)
              </button>
              {importPreview && !(importPreview as { errors?: unknown[] }).errors?.length && (
                <button className="btn-primary" onClick={handleImportApply} disabled={importing}>
                  {importing ? 'Importing...' : 'Import Now'}
                </button>
              )}
            </div>

            {importPreview && (
              <div style={{ marginTop: '1rem' }}>
                <p>
                  <strong>{String((importPreview as { totalRows?: number }).totalRows || 0)}</strong>{' '}
                  rows:{' '}
                  <strong>{String((importPreview as { creates?: number }).creates || 0)}</strong>{' '}
                  new,{' '}
                  <strong>{String((importPreview as { updates?: number }).updates || 0)}</strong>{' '}
                  updates
                </p>
                {((importPreview as { errors?: unknown[] }).errors || []).length > 0 && (
                  <div className="auth-error">
                    <p>Fix these errors before importing:</p>
                    <ul>
                      {(
                        (importPreview as { errors?: Array<{ row: number; errors: string[] }> })
                          .errors || []
                      ).map(
                        (
                          e: { row: number; errors: string[] },
                          i: number,
                        ) => (
                          <li key={i}>
                            Row {e.row}: {e.errors.join(', ')}
                          </li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Filters ────────────────────────────────────────────────────────── */}
        <div className="crm-search-bar" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <input
            type="search"
            placeholder="Search code or name..."
            className="field-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: '200px' }}
          />
          <select
            className="field-input"
            value={filterKind}
            onChange={(e) => setFilterKind(e.target.value)}
            style={{ width: '150px' }}
          >
            <option value="">All kinds</option>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
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

        {/* ── Items Table ────────────────────────────────────────────────────── */}
        {loading ? (
          <p className="settings-loading">Loading...</p>
        ) : (
          <div style={{ overflow: 'auto' }}>
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Unit</th>
                  <th style={{ textAlign: 'right' }}>Unit Cost</th>
                  <th style={{ textAlign: 'right' }}>Markup</th>
                  <th>Tax</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) =>
                  editingId === item.id ? (
                    <tr key={item.id}>
                      <td>
                        <input
                          className="field-input"
                          value={String(editForm.code || '')}
                          onChange={(e) => setEditForm({ ...editForm, code: e.target.value })}
                          style={{ width: '80px' }}
                        />
                      </td>
                      <td>
                        <input
                          className="field-input"
                          value={String(editForm.name || '')}
                          onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          style={{ width: '200px' }}
                        />
                      </td>
                      <td>
                        <select
                          className="field-input"
                          value={String(editForm.kind || '')}
                          onChange={(e) => setEditForm({ ...editForm, kind: e.target.value })}
                        >
                          {Object.entries(KIND_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          className="field-input"
                          value={String(editForm.unit || '')}
                          onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })}
                        >
                          {Object.entries(UNIT_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          className="field-input"
                          value={String(editForm.unit_cost_dollars || '')}
                          onChange={(e) =>
                            setEditForm({ ...editForm, unit_cost_dollars: e.target.value })
                          }
                          style={{ width: '100px', textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          className="field-input"
                          value={String(editForm.default_markup_pct || '')}
                          onChange={(e) =>
                            setEditForm({ ...editForm, default_markup_pct: e.target.value })
                          }
                          style={{ width: '80px', textAlign: 'right' }}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={editForm.taxable as boolean}
                          onChange={(e) =>
                            setEditForm({ ...editForm, taxable: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={editForm.active as boolean}
                          onChange={(e) =>
                            setEditForm({ ...editForm, active: e.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <button className="btn-secondary" onClick={saveEdit} style={{ marginRight: '0.25rem' }}>
                          Save
                        </button>
                        <button className="btn-secondary" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={item.id} className={!item.active ? 'catalog-row-archived' : ''}>
                      <td>
                        <code>{item.code}</code>
                      </td>
                      <td>
                        {item.name}
                        {item.description && (
                          <span className="catalog-desc"> — {item.description}</span>
                        )}
                      </td>
                      <td>{KIND_LABELS[item.kind] || item.kind}</td>
                      <td>{UNIT_LABELS[item.unit] || item.unit}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {formatCents(item.unit_cost_cents)}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {(item.default_markup_bp / 100).toFixed(2)}%
                      </td>
                      <td>{item.taxable ? '✓' : '—'}</td>
                      <td>{item.active ? 'Active' : 'Archived'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn-secondary"
                          onClick={() => startEdit(item)}
                          style={{ marginRight: '0.25rem' }}
                        >
                          Edit
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => showPriceHistory(item.id)}
                          style={{ marginRight: '0.25rem' }}
                        >
                          History
                        </button>
                        {item.active && (
                          <button className="btn-secondary" onClick={() => handleArchive(item.id)}>
                            Archive
                          </button>
                        )}
                      </td>
                    </tr>
                  ),
                )}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>
                      No catalog items found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Price History Modal ─────────────────────────────────────────────── */}
        {historyItemId && priceHistory && (
          <div className="crm-form-card" style={{ marginTop: '1rem' }}>
            <div className="crm-header">
              <h2>Price History</h2>
              <button className="btn-secondary" onClick={() => setHistoryItemId(null)}>
                Close
              </button>
            </div>
            {priceHistory.length === 0 ? (
              <p className="settings-loading">No price changes recorded yet.</p>
            ) : (
              <table className="catalog-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th style={{ textAlign: 'right' }}>Old Price</th>
                    <th style={{ textAlign: 'right' }}>New Price</th>
                    <th style={{ textAlign: 'right' }}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map((h, i) => {
                    const diff = h.new_price_cents - h.old_price_cents
                    return (
                      <tr key={i}>
                        <td>{new Date(h.changed_at).toLocaleDateString()}</td>
                        <td style={{ textAlign: 'right' }}>{formatCents(h.old_price_cents)}</td>
                        <td style={{ textAlign: 'right' }}>{formatCents(h.new_price_cents)}</td>
                        <td
                          style={{
                            textAlign: 'right',
                            color: diff > 0 ? '#ef4444' : diff < 0 ? '#22c55e' : undefined,
                          }}
                        >
                          {diff > 0 ? '+' : ''}
                          {formatCents(diff)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </>
  )
}
