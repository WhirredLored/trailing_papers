import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { getBrowserClient } from '@/lib/supabase-browser'
import { formatCents, formatCentsPlain, parseCents } from '@/lib/money'
import { computeTakeoff, type RoundingRule, type TakeoffAssembly } from '@/lib/takeoff'
import {
  UNGROUPED_LABEL,
  computeEstimateTotals,
  computeProfitability,
  isBillable,
  linesFromTakeoff,
  priceCatalogLine,
  summarizeGroups,
  type AmountMode,
  type DetailLevel,
  type EstimateLineDraft,
  type EstimateLineKind,
  type EstimateLineUnit,
  type EstimateTerms,
  type PricingMode,
  type TakeoffLineSource,
} from '@/lib/estimate'
import MeasurementInput, { type DriverUnit } from '@/components/MeasurementInput'

/**
 * Estimate builder.
 *
 * Everything on screen is computed by lib/estimate.ts in the browser — the same
 * pure engine the server runs when it saves and when it freezes the estimate at
 * issue. There is no second implementation of the money to drift from it, which
 * is why the total the contractor reads on a phone is the total that gets
 * signed.
 *
 * Once the estimate is issued this page stops being a builder and becomes a
 * record: the database refuses edits (Law 3), so the UI does not pretend to
 * offer them. The action is "create revision".
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EstimateRow = {
  id: string
  project_id: string
  version: number
  status: 'draft' | 'issued' | 'approved' | 'declined' | 'expired' | 'superseded'
  title: string | null
  detail_level: DetailLevel
  pricing_mode: PricingMode
  pricing_bp: number
  terms: string | null
  notes_to_client: string | null
  internal_notes: string | null
  tax_rate_bp: number
  discount_mode: AmountMode
  discount_value: number
  deposit_mode: AmountMode
  deposit_value: number
  issued_at: string | null
  expires_at: string | null
  superseded_by_estimate_id: string | null
  revised_from_estimate_id: string | null
  project?: { id: string; title: string; property?: { address_line1: string } | null } | null
}

type LineRow = {
  kind: EstimateLineKind
  catalog_item_id: string | null
  assembly_id: string | null
  driver_quantity: number | null
  assembly_group_id: string | null
  description: string
  quantity: number
  unit: EstimateLineUnit
  unit_price_cents: number
  unit_cost_cents: number
  taxable: boolean
  is_optional: boolean
  is_selected: boolean
  group_label: string | null
  derivation: string | null
}

/**
 * A line while it is being edited. The typed text is kept alongside the
 * canonical number so the field does not fight the contractor mid-keystroke —
 * the same approach C07's measurement input takes.
 */
type LineState = EstimateLineDraft & {
  key: string
  quantityText: string
  priceText: string
}

type CatalogItem = {
  id: string
  code: string
  name: string
  kind: EstimateLineKind
  unit: EstimateLineUnit
  unit_cost_cents: number
  default_markup_bp: number
  taxable: boolean
}

type AssemblyComponent = {
  quantity_per_driver: number
  waste_percent_bp: number
  rounding_rule: RoundingRule
  package_size: number
  sort_order: number
  catalog_item: CatalogItem | null
}

type Assembly = {
  id: string
  name: string
  driver_unit: DriverUnit
  assembly_component: AssemblyComponent[]
}

const UNIT_LABELS: Record<EstimateLineUnit, string> = {
  ea: 'ea',
  sq_ft: 'sq ft',
  lin_ft: 'lin ft',
  sq: 'sq',
  hour: 'hour',
  day: 'day',
  load: 'load',
}

const DRIVER_LABELS: Record<DriverUnit, string> = {
  sq_ft: 'sq ft',
  lin_ft: 'lin ft',
  ea: 'ea',
  sq: 'sq',
  opening: 'opening',
}

const KINDS: EstimateLineKind[] = ['material', 'labor', 'equipment', 'subcontract', 'other']
const UNITS: EstimateLineUnit[] = ['ea', 'sq_ft', 'lin_ft', 'sq', 'hour', 'day', 'load']

const STATUS_LABELS: Record<EstimateRow['status'], string> = {
  draft: 'Draft',
  issued: 'Issued',
  approved: 'Approved',
  declined: 'Declined',
  expired: 'Expired',
  superseded: 'Superseded',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let keyCounter = 0
function nextKey(): string {
  keyCounter += 1
  return `line-${keyCounter}`
}

function newGroupId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  // Only reached on a browser too old for randomUUID; the value just has to be
  // a unique uuid, and the server validates the shape.
  return '00000000-0000-4000-8000-' + Date.now().toString(16).padStart(12, '0').slice(-12)
}

function toState(draft: EstimateLineDraft): LineState {
  return {
    ...draft,
    key: nextKey(),
    quantityText: String(draft.quantity),
    priceText: formatCentsPlain(draft.unitPriceCents),
  }
}

function rowToState(row: LineRow): LineState {
  return toState({
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    kind: row.kind,
    unitPriceCents: row.unit_price_cents,
    unitCostCents: row.unit_cost_cents,
    taxable: row.taxable,
    isOptional: row.is_optional,
    isSelected: row.is_selected,
    groupLabel: row.group_label,
    catalogItemId: row.catalog_item_id,
    assemblyId: row.assembly_id,
    driverQuantity: row.driver_quantity === null ? null : Number(row.driver_quantity),
    assemblyGroupId: row.assembly_group_id,
    derivation: row.derivation,
  })
}

