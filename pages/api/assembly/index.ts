import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') return getAssemblies(req, res)
  if (req.method === 'POST') return createAssembly(req, res)
  return res.status(405).json({ error: 'Method not allowed.' })
}

async function getAssemblies(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { search, active } = req.query
  const db = getServiceRoleClient()

  let query = db
    .from('assembly')
    .select(
      `id, name, description, driver_unit, notes, active, created_at, updated_at,
       assembly_component (
         id, catalog_item_id, quantity_per_driver, waste_percent_bp,
         rounding_rule, package_size, sort_order, notes,
         catalog_item:catalog_item_id ( id, code, name, kind, unit, unit_cost_cents, default_markup_bp, taxable )
       )`,
    )
    .eq('company_id', caller.companyId)
    .is('deleted_at', null)
    .order('name', { ascending: true })

  if (search && typeof search === 'string') {
    query = query.ilike('name', `%${search}%`)
  }

  // Default to active-only unless explicitly requesting all or inactive
  if (active === 'false') {
    query = query.eq('active', false)
  } else if (active !== 'all') {
    query = query.eq('active', true)
  }

  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })

  // Sort components by sort_order within each assembly
  if (data) {
    for (const assembly of data) {
      if (assembly.assembly_component) {
        ;(assembly.assembly_component as Array<{ sort_order: number }>).sort(
          (a, b) => a.sort_order - b.sort_order,
        )
      }
    }
  }

  return res.status(200).json(data)
}

async function createAssembly(req: NextApiRequest, res: NextApiResponse) {
  const caller = await requireUser(req, res)
  if (!caller) return

  const { name, description, driver_unit, notes, components } = req.body

  if (!name || typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required.' })
  }

  const validDriverUnits = ['sq_ft', 'lin_ft', 'ea', 'sq', 'opening']
  if (driver_unit && !validDriverUnits.includes(driver_unit)) {
    return res.status(400).json({ error: `Invalid driver_unit. Must be one of: ${validDriverUnits.join(', ')}` })
  }

  if (components && !Array.isArray(components)) {
    return res.status(400).json({ error: 'Components must be an array.' })
  }

  const db = getServiceRoleClient()

  // Create the assembly
  const { data: assembly, error: assemblyError } = await db
    .from('assembly')
    .insert({
      company_id: caller.companyId,
      name: name.trim(),
      description: description || null,
      driver_unit: driver_unit || 'sq_ft',
      notes: notes || null,
      created_by: caller.id,
    })
    .select('id')
    .single()

  if (assemblyError) {
    return res.status(500).json({ error: assemblyError.message })
  }

  // Insert components if provided
  if (components && components.length > 0) {
    const validRoundingRules = ['exact', 'up_to_unit', 'up_to_package']
    const componentRows = []

    for (let i = 0; i < components.length; i++) {
      const c = components[i]
      if (!c.catalog_item_id) {
        // Clean up the assembly we just created
        await db.from('assembly').delete().eq('id', assembly.id)
        return res.status(400).json({ error: `Component ${i + 1}: catalog_item_id is required.` })
      }

      if (c.quantity_per_driver === undefined || c.quantity_per_driver <= 0) {
        await db.from('assembly').delete().eq('id', assembly.id)
        return res.status(400).json({ error: `Component ${i + 1}: quantity_per_driver must be positive.` })
      }

      if (c.rounding_rule && !validRoundingRules.includes(c.rounding_rule)) {
        await db.from('assembly').delete().eq('id', assembly.id)
        return res.status(400).json({
          error: `Component ${i + 1}: Invalid rounding_rule. Must be one of: ${validRoundingRules.join(', ')}`,
        })
      }

      componentRows.push({
        assembly_id: assembly.id,
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

    const { error: componentsError } = await db
      .from('assembly_component')
      .insert(componentRows)

    if (componentsError) {
      // Clean up the assembly
      await db.from('assembly').delete().eq('id', assembly.id)
      return res.status(500).json({ error: componentsError.message })
    }
  }

  return res.status(201).json(assembly)
}
