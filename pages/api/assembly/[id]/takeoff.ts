import type { NextApiRequest, NextApiResponse } from 'next'
import { getServiceRoleClient } from '@/lib/supabase-server'
import { requireUser } from '@/lib/auth-server'
import { computeTakeoff, type TakeoffAssembly, type TakeoffComponent } from '@/lib/takeoff'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed.' })
  }

  const caller = await requireUser(req, res)
  if (!caller) return

  const { id } = req.query
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Invalid assembly id.' })
  }

  const { driverQuantity } = req.body
  if (typeof driverQuantity !== 'number' || !Number.isFinite(driverQuantity) || driverQuantity < 0) {
    return res.status(400).json({ error: 'driverQuantity must be a non-negative finite number.' })
  }

  const db = getServiceRoleClient()

  // Fetch the assembly with its components and their catalog items
  const { data: assembly, error } = await db
    .from('assembly')
    .select(
      `id, name, driver_unit,
       assembly_component (
         quantity_per_driver, waste_percent_bp, rounding_rule, package_size, sort_order,
         catalog_item:catalog_item_id ( name, unit, unit_cost_cents )
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

  // Map driver_unit enum values to display labels
  const DRIVER_UNIT_LABELS: Record<string, string> = {
    sq_ft: 'sq ft',
    lin_ft: 'lin ft',
    ea: 'ea',
    sq: 'sq',
    opening: 'opening',
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

  // Sort components by sort_order
  const components = (assembly.assembly_component as Array<{
    quantity_per_driver: number
    waste_percent_bp: number
    rounding_rule: string
    package_size: number
    sort_order: number
    catalog_item: { name: string; unit: string; unit_cost_cents: number }
  }>).sort((a, b) => a.sort_order - b.sort_order)

  // Build the TakeoffAssembly input for the pure function
  const takeoffAssembly: TakeoffAssembly = {
    name: assembly.name,
    driverUnit: DRIVER_UNIT_LABELS[assembly.driver_unit] || assembly.driver_unit,
    components: components.map((c): TakeoffComponent => ({
      name: c.catalog_item.name,
      unit: UNIT_LABELS[c.catalog_item.unit] || c.catalog_item.unit,
      quantityPerDriver: Number(c.quantity_per_driver),
      wastePercentBp: c.waste_percent_bp,
      roundingRule: c.rounding_rule as 'exact' | 'up_to_unit' | 'up_to_package',
      packageSize: Number(c.package_size),
      unitCostCents: c.catalog_item.unit_cost_cents,
    })),
  }

  // Compute the takeoff using the pure function
  const result = computeTakeoff(takeoffAssembly, driverQuantity)

  return res.status(200).json(result)
}
