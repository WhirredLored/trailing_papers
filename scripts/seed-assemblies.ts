/**
 * SEED SCRIPT - Sample assemblies for exterior residential work
 *
 * THIS IS SAMPLE DATA. Every quantity, waste factor and package size below is a
 * plausible starting point, not an authority. A contractor must review and adjust
 * them against their own crews and suppliers before quoting real work.
 *
 * Covers the exterior phases this product targets: demo, water barrier, backerboard,
 * J-channel, siding and trim.
 *
 * Usage:
 *   npx tsx scripts/seed-assemblies.ts <company-uuid>
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY, and the catalog seed to have
 * been run first (npx tsx scripts/seed-catalog.ts <company-uuid>) - assemblies
 * reference catalog items by code.
 *
 * NOTE ON PRECISION: assembly_component.quantity_per_driver is numeric(12,4), so
 * rates are expressed to four decimal places. Where a real rate is finer than that
 * (a house-wrap roll covers about 1,350 sq ft, i.e. 0.00074 rolls per sq ft), the
 * rate is rounded at 4dp and the true coverage is stated in the component note.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/supabase'
import { EXTRA_CATALOG_ITEMS, SAMPLE_ASSEMBLIES } from '../lib/sample-assemblies'

for (const file of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(process.cwd(), file), 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx === -1) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (key && !(key in process.env)) process.env[key] = val
    }
  } catch {
    // File does not exist - fine.
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const companyId = process.argv[2]
if (!companyId) {
  console.error('Usage: npx tsx scripts/seed-assemblies.ts <company-uuid>')
  process.exit(1)
}

const supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const company = companyId as string

  // 1. Make sure the extra catalog items exist.
  for (const item of EXTRA_CATALOG_ITEMS) {
    const { data: found } = await supabase
      .from('catalog_item')
      .select('id')
      .eq('company_id', company)
      .eq('code', item.code)
      .is('deleted_at', null)
      .maybeSingle()

    if (found) {
      console.log(`  catalog ${item.code} already present`)
      continue
    }
    const { error } = await supabase.from('catalog_item').insert({ ...item, company_id: company })
    if (error) {
      console.error(`  failed to create catalog item ${item.code}: ${error.message}`)
      process.exit(1)
    }
    console.log(`  created catalog item ${item.code}`)
  }

  // 2. Resolve every referenced code to an id in one query.
  const codes = [...new Set(SAMPLE_ASSEMBLIES.flatMap((a) => a.components.map((c) => c.code)))]
  const { data: items, error: itemsError } = await supabase
    .from('catalog_item')
    .select('id, code')
    .eq('company_id', company)
    .in('code', codes)
    .is('deleted_at', null)

  if (itemsError) {
    console.error(`Failed to read catalog: ${itemsError.message}`)
    process.exit(1)
  }

  const idByCode = new Map((items ?? []).map((i) => [i.code, i.id]))
  const missing = codes.filter((c) => !idByCode.has(c))
  if (missing.length > 0) {
    console.error(`Missing catalog items: ${missing.join(', ')}`)
    console.error('Run npx tsx scripts/seed-catalog.ts <company-uuid> first.')
    process.exit(1)
  }

  // 3. Create each assembly with its components.
  let created = 0
  let skipped = 0

  for (const spec of SAMPLE_ASSEMBLIES) {
    const { data: existing } = await supabase
      .from('assembly')
      .select('id')
      .eq('company_id', company)
      .eq('name', spec.name)
      .is('deleted_at', null)
      .maybeSingle()

    if (existing) {
      console.log(`  skipped (exists): ${spec.name}`)
      skipped++
      continue
    }

    const { data: assembly, error: assemblyError } = await supabase
      .from('assembly')
      .insert({
        company_id: company,
        name: spec.name,
        description: spec.description,
        driver_unit: spec.driverUnit,
        notes: spec.notes,
      })
      .select('id')
      .single()

    if (assemblyError || !assembly) {
      console.error(`  failed: ${spec.name} - ${assemblyError?.message}`)
      process.exit(1)
    }

    const rows = spec.components.map((c, index) => {
      const catalogItemId = idByCode.get(c.code)
      if (!catalogItemId) throw new Error(`Unresolved catalog code ${c.code}`)
      return {
        assembly_id: assembly.id,
        company_id: company,
        catalog_item_id: catalogItemId,
        quantity_per_driver: c.quantityPerDriver,
        waste_percent_bp: c.wastePercentBp,
        rounding_rule: c.roundingRule,
        package_size: c.packageSize ?? 1,
        sort_order: index,
        notes: c.notes ?? null,
      }
    })

    const { error: componentsError } = await supabase.from('assembly_component').insert(rows)
    if (componentsError) {
      // Leave no half-built assembly behind.
      await supabase.from('assembly').delete().eq('id', assembly.id)
      console.error(`  failed components for ${spec.name} - ${componentsError.message}`)
      process.exit(1)
    }

    console.log(`  created: ${spec.name} (${rows.length} components)`)
    created++
  }

  console.log(`\nDone. ${created} created, ${skipped} skipped.`)
  console.log('All seeded assemblies are SAMPLE DATA - review before quoting real work.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
