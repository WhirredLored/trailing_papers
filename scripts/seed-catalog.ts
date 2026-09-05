/**
 * SEED SCRIPT — Starter Catalog for Exterior Residential Work
 *
 * THIS IS SAMPLE DATA. The contractor is expected to replace these items with
 * their own pricing. Do not ship as a hidden default — this script must be
 * run explicitly by the user.
 *
 * Usage:
 *   npx tsx scripts/seed-catalog.ts
 *
 * Requires .env.local with SUPABASE_SERVICE_ROLE_KEY set, and a user to already
 * exist in the system (the seed items will be created with no created_by).
 *
 * The script requires a company_id argument:
 *   npx tsx scripts/seed-catalog.ts <company-uuid>
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// Load env
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
    // File doesn't exist — fine
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.')
  process.exit(1)
}

const companyId = process.argv[2]
if (!companyId) {
  console.error('❌ Usage: npx tsx scripts/seed-catalog.ts <company-uuid>')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ── Seed data ────────────────────────────────────────────────────────────────
// Prices are in cents. These are SAMPLE PRICES from typical 2024-2025 supplier
// catalogs for the Northeast US. Actual prices vary by region and supplier.

interface SeedItem {
  code: string
  name: string
  kind: 'labor' | 'material' | 'equipment' | 'subcontract' | 'other'
  unit: 'ea' | 'sq_ft' | 'lin_ft' | 'sq' | 'hour' | 'day' | 'load'
  unit_cost_cents: number
  default_markup_bp: number
  taxable: boolean
  description?: string
}

const SEED_ITEMS: SeedItem[] = [
  // ── Siding ───────────────────────────────────────────────────────────────
  { code: 'SID-D45', name: 'Vinyl siding D4.5" clapboard', kind: 'material', unit: 'sq', unit_cost_cents: 8999, default_markup_bp: 2500, taxable: true, description: 'Per square (100 sq ft), double 4.5" exposure' },
  { code: 'SID-D50', name: 'Vinyl siding D5" clapboard', kind: 'material', unit: 'sq', unit_cost_cents: 9450, default_markup_bp: 2500, taxable: true, description: 'Per square (100 sq ft), double 5" exposure' },
  { code: 'SID-BOARD', name: 'Board & batten vinyl panel', kind: 'material', unit: 'sq', unit_cost_cents: 12500, default_markup_bp: 2500, taxable: true },
  { code: 'SID-SHAKE', name: 'Vinyl shake panel', kind: 'material', unit: 'sq', unit_cost_cents: 14000, default_markup_bp: 2500, taxable: true },

  // ── Trim & Accessories ───────────────────────────────────────────────────
  { code: 'TRIM-JCHAN', name: 'J-channel', kind: 'material', unit: 'lin_ft', unit_cost_cents: 89, default_markup_bp: 3000, taxable: true },
  { code: 'TRIM-START', name: 'Starter strip', kind: 'material', unit: 'lin_ft', unit_cost_cents: 125, default_markup_bp: 3000, taxable: true },
  { code: 'TRIM-UTIL', name: 'Utility trim / undersill', kind: 'material', unit: 'lin_ft', unit_cost_cents: 115, default_markup_bp: 3000, taxable: true },
  { code: 'TRIM-OCNR', name: 'Outside corner post', kind: 'material', unit: 'ea', unit_cost_cents: 675, default_markup_bp: 3000, taxable: true },
  { code: 'TRIM-ICNR', name: 'Inside corner post', kind: 'material', unit: 'ea', unit_cost_cents: 550, default_markup_bp: 3000, taxable: true },
  { code: 'TRIM-WCASE', name: 'Window casing / lineal', kind: 'material', unit: 'ea', unit_cost_cents: 1200, default_markup_bp: 3000, taxable: true },
  { code: 'TRIM-DCASE', name: 'Door casing', kind: 'material', unit: 'ea', unit_cost_cents: 1850, default_markup_bp: 3000, taxable: true },

  // ── Soffit & Fascia ──────────────────────────────────────────────────────
  { code: 'SOF-PANEL', name: 'Vinyl soffit panel', kind: 'material', unit: 'sq_ft', unit_cost_cents: 325, default_markup_bp: 2500, taxable: true },
  { code: 'SOF-VENT', name: 'Vented soffit panel', kind: 'material', unit: 'sq_ft', unit_cost_cents: 375, default_markup_bp: 2500, taxable: true },
  { code: 'FAS-ALU', name: 'Aluminum fascia coil stock', kind: 'material', unit: 'lin_ft', unit_cost_cents: 275, default_markup_bp: 2500, taxable: true },
  { code: 'FAS-DRIP', name: 'Drip edge / F-channel', kind: 'material', unit: 'lin_ft', unit_cost_cents: 150, default_markup_bp: 2500, taxable: true },

  // ── House Wrap & Flashing ────────────────────────────────────────────────
  { code: 'WRP-TYVEK', name: 'House wrap (Tyvek or equiv)', kind: 'material', unit: 'ea', unit_cost_cents: 4800, default_markup_bp: 2000, taxable: true, description: 'Per roll, 9\' × 150\'' },
  { code: 'WRP-TAPE', name: 'Housewrap seam tape', kind: 'material', unit: 'ea', unit_cost_cents: 850, default_markup_bp: 2000, taxable: true, description: 'Per roll' },
  { code: 'FLH-WIN', name: 'Window flashing membrane', kind: 'material', unit: 'ea', unit_cost_cents: 325, default_markup_bp: 2000, taxable: true, description: 'Per window kit' },
  { code: 'FLH-STEP', name: 'Step flashing, aluminum', kind: 'material', unit: 'ea', unit_cost_cents: 89, default_markup_bp: 2000, taxable: true, description: 'Per piece' },

  // ── Fasteners ────────────────────────────────────────────────────────────
  { code: 'FST-NAIL15', name: 'Galvanized ring-shank nails 1.5"', kind: 'material', unit: 'ea', unit_cost_cents: 4500, default_markup_bp: 2000, taxable: true, description: 'Per box (5 lb)' },
  { code: 'FST-NAIL25', name: 'Galvanized ring-shank nails 2.5"', kind: 'material', unit: 'ea', unit_cost_cents: 4800, default_markup_bp: 2000, taxable: true, description: 'Per box (5 lb)' },
  { code: 'FST-SCREW', name: 'Trim-head exterior screws', kind: 'material', unit: 'ea', unit_cost_cents: 3500, default_markup_bp: 2000, taxable: true, description: 'Per box (1 lb)' },
  { code: 'FST-CAULK', name: 'Polyurethane caulk', kind: 'material', unit: 'ea', unit_cost_cents: 650, default_markup_bp: 2000, taxable: true, description: 'Per tube' },

  // ── Labor ────────────────────────────────────────────────────────────────
  { code: 'LAB-LEAD', name: 'Lead installer', kind: 'labor', unit: 'hour', unit_cost_cents: 6500, default_markup_bp: 0, taxable: false, description: 'Journeyman siding installer' },
  { code: 'LAB-HELP', name: 'Helper / laborer', kind: 'labor', unit: 'hour', unit_cost_cents: 3500, default_markup_bp: 0, taxable: false },
  { code: 'LAB-DEMO', name: 'Demo crew', kind: 'labor', unit: 'hour', unit_cost_cents: 4500, default_markup_bp: 0, taxable: false, description: 'Removal of existing siding' },
  { code: 'LAB-CLEAN', name: 'Cleanup crew', kind: 'labor', unit: 'hour', unit_cost_cents: 3000, default_markup_bp: 0, taxable: false },
  { code: 'LAB-PERMIT', name: 'Permit runner', kind: 'labor', unit: 'hour', unit_cost_cents: 2500, default_markup_bp: 0, taxable: false },

  // ── Equipment & Other ────────────────────────────────────────────────────
  { code: 'EQP-SCAFF', name: 'Scaffold rental', kind: 'equipment', unit: 'day', unit_cost_cents: 7500, default_markup_bp: 1500, taxable: false },
  { code: 'EQP-TOOL', name: 'Power tool rental (brake, cutter)', kind: 'equipment', unit: 'day', unit_cost_cents: 8500, default_markup_bp: 1500, taxable: false },
  { code: 'OTH-DELIV', name: 'Material delivery fee', kind: 'other', unit: 'ea', unit_cost_cents: 15000, default_markup_bp: 0, taxable: false },
  { code: 'OTH-DUMP', name: 'Dumpster rental (20 yd)', kind: 'other', unit: 'ea', unit_cost_cents: 45000, default_markup_bp: 1000, taxable: true },
  { code: 'OTH-WASTE', name: 'Waste disposal fee', kind: 'other', unit: 'load', unit_cost_cents: 20000, default_markup_bp: 1000, taxable: false },
  { code: 'OTH-PAINT', name: 'Touch-up exterior paint', kind: 'material', unit: 'ea', unit_cost_cents: 3200, default_markup_bp: 2000, taxable: true, description: 'Per gallon' },
]

async function seed() {
  console.log(`\n🌱 Seeding ${SEED_ITEMS.length} starter catalog items for company ${companyId}...\n`)
  console.log('⚠️  These are SAMPLE prices for exterior residential work.')
  console.log('   The contractor should replace them with their own pricing.\n')

  let created = 0
  let skipped = 0
  let errors = 0

  for (const item of SEED_ITEMS) {
    // Check if code already exists (idempotent)
    const { data: existing } = await supabase
      .from('catalog_item')
      .select('id')
      .eq('company_id', companyId)
      .eq('code', item.code)
      .is('deleted_at', null)
      .limit(1)

    if (existing && existing.length > 0) {
      console.log(`  ⏭  ${item.code} — already exists, skipping`)
      skipped++
      continue
    }

    const { error } = await supabase.from('catalog_item').insert({
      company_id: companyId,
      ...item,
    })

    if (error) {
      console.error(`  ❌ ${item.code} — ${error.message}`)
      errors++
    } else {
      console.log(`  ✅ ${item.code} — ${item.name}`)
      created++
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped, ${errors} errors.\n`)
}

seed().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
