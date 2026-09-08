import { useCallback, useEffect, useMemo, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { getBrowserClient } from '@/lib/supabase-browser'
import { formatCents } from '@/lib/money'
import { computeTakeoff, type RoundingRule, type TakeoffAssembly } from '@/lib/takeoff'
import MeasurementInput, { type DriverUnit } from '@/components/MeasurementInput'

/**
 * Assembly detail - edit the recipe and watch the takeoff change underneath it.
 *
 * The preview calls computeTakeoff directly rather than the API. The engine is a
 * pure function, so the number on screen while editing is produced by exactly the
 * same code the server uses to validate - there is no second implementation to
 * drift. Nothing is persisted until Save.
 */

type CatalogItem = {
  id: string
  code: string
  name: string
  unit: string
  unit_cost_cents: number
}

type Component = {
  id: string
  catalog_item_id: string
  quantity_per_driver: number
  waste_percent_bp: number
  rounding_rule: RoundingRule
  package_size: number
  sort_order: number
  notes: string | null
  catalog_item: CatalogItem | null
}

type Assembly = {
  id: string
  name: string
  description: string | null
  driver_unit: DriverUnit
  notes: string | null
  active: boolean
  assembly_component: Component[]
}

const UNIT_LABELS: Record<string, string> = {
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

const ROUNDING_LABELS: Record<RoundingRule, string> = {
  exact: 'Exact (nearest whole)',
  up_to_unit: 'Up to whole unit',
  up_to_package: 'Up to package',
}

export default function AssemblyDetailPage() {
  const router = useRouter()
  const { id } = router.query

  const [assembly, setAssembly] = useState<Assembly | null>(null)
  const [components, setComponents] = useState<Component[]>([])
  const [driverQuantity, setDriverQuantity] = useState(0)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  const fetchAssembly = useCallback(async () => {
    if (typeof id !== 'string') return
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) return

    const res = await fetch(`/api/assembly/${id}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Failed to load assembly.' }))
      setError(body.error ?? 'Failed to load assembly.')
      setLoading(false)
      return
    }
    const data: Assembly = await res.json()
    setAssembly(data)
    setComponents(data.assembly_component ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    if (id) fetchAssembly()
  }, [id, fetchAssembly])

  // Live preview. Pure function, so this is the same math the server runs.
  const takeoff = useMemo(() => {
    if (!assembly) return null
    const input: TakeoffAssembly = {
      name: assembly.name,
      driverUnit: DRIVER_LABELS[assembly.driver_unit],
      components: components
        .filter((c) => c.catalog_item !== null)
        .map((c) => ({
          name: c.catalog_item!.name,
          unit: UNIT_LABELS[c.catalog_item!.unit] ?? c.catalog_item!.unit,
          quantityPerDriver: Number(c.quantity_per_driver),
          wastePercentBp: c.waste_percent_bp,
          roundingRule: c.rounding_rule,
          packageSize: Number(c.package_size),
          unitCostCents: c.catalog_item!.unit_cost_cents,
        })),
    }
    return computeTakeoff(input, driverQuantity)
  }, [assembly, components, driverQuantity])

  function updateComponent(componentId: string, patch: Partial<Component>) {
    setSavedMessage(null)
    setComponents((rows) => rows.map((r) => (r.id === componentId ? { ...r, ...patch } : r)))
  }

  async function handleSave() {
    if (typeof id !== 'string') return
    setSaving(true)
    setError(null)
    const supabase = getBrowserClient()
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (!session) {
      setSaving(false)
      return
    }

    const res = await fetch(`/api/assembly/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        components: components.map((c, index) => ({
          catalog_item_id: c.catalog_item_id,
          quantity_per_driver: Number(c.quantity_per_driver),
          waste_percent_bp: c.waste_percent_bp,
          rounding_rule: c.rounding_rule,
          package_size: Number(c.package_size),
          sort_order: index,
          notes: c.notes,
        })),
      }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: 'Save failed.' }))
      setError(body.error ?? 'Save failed.')
    } else {
      setSavedMessage('Saved.')
      await fetchAssembly()
    }
    setSaving(false)
  }

  if (loading) {
    return (
      <main className="crm-shell">
        <p className="settings-loading">Loading...</p>
      </main>
    )
  }
  if (!assembly) {
    return (
      <main className="crm-shell">
        <p className="settings-loading">{error ?? 'Assembly not found.'}</p>
      </main>
    )
  }

  return (
    <>
      <Head>
        <title>{assembly.name} - PaperTrail</title>
      </Head>

      <main className="crm-shell">
        <div className="crm-header">
          <Link href="/assemblies" className="crm-back-link">
            Back to Assemblies
          </Link>
          <h1 className="crm-title">{assembly.name}</h1>
          {assembly.description && <p className="field-hint">{assembly.description}</p>}
          <p className="field-hint">
            Driven by <strong>{DRIVER_LABELS[assembly.driver_unit]}</strong>
          </p>
        </div>

        {error && <p className="auth-error">{error}</p>}

        <div className="settings-grid">
          <div className="settings-form-col">
            <div className="settings-section">
              <MeasurementInput
                driverUnit={assembly.driver_unit}
                onDriverChange={setDriverQuantity}
              />
            </div>

            <div className="settings-section">
              <div className="crm-section-header">
                <h2 className="settings-section-title" style={{ margin: 0 }}>
                  Recipe
                </h2>
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {savedMessage && <span className="save-msg">{savedMessage}</span>}
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'Saving...' : 'Save recipe'}
                  </button>
                </div>
              </div>
              <p className="field-hint">
                Change a waste factor or rounding rule and the takeoff on the right updates
                immediately. Nothing is stored until you save.
              </p>

              <table className="measure-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Per driver</th>
                    <th>Waste %</th>
                    <th>Rounding</th>
                    <th>Package</th>
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="crm-list-title">
                          {c.catalog_item?.name ?? 'Unknown item'}
                        </div>
                        <div className="crm-list-subtitle">
                          {c.catalog_item?.code} -{' '}
                          {formatCents(c.catalog_item?.unit_cost_cents ?? 0)} per{' '}
                          {UNIT_LABELS[c.catalog_item?.unit ?? ''] ?? c.catalog_item?.unit}
                        </div>
                      </td>
                      <td>
                        <input
                          className="field-input"
                          inputMode="decimal"
                          value={c.quantity_per_driver}
                          onChange={(e) =>
                            updateComponent(c.id, {
                              quantity_per_driver: Number(e.target.value) || 0,
                            })
                          }
                          aria-label="Quantity per driver"
                        />
                      </td>
                      <td>
                        <input
                          className="field-input"
                          inputMode="decimal"
                          value={c.waste_percent_bp / 100}
                          onChange={(e) =>
                            updateComponent(c.id, {
                              waste_percent_bp: Math.round((Number(e.target.value) || 0) * 100),
                            })
                          }
                          aria-label="Waste percent"
                        />
                      </td>
                      <td>
                        <select
                          className="field-input"
                          value={c.rounding_rule}
                          onChange={(e) =>
                            updateComponent(c.id, {
                              rounding_rule: e.target.value as RoundingRule,
                            })
                          }
                          aria-label="Rounding rule"
                        >
                          {Object.entries(ROUNDING_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          className="field-input"
                          inputMode="decimal"
                          value={c.package_size}
                          disabled={c.rounding_rule !== 'up_to_package'}
                          onChange={(e) =>
                            updateComponent(c.id, { package_size: Number(e.target.value) || 1 })
                          }
                          aria-label="Package size"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="settings-preview-col">
            <div className="settings-section">
              <h2 className="settings-section-title">Takeoff preview</h2>
              <p className="field-hint">
                {driverQuantity.toFixed(2)} {DRIVER_LABELS[assembly.driver_unit]} through this
                recipe.
              </p>

              {takeoff && takeoff.components.length > 0 ? (
                <>
                  <ul className="takeoff-list">
                    {takeoff.components.map((c, index) => (
                      <li key={index} className="takeoff-row">
                        <div className="takeoff-row-head">
                          <span className="takeoff-name">{c.name}</span>
                          <span className="takeoff-cost">{formatCents(c.extendedCostCents)}</span>
                        </div>
                        <div className="takeoff-buy">
                          Buy {c.purchaseQuantity} {c.unit}
                        </div>
                        <div className="takeoff-derivation">{c.derivation}</div>
                      </li>
                    ))}
                  </ul>
                  <div className="takeoff-total">
                    <span>Material and labor total</span>
                    <strong>{formatCents(takeoff.totalCostCents)}</strong>
                  </div>
                  <p className="field-hint">
                    Every line shows how it was derived. That derivation is what makes the number
                    defensible to a client and debuggable by you.
                  </p>
                </>
              ) : (
                <p className="field-hint">
                  This assembly has no components yet, so there is nothing to compute.
                </p>
              )}
            </div>
          </div>
        </div>
      </main>
    </>
  )
}
