import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { applyMarkup, type Cents } from '@/lib/money'

/**
 * POST /api/catalog/bulk-reprice
 *
 * Bulk-update unit_cost_cents across a filtered set of catalog items.
 * Contractors reprice seasonally; this must be one action, not N edits.
 *
 * Body:
 *   adjustmentBp: number  — basis points to adjust (+500 = +5%, -300 = -3%)
 *   filter: {
 *     kind?: string        — filter by item kind
 *     search?: string      — filter by code/name search
 *     ids?: string[]       — or explicit list of item IDs
 *   }
 *   dryRun?: boolean       — if true, return preview without saving
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res, ['owner', 'admin'])
  if (!caller) return

  const { adjustmentBp, filter, dryRun } = req.body

  if (!Number.isInteger(adjustmentBp)) {
    return res.status(400).json({ error: 'adjustmentBp must be an integer (basis points).' })
  }

  const client = getServiceRoleClient()

  // Build filter query to find matching items
  let query = client
    .from('catalog_item')
    .select('id, code, name, unit_cost_cents')
    .eq('company_id', caller.companyId)
    .eq('active', true)
    .is('deleted_at', null)

  if (filter?.kind) {
    query = query.eq('kind', filter.kind)
  }
  if (filter?.search) {
    query = query.or(
      `code.ilike.%${filter.search}%,name.ilike.%${filter.search}%`,
    )
  }
  if (Array.isArray(filter?.ids) && filter.ids.length > 0) {
    query = query.in('id', filter.ids)
  }

  const { data: items, error: fetchError } = await query
  if (fetchError) return res.status(500).json({ error: fetchError.message })
  if (!items || items.length === 0) {
    return res.status(200).json({ updated: 0, items: [] })
  }

  // Compute new prices
  const previews = items.map((item) => {
    const oldPrice = item.unit_cost_cents as Cents
    // adjustmentBp is applied as a markup: newPrice = oldPrice × (1 + adjustmentBp/10000)
    const newPrice = Math.max(0, applyMarkup(oldPrice, adjustmentBp))
    return {
      id: item.id as string,
      code: item.code as string,
      name: item.name as string,
      oldPriceCents: oldPrice,
      newPriceCents: newPrice,
    }
  })

  if (dryRun) {
    return res.status(200).json({ dryRun: true, updated: previews.length, items: previews })
  }

  // Apply updates — each item gets its own update so the price history trigger fires per-row
  let successCount = 0
  const errors: Array<{ id: string; code: string; error: string }> = []

  for (const preview of previews) {
    const { error: updateError } = await client
      .from('catalog_item')
      .update({ unit_cost_cents: preview.newPriceCents })
      .eq('id', preview.id)
      .eq('company_id', caller.companyId)

    if (updateError) {
      errors.push({ id: preview.id, code: preview.code, error: updateError.message })
    } else {
      successCount++
    }
  }

  return res.status(200).json({
    updated: successCount,
    errors: errors.length > 0 ? errors : undefined,
    items: previews,
  })
}
