import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import type { Update } from '@/types/db'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid assembly id.' })
  }

  if (req.method === 'GET') return getAssembly(req, res, id)
  if (req.method === 'PATCH') return updateAssembly(req, res, id)
  if (req.method === 'DELETE') return deleteAssembly(req, res, id)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getAssembly(req: NextApiRequest, res: NextApiResponse, id: string) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const db = getServiceRoleClient()
  const { data, error } = await db
    .from('assembly')
    .select(
      `id, name, description, driver_unit, notes, active, created_at, updated_at,
       assembly_component (
         id, catalog_item_id, quantity_per_driver, waste_percent_bp,
         rounding_rule, package_size, sort_order, notes,
         catalog_item:catalog_item_id ( id, code, name, unit, unit_cost_cents, default_markup_bp, taxable )
       )`,
    )
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .single()

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Assembly not found.' })
    }
    return res.status(500).json({ error: error.message })
  }

  // Sort components by sort_order
  if (data?.assembly_component) {
    ;(data.assembly_component as Array<{ sort_order: number }>).sort(
      (a, b) => a.sort_order - b.sort_order,
    )
  }

  return res.status(200).json(data)
}

async function updateAssembly(req: NextApiRequest, res: NextApiResponse, id: string) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { name, description, driver_unit, notes, active, components } = req.body
  const db = getServiceRoleClient()

  // Verify the assembly exists and belongs to this company
  const { data: existing, error: fetchError } = await db
    .from('assembly')
    .select('id')
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .single()

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Assembly not found.' })
  }

  // Update assembly header
  const updates: Update<'assembly'> = {}
  if (name !== undefined) updates.name = name
  if (description !== undefined) updates.description = description || null
  if (driver_unit !== undefined) {
    const validDriverUnits = ['sq_ft', 'lin_ft', 'ea', 'sq', 'opening']
    if (!validDriverUnits.includes(driver_unit)) {
      return res.status(400).json({ error: `Invalid driver_unit. Must be one of: ${validDriverUnits.join(', ')}` })
    }
    updates.driver_unit = driver_unit
  }
  if (notes !== undefined) updates.notes = notes || null
  if (active !== undefined) updates.active = active

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await db
      .from('assembly')
      .update(updates)
      .eq('id', id)

    if (updateError) {
      return res.status(500).json({ error: updateError.message })
    }
  }

  // Replace components if provided (delete all, re-insert)
  if (components !== undefined) {
    if (!Array.isArray(components)) {
      return res.status(400).json({ error: 'Components must be an array.' })
    }

    // Delete existing components
    const { error: deleteError } = await db
      .from('assembly_component')
      .delete()
      .eq('assembly_id', id)

    if (deleteError) {
      return res.status(500).json({ error: deleteError.message })
    }

    // Insert new components
    if (components.length > 0) {
      const validRoundingRules = ['exact', 'up_to_unit', 'up_to_package']
      const componentRows = []

      for (let i = 0; i < components.length; i++) {
        const c = components[i]
        if (!c.catalog_item_id) {
          return res.status(400).json({ error: `Component ${i + 1}: catalog_item_id is required.` })
        }
        if (c.quantity_per_driver === undefined || c.quantity_per_driver <= 0) {
          return res.status(400).json({ error: `Component ${i + 1}: quantity_per_driver must be positive.` })
        }
        if (c.rounding_rule && !validRoundingRules.includes(c.rounding_rule)) {
          return res.status(400).json({
            error: `Component ${i + 1}: Invalid rounding_rule. Must be one of: ${validRoundingRules.join(', ')}`,
          })
        }

        componentRows.push({
          assembly_id: id,
          company_id: caller.companyId,
          catalog_item_id: c.catalog_item_id,
          quantity_per_driver: c.quantity_per_driver,
          waste_percent_bp: c.waste_percent_bp ?? 0,
          rounding_rule: c.rounding_rule || 'up_to_unit',
          package_size: c.package_size ?? 1,
          sort_order: c.sort_order ?? i,
          notes: c.notes || null,
          created_by: caller.id,
        })
      }

      const { error: insertError } = await db
        .from('assembly_component')
        .insert(componentRows)

      if (insertError) {
        return res.status(500).json({ error: insertError.message })
      }
    }
  }

  return res.status(200).json({ id })
}

async function deleteAssembly(req: NextApiRequest, res: NextApiResponse, id: string) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const db = getServiceRoleClient()

  const { data, error } = await db
    .from('assembly')
    .update({ deleted_at: new Date().toISOString(), deleted_by: caller.id })
    .eq('id', id)
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .select('id')

  if (error) return res.status(500).json({ error: error.message })
  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Assembly not found.' })
  }

  return res.status(200).json({ id, archived: true })
}
