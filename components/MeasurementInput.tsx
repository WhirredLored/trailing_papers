import { useEffect, useMemo, useRef, useState } from 'react'
import { computeNetArea, formatFeetInches, parseFeetInches } from '@/lib/dimensions'

/**
 * Measurement input - a running list of surfaces and openings that resolves to a
 * single driver quantity for a takeoff.
 *
 * Dimensions are entered as free text so a contractor can type whatever is written
 * on the tape: feet-inches or decimal feet. parseFeetInches owns the parsing; this
 * component keeps the raw text, so the field does not fight the user mid-typing,
 * and derives one canonical number from it.
 */

export type DriverUnit = 'sq_ft' | 'lin_ft' | 'ea' | 'sq' | 'opening'

type Surface = { id: string; label: string; length: string; height: string }
type Opening = { id: string; label: string; width: string; height: string; count: string }

type Props = {
  driverUnit: DriverUnit
  onDriverChange: (quantity: number) => void
}

/** Example of the accepted dimension format, e.g. twelve feet six inches. */
const DIM_PLACEHOLDER = '12\u0027 6\u0022'

/** Parse without throwing - returns null for anything unparseable or blank. */
function tryParse(input: string): number | null {
  if (!input.trim()) return null
  try {
    return parseFeetInches(input)
  } catch {
    return null
  }
}

const DRIVER_SOURCE: Record<DriverUnit, string> = {
  sq_ft: 'net area of the surfaces below',
  sq: 'net area divided by 100',
  lin_ft: 'total length of the surfaces below',
  opening: 'count of the openings below',
  ea: 'entered directly',
}