function stateToPayload(line: LineState) {
  return {
    kind: line.kind,
    catalog_item_id: line.catalogItemId ?? null,
    assembly_id: line.assemblyId ?? null,
    driver_quantity: line.driverQuantity ?? null,
    assembly_group_id: line.assemblyGroupId ?? null,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unit_price_cents: line.unitPriceCents,
    unit_cost_cents: line.unitCostCents,
    taxable: line.taxable,
    is_optional: line.isOptional,
    is_selected: line.isSelected,
    group_label: line.groupLabel,
    derivation: line.derivation ?? null,
  }
}

/** Parse a typed dollar amount without throwing while the field is half-typed. */
function tryCents(text: string): number | null {
  try {
    return parseCents(text)
  } catch {
    return null
  }
}

function formatBp(bp: number): string {
  return `${(bp / 100).toFixed(2).replace(/\.00$/, '')}%`
}

async function authHeaders(): Promise<HeadersInit | null> {
  const {
    data: { session },
  } = await getBrowserClient().auth.getSession()
  if (!session) return null
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function EstimateBuilderPage() {
  const router = useRouter()
  const { id } = router.query

  const [estimate, setEstimate] = useState<EstimateRow | null>(null)
  const [lines, setLines] = useState<LineState[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  // Header fields held locally so typing does not round-trip.
  const [pricingMode, setPricingMode] = useState<PricingMode>('markup')
  const [pricingBpText, setPricingBpText] = useState('0')
  const [taxBpText, setTaxBpText] = useState('0')
  const [discountMode, setDiscountMode] = useState<AmountMode>('percent')
  const [discountText, setDiscountText] = useState('0')
  const [depositMode, setDepositMode] = useState<AmountMode>('percent')
  const [depositText, setDepositText] = useState('0')
  const [notesToClient, setNotesToClient] = useState('')
  const [termsText, setTermsText] = useState('')
  const [internalNotes, setInternalNotes] = useState('')

  const [addPanel, setAddPanel] = useState<'catalog' | 'assembly' | 'free' | null>(null)
  const [preview, setPreview] = useState<DetailLevel>('itemized')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [issuePanelOpen, setIssuePanelOpen] = useState(false)
  const [issueDetailLevel, setIssueDetailLevel] = useState<DetailLevel>('itemized')

  const dragIndex = useRef<number | null>(null)

  const readOnly = estimate !== null && estimate.status !== 'draft'

  // ─── load ────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (typeof id !== 'string') return
    const headers = await authHeaders()
    if (!headers) return

    const res = await fetch(`/api/estimate/${id}`, { headers })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to load estimate.' }))
      setError(body.error ?? 'Failed to load estimate.')
      setLoading(false)
      return
    }

    const body = (await res.json()) as { estimate: EstimateRow; lines: LineRow[] }
    setEstimate(body.estimate)
    setLines(body.lines.map(rowToState))
    setPricingMode(body.estimate.pricing_mode)
    setPricingBpText(String(body.estimate.pricing_bp / 100))
    setTaxBpText(String(body.estimate.tax_rate_bp / 100))
    setDiscountMode(body.estimate.discount_mode)
    setDiscountText(
      body.estimate.discount_mode === 'percent'
        ? String(body.estimate.discount_value / 100)
        : formatCentsPlain(body.estimate.discount_value),
    )
    setDepositMode(body.estimate.deposit_mode)
    setDepositText(
      body.estimate.deposit_mode === 'percent'
        ? String(body.estimate.deposit_value)
        : formatCentsPlain(body.estimate.deposit_value),
    )
    setNotesToClient(body.estimate.notes_to_client ?? '')
    setTermsText(body.estimate.terms ?? '')
    setInternalNotes(body.estimate.internal_notes ?? '')
    setPreview(body.estimate.detail_level)
    setIssueDetailLevel(body.estimate.detail_level)
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (id) load()
  }, [id, load])

  // ─── live money ──────────────────────────────────────────────────────────
  const pricingBp = Math.round((Number(pricingBpText) || 0) * 100)
  const terms: EstimateTerms = useMemo(
    () => ({
      taxRateBp: Math.round((Number(taxBpText) || 0) * 100),
      discountMode,
      discountValue:
        discountMode === 'percent'
          ? Math.round((Number(discountText) || 0) * 100)
          : (tryCents(discountText) ?? 0),
      depositMode,
      depositValue:
        depositMode === 'percent'
          ? Math.round(Number(depositText) || 0)
          : (tryCents(depositText) ?? 0),
    }),
    [taxBpText, discountMode, discountText, depositMode, depositText],
  )

  const totals = useMemo(() => computeEstimateTotals(lines, terms), [lines, terms])
  const profit = useMemo(() => computeProfitability(lines, totals), [lines, totals])
  const groups = useMemo(() => summarizeGroups(lines), [lines])

  // ─── line editing ────────────────────────────────────────────────────────
  const updateLine = (key: string, patch: Partial<LineState>) => {
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((l) => l.key !== key))
  }

  const moveLine = (from: number, to: number) => {
    if (to < 0 || to >= lines.length || from === to) return
    setLines((current) => {
      const next = [...current]
      const [moved] = next.splice(from, 1)
      if (moved) next.splice(to, 0, moved)
      return next
    })
  }

  const addLines = (drafts: EstimateLineDraft[]) => {
    setLines((current) => [...current, ...drafts.map(toState)])
    setAddPanel(null)
  }

  // ─── save / issue / revise ───────────────────────────────────────────────
  const save = async () => {
    if (typeof id !== 'string') return
    setSaving(true)
    setError(null)
    setMessage(null)

    const headers = await authHeaders()
    if (!headers) {
      setError('Your session expired. Sign in again.')
      setSaving(false)
      return
    }

    const res = await fetch(`/api/estimate/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        pricing_mode: pricingMode,
        pricing_bp: pricingBp,
        tax_rate_bp: terms.taxRateBp,
        discount_mode: terms.discountMode,
        discount_value: terms.discountValue,
        deposit_mode: terms.depositMode,
        deposit_value: terms.depositValue,
        notes_to_client: notesToClient,
        terms: termsText,
        internal_notes: internalNotes,
        lines: lines.map(stateToPayload),
      }),
    })

    const body = await res.json().catch(() => ({ error: 'Save failed.' }))
    if (!res.ok) {
      setError(body.error ?? 'Save failed.')
    } else {
      setMessage('Saved.')
    }
    setSaving(false)
  }

  const issue = async () => {
    if (typeof id !== 'string') return
    setSaving(true)
    setError(null)

    const headers = await authHeaders()
    if (!headers) {
      setError('Issuing requires a connection. Sign in again.')
      setSaving(false)
      return
    }

    // Save first: the server issues what is STORED, not what is on screen.
    const saveRes = await fetch(`/api/estimate/${id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        pricing_mode: pricingMode,
        pricing_bp: pricingBp,
        tax_rate_bp: terms.taxRateBp,
        discount_mode: terms.discountMode,
        discount_value: terms.discountValue,
        deposit_mode: terms.depositMode,
        deposit_value: terms.depositValue,
        notes_to_client: notesToClient,
        terms: termsText,
        internal_notes: internalNotes,
        lines: lines.map(stateToPayload),
      }),
    })
    if (!saveRes.ok) {
      const body = await saveRes.json().catch(() => ({ error: 'Save failed.' }))
      setError(body.error ?? 'Save failed.')
      setSaving(false)
      return
    }

    const res = await fetch(`/api/estimate/${id}/issue`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ detail_level: issueDetailLevel }),
    })
    const body = await res.json().catch(() => ({ error: 'Issue failed.' }))
    if (!res.ok) {
      setError(body.error ?? 'Issue failed.')
      setSaving(false)
      return
    }

    setIssuePanelOpen(false)
    setSaving(false)
    await load()
  }

  const revise = async () => {
    if (typeof id !== 'string') return
    setSaving(true)
    setError(null)

    const headers = await authHeaders()
    if (!headers) {
      setError('Your session expired. Sign in again.')
      setSaving(false)
      return
    }

    const res = await fetch(`/api/estimate/${id}/revise`, { method: 'POST', headers })
    const body = await res.json().catch(() => ({ error: 'Could not create a revision.' }))
    setSaving(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create a revision.')
      return
    }
    router.push(`/estimates/${body.estimate.id}`)
  }

  // ─── render ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <main className="crm-shell">
        <p className="settings-loading">Loading…</p>
      </main>
    )
  }

  if (!estimate) {
    return (
      <main className="crm-shell">
        <p className="settings-loading">{error ?? 'Estimate not found.'}</p>
      </main>
    )
  }

  return (
    <>
      <Head>
        <title>
          {estimate.title ?? 'Estimate'} v{estimate.version} — PaperTrail
        </title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <Link href={`/projects/${estimate.project_id}`} className="crm-back-link">
            ← Back to project
          </Link>
          <h1 className="crm-title">{estimate.title ?? 'Estimate'}</h1>
          <p className="field-hint">
            Version {estimate.version} ·{' '}
            <span className={`est-status est-status--${estimate.status}`}>
              {STATUS_LABELS[estimate.status]}
            </span>
            {estimate.issued_at
              ? ` · issued ${new Date(estimate.issued_at).toLocaleDateString()}`
              : ''}
            {estimate.project?.property?.address_line1
              ? ` · ${estimate.project.property.address_line1}`
              : ''}
          </p>
        </div>

        {error ? <p className="auth-error">{error}</p> : null}
        {message ? <p className="save-msg">{message}</p> : null}

        {readOnly ? (
          <div className="est-frozen-note">
            <strong>This version is frozen.</strong> Its lines and totals cannot be changed —
            that is what makes it defensible six months from now. To change the price, create a
            revision; this version stays on the record.
          </div>
        ) : null}

        {/* ─── add lines ──────────────────────────────────────────────────── */}
        {!readOnly ? (
          <section className="est-section">
            <div className="est-add-bar">
              <button
                type="button"
                className={`est-add-btn${addPanel === 'catalog' ? ' est-add-btn--active' : ''}`}
                onClick={() => setAddPanel(addPanel === 'catalog' ? null : 'catalog')}
              >
                + Price book
              </button>
              <button
                type="button"
                className={`est-add-btn${addPanel === 'assembly' ? ' est-add-btn--active' : ''}`}
                onClick={() => setAddPanel(addPanel === 'assembly' ? null : 'assembly')}
              >
                + Assembly takeoff
              </button>
              <button
                type="button"
                className={`est-add-btn${addPanel === 'free' ? ' est-add-btn--active' : ''}`}
                onClick={() => setAddPanel(addPanel === 'free' ? null : 'free')}
              >
                + Free text
              </button>
            </div>

            {addPanel === 'catalog' ? (
              <CatalogPicker
                pricingMode={pricingMode}
                pricingBp={pricingBp}
                onAdd={(draft) => addLines([draft])}
              />
            ) : null}

            {addPanel === 'assembly' ? (
              <AssemblyPicker
                pricingMode={pricingMode}
                pricingBp={pricingBp}
                onAdd={(drafts) => addLines(drafts)}
              />
            ) : null}

            {addPanel === 'free' ? <FreeTextForm onAdd={(draft) => addLines([draft])} /> : null}
          </section>
        ) : null}

        {/* ─── lines ──────────────────────────────────────────────────────── */}
        <section className="est-section">
          <h2 className="settings-section-title">Lines</h2>

          {lines.length === 0 ? (
            <p className="crm-empty">
              No lines yet. Add from the price book, run an assembly takeoff, or type a line.
            </p>
          ) : (
            <ul className="est-lines">
              {lines.map((line, index) => {
                const label = line.groupLabel?.trim() || UNGROUPED_LABEL
                const previousLabel =
                  index === 0 ? null : lines[index - 1]?.groupLabel?.trim() || UNGROUPED_LABEL
                const showHeading = label !== previousLabel
                const extended = totals.lineExtendedCents[index] ?? 0
                const counted = isBillable(line)

                return (
                  <li key={line.key}>
                    {showHeading ? <h3 className="est-group-heading">{label}</h3> : null}

                    <div
                      className={`est-line${counted ? '' : ' est-line--excluded'}`}
                      draggable={!readOnly}
                      onDragStart={() => {
                        dragIndex.current = index
                      }}
                      onDragOver={(e) => {
                        if (!readOnly) e.preventDefault()
                      }}
                      onDrop={(e) => {
                        e.preventDefault()
                        if (readOnly) return
                        const from = dragIndex.current
                        dragIndex.current = null
                        if (from !== null) moveLine(from, index)
                      }}
                    >
                      <div className="est-line-main">
                        <div className="est-line-desc">
                          {line.isOptional ? (
                            <label className="est-optional-toggle">
                              <input
                                type="checkbox"
                                checked={line.isSelected}
                                disabled={readOnly}
                                onChange={(e) =>
                                  updateLine(line.key, { isSelected: e.target.checked })
                                }
                              />
                              <span className="est-optional-badge">Optional</span>
                            </label>
                          ) : null}
                          {readOnly ? (
                            <span className="est-line-text">{line.description}</span>
                          ) : (
                            <input
                              className="field-input est-line-input"
                              value={line.description}
                              onChange={(e) =>
                                updateLine(line.key, { description: e.target.value })
                              }
                              aria-label="Description"
                            />
                          )}
                        </div>

                        <div className="est-line-numbers">
                          {readOnly ? (
                            <span className="est-line-qty">
                              {line.quantity} {UNIT_LABELS[line.unit]}
                            </span>
                          ) : (
                            <input
                              className="field-input est-qty-input"
                              value={line.quantityText}
                              inputMode="decimal"
                              aria-label="Quantity"
                              onChange={(e) => {
                                const text = e.target.value
                                const parsed = Number(text)
                                updateLine(line.key, {
                                  quantityText: text,
                                  quantity:
                                    Number.isFinite(parsed) && parsed >= 0 ? parsed : line.quantity,
                                })
                              }}
                            />
                          )}
                          <span className="est-line-times">×</span>
                          {readOnly ? (
                            <span className="est-line-qty">{formatCents(line.unitPriceCents)}</span>
                          ) : (
                            <input
                              className="field-input est-price-input"
                              value={line.priceText}
                              inputMode="decimal"
                              aria-label="Unit price"
                              onChange={(e) => {
                                const text = e.target.value
                                const cents = tryCents(text)
                                updateLine(line.key, {
                                  priceText: text,
                                  unitPriceCents: cents ?? line.unitPriceCents,
                                })
                              }}
                            />
                          )}
                          <span className="est-line-extended">{formatCents(extended)}</span>
                        </div>
                      </div>

                      <div className="est-line-meta">
                        <span className="est-line-tag">{line.kind}</span>
                        {line.taxable ? <span className="est-line-tag">taxable</span> : null}
                        {!counted ? (
                          <span className="est-line-tag est-line-tag--muted">
                            not counted until selected
                          </span>
                        ) : null}
                        {!readOnly ? (
                          <span className="est-line-actions">
                            <button
                              type="button"
                              className="est-icon-btn"
                              aria-label="Move up"
                              onClick={() => moveLine(index, index - 1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="est-icon-btn"
                              aria-label="Move down"
                              onClick={() => moveLine(index, index + 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="est-icon-btn"
                              aria-label="Line details"
                              onClick={() => setExpanded(expanded === line.key ? null : line.key)}
                            >
                              ⋯
                            </button>
                          </span>
                        ) : null}
                      </div>

                      {line.derivation ? (
                        <p className="est-derivation">{line.derivation}</p>
                      ) : null}

                      {expanded === line.key && !readOnly ? (
                        <div className="est-line-detail">
                          <div className="field-row">
                            <div className="field-row-item">
                              <label className="field-label" htmlFor={`${line.key}-group`}>
                                Group heading
                              </label>
                              <input
                                id={`${line.key}-group`}
                                className="field-input"
                                value={line.groupLabel ?? ''}
                                placeholder={UNGROUPED_LABEL}
                                onChange={(e) =>
                                  updateLine(line.key, { groupLabel: e.target.value || null })
                                }
                              />
                            </div>
                            <div className="field-row-item">
                              <label className="field-label" htmlFor={`${line.key}-unit`}>
                                Unit
                              </label>
                              <select
                                id={`${line.key}-unit`}
                                className="field-input"
                                value={line.unit}
                                onChange={(e) =>
                                  updateLine(line.key, {
                                    unit: e.target.value as EstimateLineUnit,
                                  })
                                }
                              >
                                {UNITS.map((unit) => (
                                  <option key={unit} value={unit}>
                                    {UNIT_LABELS[unit]}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div className="field-row">
                            <div className="field-row-item">
                              <label className="field-label" htmlFor={`${line.key}-kind`}>
                                Kind
                              </label>
                              <select
                                id={`${line.key}-kind`}
                                className="field-input"
                                value={line.kind}
                                onChange={(e) =>
                                  updateLine(line.key, {
                                    kind: e.target.value as EstimateLineKind,
                                  })
                                }
                              >
                                {KINDS.map((kind) => (
                                  <option key={kind} value={kind}>
                                    {kind}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="field-row-item">
                              <label className="field-label" htmlFor={`${line.key}-cost`}>
                                Unit cost (internal)
                              </label>
                              <input
                                id={`${line.key}-cost`}
                                className="field-input"
                                inputMode="decimal"
                                defaultValue={formatCentsPlain(line.unitCostCents)}
                                onBlur={(e) => {
                                  const cents = tryCents(e.target.value)
                                  if (cents !== null) updateLine(line.key, { unitCostCents: cents })
                                }}
                              />
                            </div>
                          </div>

                          <div className="est-line-switches">
                            <label className="est-switch">
                              <input
                                type="checkbox"
                                checked={line.taxable}
                                onChange={(e) => updateLine(line.key, { taxable: e.target.checked })}
                              />
                              Taxable
                            </label>
                            <label className="est-switch">
                              <input
                                type="checkbox"
                                checked={line.isOptional}
                                onChange={(e) =>
                                  updateLine(line.key, {
                                    isOptional: e.target.checked,
                                    isSelected: e.target.checked ? line.isSelected : false,
                                  })
                                }
                              />
                              Optional
                            </label>
                            <button
                              type="button"
                              className="btn-danger-sm"
                              onClick={() => removeLine(line.key)}
                            >
                              Remove line
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* ─── terms ──────────────────────────────────────────────────────── */}
        {!readOnly ? (
          <section className="est-section">
            <h2 className="settings-section-title">Pricing and terms</h2>

            <div className="field-row">
              <div className="field-row-item">
                <label className="field-label" htmlFor="pricing-mode">
                  Price from cost by
                </label>
                <select
                  id="pricing-mode"
                  className="field-input"
                  value={pricingMode}
                  onChange={(e) => setPricingMode(e.target.value as PricingMode)}
                >
                  <option value="markup">Markup (added to cost)</option>
                  <option value="margin">Margin (share of price)</option>
                </select>
              </div>
              <div className="field-row-item">
                <label className="field-label" htmlFor="pricing-bp">
                  {pricingMode === 'markup' ? 'Markup %' : 'Margin %'}
                </label>
                <input
                  id="pricing-bp"
                  className="field-input"
                  inputMode="decimal"
                  value={pricingBpText}
                  onChange={(e) => setPricingBpText(e.target.value)}
                />
              </div>
            </div>
            <p className="field-hint">
              These are different numbers: 20% markup on $100 of cost is $120; 20% margin is
              $125. New lines from the price book are priced this way.
            </p>

            <div className="field-row">
              <div className="field-row-item">
                <label className="field-label" htmlFor="tax-bp">
                  Sales tax %
                </label>
                <input
                  id="tax-bp"
                  className="field-input"
                  inputMode="decimal"
                  value={taxBpText}
                  onChange={(e) => setTaxBpText(e.target.value)}
                />
              </div>
              <div className="field-row-item">
                <label className="field-label" htmlFor="discount-mode">
                  Discount
                </label>
                <div className="est-inline-pair">
                  <select
                    id="discount-mode"
                    className="field-input"
                    value={discountMode}
                    onChange={(e) => setDiscountMode(e.target.value as AmountMode)}
                  >
                    <option value="percent">%</option>
                    <option value="fixed">$</option>
                  </select>
                  <input
                    className="field-input"
                    inputMode="decimal"
                    aria-label="Discount value"
                    value={discountText}
                    onChange={(e) => setDiscountText(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="field-row">
              <div className="field-row-item">
                <label className="field-label" htmlFor="deposit-mode">
                  Deposit due
                </label>
                <div className="est-inline-pair">
                  <select
                    id="deposit-mode"
                    className="field-input"
                    value={depositMode}
                    onChange={(e) => setDepositMode(e.target.value as AmountMode)}
                  >
                    <option value="percent">%</option>
                    <option value="fixed">$</option>
                  </select>
                  <input
                    className="field-input"
                    inputMode="decimal"
                    aria-label="Deposit value"
                    value={depositText}
                    onChange={(e) => setDepositText(e.target.value)}
                  />
                </div>
                <p className="field-hint">Defaulted from your company profile.</p>
              </div>
            </div>

            <label className="field-label" htmlFor="notes-client">
              Notes to the client
            </label>
            <textarea
              id="notes-client"
              className="field-input"
              rows={3}
              value={notesToClient}
              onChange={(e) => setNotesToClient(e.target.value)}
            />

            <label className="field-label" htmlFor="terms-text">
              Terms
            </label>
            <textarea
              id="terms-text"
              className="field-input"
              rows={3}
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
            />
            <p className="field-hint">
              Your own terms text, supplied by your company and reviewed by your attorney.
              PaperTrail does not write contract language for you.
            </p>

            <label className="field-label" htmlFor="internal-notes">
              Internal notes (never shown to the client)
            </label>
            <textarea
              id="internal-notes"
              className="field-input"
              rows={2}
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
            />
          </section>
        ) : null}

        {/* ─── totals ─────────────────────────────────────────────────────── */}
        <section className="est-section">
          <h2 className="settings-section-title">Totals</h2>
          <dl className="est-totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{formatCents(totals.breakdown.subtotalCents)}</dd>
            </div>
            {totals.breakdown.discountCents > 0 ? (
              <div>
                <dt>Discount</dt>
                <dd>−{formatCents(totals.breakdown.discountCents)}</dd>
              </div>
            ) : null}
            <div>
              <dt>Taxable subtotal</dt>
              <dd>{formatCents(totals.breakdown.taxableSubtotalCents)}</dd>
            </div>
            <div>
              <dt>Tax ({formatBp(terms.taxRateBp)})</dt>
              <dd>{formatCents(totals.breakdown.taxCents)}</dd>
            </div>
            <div className="est-totals-total">
              <dt>Total</dt>
              <dd>{formatCents(totals.breakdown.totalCents)}</dd>
            </div>
            <div>
              <dt>Deposit due</dt>
              <dd>{formatCents(totals.breakdown.depositDueCents)}</dd>
            </div>
            <div>
              <dt>Balance</dt>
              <dd>{formatCents(totals.breakdown.balanceDueCents)}</dd>
            </div>
            {totals.optionalTotalCents > 0 ? (
              <div className="est-totals-optional">
                <dt>Options not selected</dt>
                <dd>+{formatCents(totals.optionalTotalCents)}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {/* ─── profitability (internal) ───────────────────────────────────── */}
        <section className="est-section est-internal">
          <h2 className="settings-section-title">Profitability — internal only</h2>
          <p className="field-hint">
            Nothing in this panel appears on any client-facing document.
          </p>
          <dl className="est-totals">
            <div>
              <dt>Estimated cost</dt>
              <dd>{formatCents(profit.estimatedCostCents)}</dd>
            </div>
            <div>
              <dt>Revenue (pre-tax)</dt>
              <dd>{formatCents(profit.revenueCents)}</dd>
            </div>
            <div className="est-totals-total">
              <dt>Margin</dt>
              <dd>
                {formatCents(profit.marginCents)} · {formatBp(profit.marginBp)}
              </dd>
            </div>
          </dl>

          <h3 className="est-subheading">Hours by phase</h3>
          {profit.hoursByPhase.length === 0 ? (
            <p className="field-hint">No hour-rated labour lines yet.</p>
          ) : (
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Hours</th>
                </tr>
              </thead>
              <tbody>
                {profit.hoursByPhase.map((phase) => (
                  <tr key={phase.label}>
                    <td>{phase.label}</td>
                    <td>{phase.hours}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td>
                    <strong>{profit.totalHours}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* ─── client preview ─────────────────────────────────────────────── */}
        <section className="est-section">
          <h2 className="settings-section-title">What the client sees</h2>
          <div className="tab-bar" role="tablist">
            <button
              role="tab"
              aria-selected={preview === 'itemized'}
              className={`tab-btn${preview === 'itemized' ? ' tab-btn--active' : ''}`}
              onClick={() => setPreview('itemized')}
            >
              Itemized
            </button>
            <button
              role="tab"
              aria-selected={preview === 'summary'}
              className={`tab-btn${preview === 'summary' ? ' tab-btn--active' : ''}`}
              onClick={() => setPreview('summary')}
            >
              Summary
            </button>
          </div>

          {readOnly ? (
            <p className="field-hint">
              This estimate was issued as <strong>{estimate.detail_level}</strong>. The other view
              is shown here for your reference only.
            </p>
          ) : null}

          {preview === 'itemized' ? (
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Qty</th>
                  <th>Unit price</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, index) => (
                  <tr key={line.key} className={isBillable(line) ? undefined : 'catalog-row-archived'}>
                    <td>
                      {line.description}
                      {line.isOptional ? <span className="est-optional-badge">Optional</span> : null}
                    </td>
                    <td>
                      {line.quantity} {UNIT_LABELS[line.unit]}
                    </td>
                    <td>{formatCents(line.unitPriceCents)}</td>
                    <td>{formatCents(totals.lineExtendedCents[index] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>Scope</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => (
                  <tr key={group.label}>
                    <td>{group.label}</td>
                    <td>
                      {formatCents(group.subtotalCents)}
                      {group.optionalCents > 0 ? (
                        <span className="est-optional-badge">
                          + {formatCents(group.optionalCents)} optional
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="field-hint">
            Same lines, two renderings. A summary estimate publishes group totals and no unit
            prices; nothing about the stored estimate changes.
          </p>
        </section>

        {/* ─── actions ────────────────────────────────────────────────────── */}
        <section className="est-section est-actions">
          {readOnly ? (
            <>
              <button type="button" className="btn-primary" onClick={revise} disabled={saving}>
                {saving ? 'Working…' : 'Create revision'}
              </button>
              <p className="field-hint">
                A revision clones this estimate to version {estimate.version + 1} as a draft. This
                version stays standing until the revision is issued.
              </p>
            </>
          ) : (
            <>
              <button type="button" className="btn-secondary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => setIssuePanelOpen(!issuePanelOpen)}
                disabled={saving || lines.length === 0}
              >
                Issue estimate
              </button>

              {issuePanelOpen ? (
                <div className="est-issue-panel">
                  <h3 className="est-subheading">Issue this estimate</h3>
                  <p className="field-hint">
                    Issuing freezes the lines and the totals permanently. Corrections after this
                    happen by revision, not by editing. Issuing needs a connection.
                  </p>

                  <fieldset className="est-fieldset">
                    <legend className="field-label">Detail the client sees</legend>
                    <label className="est-switch">
                      <input
                        type="radio"
                        name="detail-level"
                        checked={issueDetailLevel === 'itemized'}
                        onChange={() => setIssueDetailLevel('itemized')}
                      />
                      Itemized — every line, with quantities and unit prices
                    </label>
                    <label className="est-switch">
                      <input
                        type="radio"
                        name="detail-level"
                        checked={issueDetailLevel === 'summary'}
                        onChange={() => setIssueDetailLevel('summary')}
                      />
                      Summary — group totals only, no unit prices
                    </label>
                  </fieldset>

                  <button type="button" className="btn-primary" onClick={issue} disabled={saving}>
                    {saving ? 'Issuing…' : `Issue v${estimate.version} for ${formatCents(totals.breakdown.totalCents)}`}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      </main>
    </>
  )
}

// ---------------------------------------------------------------------------
// Add-line panels
// ---------------------------------------------------------------------------

function CatalogPicker({
  pricingMode,
  pricingBp,
  onAdd,
}: {
  pricingMode: PricingMode
  pricingBp: number
  onAdd: (line: EstimateLineDraft) => void
}) {
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      setLoading(true)
      const headers = await authHeaders()
      if (!headers) return
      const res = await fetch(`/api/catalog?search=${encodeURIComponent(search)}`, { headers })
      if (!cancelled && res.ok) setItems((await res.json()) as CatalogItem[])
      if (!cancelled) setLoading(false)
    }
    const timer = setTimeout(run, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [search])

  return (
    <div className="est-picker">
      <input
        className="field-input"
        placeholder="Search the price book by code or name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search the price book"
      />
      {loading ? <p className="field-hint">Searching…</p> : null}
      <ul className="est-picker-list">
        {items.slice(0, 25).map((item) => {
          // priceCatalogLine owns the item-rate-beats-estimate-rate rule, and the
          // takeoff path calls the same function.
          const price = priceCatalogLine(
            item.unit_cost_cents,
            item.default_markup_bp,
            pricingMode,
            pricingBp,
          )
          return (
            <li key={item.id}>
              <button
                type="button"
                className="est-picker-item"
                onClick={() =>
                  onAdd({
                    description: item.name,
                    quantity: 1,
                    unit: item.unit,
                    kind: item.kind,
                    unitPriceCents: price,
                    unitCostCents: item.unit_cost_cents,
                    taxable: item.taxable,
                    isOptional: false,
                    isSelected: false,
                    groupLabel: null,
                    catalogItemId: item.id,
                  })
                }
              >
                <span className="est-picker-name">
                  <code>{item.code}</code> {item.name}
                </span>
                <span className="est-picker-price">
                  {formatCents(price)} / {UNIT_LABELS[item.unit]}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function AssemblyPicker({
  pricingMode,
  pricingBp,
  onAdd,
}: {
  pricingMode: PricingMode
  pricingBp: number
  onAdd: (lines: EstimateLineDraft[]) => void
}) {
  const [assemblies, setAssemblies] = useState<Assembly[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [driverQuantity, setDriverQuantity] = useState(0)
  const [groupLabel, setGroupLabel] = useState('')
  const [optional, setOptional] = useState(false)

  useEffect(() => {
    const run = async () => {
      const headers = await authHeaders()
      if (!headers) return
      const res = await fetch('/api/assembly', { headers })
      if (res.ok) setAssemblies((await res.json()) as Assembly[])
    }
    run()
  }, [])

  const selected = assemblies.find((a) => a.id === selectedId) ?? null

  // Components without a catalog item cannot be priced; they are dropped from
  // both the takeoff and the sources so the two lists stay aligned.
  const priceable = useMemo(
    () => (selected?.assembly_component ?? []).filter((c) => c.catalog_item !== null),
    [selected],
  )

  const takeoff = useMemo(() => {
    if (!selected) return null
    const input: TakeoffAssembly = {
      name: selected.name,
      driverUnit: DRIVER_LABELS[selected.driver_unit],
      components: priceable.map((c) => ({
        name: c.catalog_item!.name,
        unit: UNIT_LABELS[c.catalog_item!.unit],
        quantityPerDriver: Number(c.quantity_per_driver),
        wastePercentBp: c.waste_percent_bp,
        roundingRule: c.rounding_rule,
        packageSize: Number(c.package_size),
        unitCostCents: c.catalog_item!.unit_cost_cents,
      })),
    }
    return computeTakeoff(input, driverQuantity)
  }, [selected, priceable, driverQuantity])

  const insert = () => {
    if (!selected || !takeoff) return
    const sources: TakeoffLineSource[] = priceable.map((c) => ({
      catalogItemId: c.catalog_item!.id,
      kind: c.catalog_item!.kind,
      unit: c.catalog_item!.unit,
      unitCostCents: c.catalog_item!.unit_cost_cents,
      taxable: c.catalog_item!.taxable,
      defaultMarkupBp: c.catalog_item!.default_markup_bp,
    }))

    onAdd(
      linesFromTakeoff(takeoff, sources, {
        assemblyId: selected.id,
        assemblyGroupId: newGroupId(),
        groupLabel: groupLabel.trim() || undefined,
        pricingMode,
        pricingBp,
        isOptional: optional,
      }),
    )
  }

  return (
    <div className="est-picker">
      <label className="field-label" htmlFor="assembly-select">
        Assembly
      </label>
      <select
        id="assembly-select"
        className="field-input"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
      >
        <option value="">Choose an assembly…</option>
        {assemblies.map((assembly) => (
          <option key={assembly.id} value={assembly.id}>
            {assembly.name}
          </option>
        ))}
      </select>

      {selected ? (
        <>
          <MeasurementInput driverUnit={selected.driver_unit} onDriverChange={setDriverQuantity} />

          <label className="field-label" htmlFor="assembly-group">
            Group heading
          </label>
          <input
            id="assembly-group"
            className="field-input"
            placeholder={selected.name}
            value={groupLabel}
            onChange={(e) => setGroupLabel(e.target.value)}
          />

          <label className="est-switch">
            <input
              type="checkbox"
              checked={optional}
              onChange={(e) => setOptional(e.target.checked)}
            />
            Add as an optional group
          </label>

          {takeoff && takeoff.components.length > 0 ? (
            <ul className="takeoff-list">
              {takeoff.components.map((component) => (
                <li key={component.name} className="takeoff-row">
                  <div className="takeoff-row-head">
                    <span className="takeoff-name">{component.name}</span>
                    <span className="takeoff-buy">
                      {component.purchaseQuantity} {component.unit}
                    </span>
                  </div>
                  <p className="takeoff-derivation">{component.derivation}</p>
                </li>
              ))}
            </ul>
          ) : null}

          <button
            type="button"
            className="btn-primary"
            onClick={insert}
            disabled={!takeoff || takeoff.components.length === 0 || driverQuantity <= 0}
          >
            Insert {priceable.length} lines
          </button>
        </>
      ) : null}
    </div>
  )
}

function FreeTextForm({ onAdd }: { onAdd: (line: EstimateLineDraft) => void }) {
  const [description, setDescription] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [unit, setUnit] = useState<EstimateLineUnit>('ea')
  const [kind, setKind] = useState<EstimateLineKind>('material')
  const [price, setPrice] = useState('0.00')
  const [cost, setCost] = useState('0.00')
  const [taxable, setTaxable] = useState(true)
  const [optional, setOptional] = useState(false)
  const [group, setGroup] = useState('')

  const submit = () => {
    const parsedQuantity = Number(quantity)
    const priceCents = tryCents(price)
    const costCents = tryCents(cost)
    if (!description.trim() || !Number.isFinite(parsedQuantity) || priceCents === null) return

    onAdd({
      description: description.trim(),
      quantity: parsedQuantity,
      unit,
      kind,
      unitPriceCents: priceCents,
      unitCostCents: costCents ?? 0,
      taxable,
      isOptional: optional,
      isSelected: false,
      groupLabel: group.trim() || null,
    })

    setDescription('')
    setQuantity('1')
    setPrice('0.00')
    setCost('0.00')
  }

  return (
    <div className="est-picker">
      <label className="field-label" htmlFor="free-desc">
        Description
      </label>
      <input
        id="free-desc"
        className="field-input"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      <div className="field-row">
        <div className="field-row-item">
          <label className="field-label" htmlFor="free-qty">
            Quantity
          </label>
          <input
            id="free-qty"
            className="field-input"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </div>
        <div className="field-row-item">
          <label className="field-label" htmlFor="free-unit">
            Unit
          </label>
          <select
            id="free-unit"
            className="field-input"
            value={unit}
            onChange={(e) => setUnit(e.target.value as EstimateLineUnit)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {UNIT_LABELS[u]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="field-row">
        <div className="field-row-item">
          <label className="field-label" htmlFor="free-price">
            Unit price
          </label>
          <input
            id="free-price"
            className="field-input"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
        <div className="field-row-item">
          <label className="field-label" htmlFor="free-cost">
            Unit cost (internal)
          </label>
          <input
            id="free-cost"
            className="field-input"
            inputMode="decimal"
            value={cost}
            onChange={(e) => setCost(e.target.value)}
          />
        </div>
      </div>

      <div className="field-row">
        <div className="field-row-item">
          <label className="field-label" htmlFor="free-kind">
            Kind
          </label>
          <select
            id="free-kind"
            className="field-input"
            value={kind}
            onChange={(e) => setKind(e.target.value as EstimateLineKind)}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row-item">
          <label className="field-label" htmlFor="free-group">
            Group heading
          </label>
          <input
            id="free-group"
            className="field-input"
            value={group}
            onChange={(e) => setGroup(e.target.value)}
          />
        </div>
      </div>

      <div className="est-line-switches">
        <label className="est-switch">
          <input
            type="checkbox"
            checked={taxable}
            onChange={(e) => setTaxable(e.target.checked)}
          />
          Taxable
        </label>
        <label className="est-switch">
          <input
            type="checkbox"
            checked={optional}
            onChange={(e) => setOptional(e.target.checked)}
          />
          Optional
        </label>
      </div>

      <button type="button" className="btn-primary" onClick={submit}>
        Add line
      </button>
    </div>
  )
}
