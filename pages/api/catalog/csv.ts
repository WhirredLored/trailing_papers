import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import type { Enums, Insert } from '@/types/db'

/**
 * CSV Import/Export for Catalog Items
 *
 * GET  /api/catalog/csv — export active catalog items as CSV
 * POST /api/catalog/csv — import CSV (idempotent on `code`), with dry-run support
 *
 * CSV Column Spec:
 *   code,name,description,kind,unit,unit_cost_cents,default_markup_bp,taxable,notes
 *
 * - `code` is the idempotent key: existing items with matching code are updated,
 *   new codes are created.
 * - `kind` must be one of: labor, material, equipment, subcontract, other
 * - `unit` must be one of: ea, sq_ft, lin_ft, sq, hour, day, load
 * - `taxable` accepts: true, false, 1, 0, yes, no
 * - `unit_cost_cents` and `default_markup_bp` are integers
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return exportCsv(req, res)
  if (req.method === 'POST') return importCsv(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

// ─── Constants ───────────────────────────────────────────────────────────────
const CSV_HEADERS = [
  'code',
  'name',
  'description',
  'kind',
  'unit',
  'unit_cost_cents',
  'default_markup_bp',
  'taxable',
  'notes',
]

const VALID_KINDS = new Set(['labor', 'material', 'equipment', 'subcontract', 'other'])
const VALID_UNITS = new Set(['ea', 'sq_ft', 'lin_ft', 'sq', 'hour', 'day', 'load'])

// ─── Export ──────────────────────────────────────────────────────────────────
async function exportCsv(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { data, error } = await getServiceRoleClient()
    .from('catalog_item')
    .select(
      'code, name, description, kind, unit, unit_cost_cents, default_markup_bp, taxable, notes',
    )
    .eq('company_id', caller.companyId)
    .eq('active', true)
    .is('deleted_at', null)
    .order('code', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })

  const rows = (data || []).map((item) =>
    CSV_HEADERS.map((h) => {
      const val = item[h as keyof typeof item]
      if (val === null || val === undefined) return ''
      const str = String(val)
      // Escape quotes and wrap in quotes if contains comma/newline/quote
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }).join(','),
  )

  const csv = [CSV_HEADERS.join(','), ...rows].join('\n')

  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', 'attachment; filename="catalog_export.csv"')
  return res.status(200).send(csv)
}

// ─── Import ──────────────────────────────────────────────────────────────────
async function importCsv(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const { csv, dryRun } = req.body

  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'CSV string is required in body.csv' })
  }

  // Parse CSV
  const lines = csv.split(/\r?\n/).filter((l: string) => l.trim() !== '')
  if (lines.length < 2) {
    return res.status(400).json({ error: 'CSV must have a header row and at least one data row.' })
  }

  const headerLine = lines[0]!
  const headers = parseCsvLine(headerLine).map((h: string) => h.trim().toLowerCase())

  // Validate required headers
  const codeIdx = headers.indexOf('code')
  const nameIdx = headers.indexOf('name')
  if (codeIdx === -1 || nameIdx === -1) {
    return res.status(400).json({ error: 'CSV must have at least "code" and "name" columns.' })
  }

  // Fetch existing items by code for idempotent upsert
  const client = getServiceRoleClient()
  const { data: existing } = await client
    .from('catalog_item')
    .select('id, code')
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)

  const existingByCode = new Map((existing || []).map((e) => [e.code, e.id]))

  // Process rows
  type RowResult = {
    row: number
    code: string
    action: 'create' | 'update'
    errors: string[]
    // company_id and created_by are supplied at insert time, not parsed from the CSV.
    data: Omit<Insert<'catalog_item'>, 'company_id' | 'created_by'>
  }

  const results: RowResult[] = []

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]!)
    const rowErrors: string[] = []
    const row: Record<string, string> = {}

    headers.forEach((h: string, idx: number) => {
      row[h] = (values[idx] || '').trim()
    })

    const code = row['code'] || ''
    const name = row['name'] || ''

    if (!code) {
      rowErrors.push('code is required')
    }
    if (!name) {
      rowErrors.push('name is required')
    }

    // Validate kind
    const kind = row['kind'] || 'material'
    if (!VALID_KINDS.has(kind)) {
      rowErrors.push(`Invalid kind "${kind}". Must be one of: ${[...VALID_KINDS].join(', ')}`)
    }

    // Validate unit
    const unit = row['unit'] || 'ea'
    if (!VALID_UNITS.has(unit)) {
      rowErrors.push(`Invalid unit "${unit}". Must be one of: ${[...VALID_UNITS].join(', ')}`)
    }

    // Parse integers
    const unitCostCents = row['unit_cost_cents'] ? parseInt(row['unit_cost_cents'], 10) : 0
    if (isNaN(unitCostCents) || unitCostCents < 0) {
      rowErrors.push('unit_cost_cents must be a non-negative integer')
    }

    const defaultMarkupBp = row['default_markup_bp'] ? parseInt(row['default_markup_bp'], 10) : 0
    if (isNaN(defaultMarkupBp) || defaultMarkupBp < 0) {
      rowErrors.push('default_markup_bp must be a non-negative integer')
    }

    // Parse boolean
    const taxable = parseBool(row['taxable'] || 'true')

    const action = existingByCode.has(code) ? 'update' : 'create'

    results.push({
      row: i + 1,
      code,
      action,
      errors: rowErrors,
      data: {
        code,
        name,
        description: row['description'] || null,
        // Validated against VALID_KINDS/VALID_UNITS above; rows with errors never
        // reach the insert because hasErrors short-circuits first.
        kind: kind as Enums<'catalog_item_kind'>,
        unit: unit as Enums<'catalog_item_unit'>,
        unit_cost_cents: unitCostCents,
        default_markup_bp: defaultMarkupBp,
        taxable,
        notes: row['notes'] || null,
      },
    })
  }

  // Check for any row errors
  const hasErrors = results.some((r) => r.errors.length > 0)

  if (dryRun || hasErrors) {
    return res.status(200).json({
      dryRun: true,
      totalRows: results.length,
      creates: results.filter((r) => r.action === 'create').length,
      updates: results.filter((r) => r.action === 'update').length,
      errors: results.filter((r) => r.errors.length > 0),
      rows: results,
    })
  }

  // Execute import
  let created = 0
  let updated = 0
  const importErrors: Array<{ row: number; code: string; error: string }> = []

  for (const r of results) {
    if (r.action === 'create') {
      const { error: insertError } = await client.from('catalog_item').insert({
        company_id: caller.companyId,
        created_by: caller.id,
        ...r.data,
      })

      if (insertError) {
        importErrors.push({ row: r.row, code: r.code, error: insertError.message })
      } else {
        created++
      }
    } else {
      const existingId = existingByCode.get(r.code)
      if (!existingId) {
        importErrors.push({ row: r.row, code: r.code, error: 'Existing row not found.' })
        continue
      }
      const { error: updateError } = await client
        .from('catalog_item')
        .update(r.data)
        .eq('id', existingId)
        .eq('company_id', caller.companyId)

      if (updateError) {
        importErrors.push({ row: r.row, code: r.code, error: updateError.message })
      } else {
        updated++
      }
    }
  }

  return res.status(200).json({
    dryRun: false,
    created,
    updated,
    errors: importErrors.length > 0 ? importErrors : undefined,
  })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Simple CSV line parser that handles quoted fields with commas and escaped quotes. */
function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        result.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }

  result.push(current)
  return result
}

function parseBool(val: string): boolean {
  const lower = val.toLowerCase().trim()
  return lower === 'true' || lower === '1' || lower === 'yes'
}