export default function MeasurementInput({ driverUnit, onDriverChange }: Props) {
  const [surfaces, setSurfaces] = useState<Surface[]>([
    { id: 's1', label: 'Wall 1', length: '', height: '' },
  ])
  const [openings, setOpenings] = useState<Opening[]>([])
  const [manualQuantity, setManualQuantity] = useState('')
  const nextId = useRef(2)

  const totals = useMemo(() => {
    const parsedSurfaces = surfaces.map((s) => ({
      length: tryParse(s.length),
      height: tryParse(s.height),
    }))
    const parsedOpenings = openings.map((o) => ({
      width: tryParse(o.width),
      height: tryParse(o.height),
      count: Math.max(0, Math.floor(Number(o.count) || 0)),
    }))

    const completeSurfaces = parsedSurfaces.filter(
      (s): s is { length: number; height: number } => s.length !== null && s.height !== null,
    )
    // computeNetArea owns the subtraction; expand each opening by its count first.
    const expandedOpenings = parsedOpenings.flatMap((o) =>
      o.width !== null && o.height !== null
        ? Array.from({ length: o.count }, () => ({
            width: o.width as number,
            height: o.height as number,
          }))
        : [],
    )

    const grossArea = completeSurfaces.reduce((sum, s) => sum + s.length * s.height, 0)
    const netArea = computeNetArea(completeSurfaces, expandedOpenings)
    const totalLength = parsedSurfaces.reduce((sum, s) => sum + (s.length ?? 0), 0)
    const openingCount = parsedOpenings.reduce((sum, o) => sum + o.count, 0)

    return { grossArea, openingArea: grossArea - netArea, netArea, totalLength, openingCount }
  }, [surfaces, openings])

  const driverQuantity = useMemo(() => {
    switch (driverUnit) {
      case 'sq_ft':
        return totals.netArea
      case 'sq':
        return totals.netArea / 100
      case 'lin_ft':
        return totals.totalLength
      case 'opening':
        return totals.openingCount
      case 'ea':
        return Math.max(0, Number(manualQuantity) || 0)
    }
  }, [driverUnit, totals, manualQuantity])

  useEffect(() => {
    onDriverChange(driverQuantity)
  }, [driverQuantity, onDriverChange])

  function updateSurface(id: string, patch: Partial<Surface>) {
    setSurfaces((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }
  function updateOpening(id: string, patch: Partial<Opening>) {
    setOpenings((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  return (
    <div className="measure-panel">
      <div className="crm-section-header">
        <h2 className="settings-section-title" style={{ margin: 0 }}>
          Measurements
        </h2>
        <span className="field-hint">{DRIVER_SOURCE[driverUnit]}</span>
      </div>

      {driverUnit === 'ea' ? (
        <div className="field-row">
          <div className="field-row-item">
            <label className="field-label" htmlFor="manual-qty">
              Quantity
            </label>
            <input
              id="manual-qty"
              className="field-input"
              inputMode="decimal"
              value={manualQuantity}
              onChange={(e) => setManualQuantity(e.target.value)}
              placeholder="e.g. 12"
            />
          </div>
        </div>
      ) : (
        <>
          <table className="measure-table">
            <thead>
              <tr>
                <th>Surface</th>
                <th>Length</th>
                <th>Height</th>
                <th className="measure-num">Area</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {surfaces.map((s) => {
                const length = tryParse(s.length)
                const height = tryParse(s.height)
                const area = length !== null && height !== null ? length * height : null
                const badLength = s.length.trim() !== '' && length === null
                const badHeight = s.height.trim() !== '' && height === null
                return (
                  <tr key={s.id}>
                    <td>
                      <input
                        className="field-input"
                        value={s.label}
                        onChange={(e) => updateSurface(s.id, { label: e.target.value })}
                        aria-label="Surface name"
                      />
                    </td>
                    <td>
                      <input
                        className={badLength ? 'field-input field-input--bad' : 'field-input'}
                        value={s.length}
                        onChange={(e) => updateSurface(s.id, { length: e.target.value })}
                        placeholder={DIM_PLACEHOLDER}
                        aria-label="Length"
                      />
                    </td>
                    <td>
                      <input
                        className={badHeight ? 'field-input field-input--bad' : 'field-input'}
                        value={s.height}
                        onChange={(e) => updateSurface(s.id, { height: e.target.value })}
                        placeholder="10"
                        aria-label="Height"
                      />
                    </td>
                    <td className="measure-num">{area !== null ? area.toFixed(2) : '--'}</td>
                    <td>
                      {surfaces.length > 1 && (
                        <button
                          type="button"
                          className="btn-danger-sm"
                          onClick={() => setSurfaces((rows) => rows.filter((r) => r.id !== s.id))}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setSurfaces((rows) => [
                ...rows,
                {
                  id: 's' + nextId.current++,
                  label: 'Wall ' + (rows.length + 1),
                  length: '',
                  height: '',
                },
              ])
            }
          >
            Add surface
          </button>

          <table className="measure-table" style={{ marginTop: '1.25rem' }}>
            <thead>
              <tr>
                <th>Opening</th>
                <th>Width</th>
                <th>Height</th>
                <th>Count</th>
                <th className="measure-num">Deducted</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {openings.map((o) => {
                const width = tryParse(o.width)
                const height = tryParse(o.height)
                const count = Math.max(0, Math.floor(Number(o.count) || 0))
                const deducted = width !== null && height !== null ? width * height * count : null
                const badWidth = o.width.trim() !== '' && width === null
                const badHeight = o.height.trim() !== '' && height === null
                return (
                  <tr key={o.id}>
                    <td>
                      <input
                        className="field-input"
                        value={o.label}
                        onChange={(e) => updateOpening(o.id, { label: e.target.value })}
                        aria-label="Opening name"
                      />
                    </td>
                    <td>
                      <input
                        className={badWidth ? 'field-input field-input--bad' : 'field-input'}
                        value={o.width}
                        onChange={(e) => updateOpening(o.id, { width: e.target.value })}
                        placeholder="3"
                        aria-label="Width"
                      />
                    </td>
                    <td>
                      <input
                        className={badHeight ? 'field-input field-input--bad' : 'field-input'}
                        value={o.height}
                        onChange={(e) => updateOpening(o.id, { height: e.target.value })}
                        placeholder="5"
                        aria-label="Height"
                      />
                    </td>
                    <td>
                      <input
                        className="field-input"
                        inputMode="numeric"
                        value={o.count}
                        onChange={(e) => updateOpening(o.id, { count: e.target.value })}
                        aria-label="Count"
                      />
                    </td>
                    <td className="measure-num">
                      {deducted !== null ? '-' + deducted.toFixed(2) : '--'}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-danger-sm"
                        onClick={() => setOpenings((rows) => rows.filter((r) => r.id !== o.id))}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
              {openings.length === 0 && (
                <tr>
                  <td colSpan={6} className="field-hint">
                    No openings deducted yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <button
            type="button"
            className="btn-secondary"
            onClick={() =>
              setOpenings((rows) => [
                ...rows,
                {
                  id: 'o' + nextId.current++,
                  label: 'Window ' + (rows.length + 1),
                  width: '',
                  height: '',
                  count: '1',
                },
              ])
            }
          >
            Add opening
          </button>

          <dl className="measure-totals">
            <div>
              <dt>Gross</dt>
              <dd>{totals.grossArea.toFixed(2)} sq ft</dd>
            </div>
            <div>
              <dt>Openings</dt>
              <dd>-{totals.openingArea.toFixed(2)} sq ft</dd>
            </div>
            <div>
              <dt>Net</dt>
              <dd>{totals.netArea.toFixed(2)} sq ft</dd>
            </div>
            <div>
              <dt>Total length</dt>
              <dd>{formatFeetInches(totals.totalLength)}</dd>
            </div>
          </dl>
        </>
      )}

      <p className="measure-driver">
        Driver: <strong>{driverQuantity.toFixed(2)}</strong> {driverUnit.replace('_', ' ')}
      </p>
    </div>
  )
}
