import type { Database } from '../types/supabase'

/**
 * Sample assembly definitions - the shared source of truth for the seed script and
 * its known-answer tests.
 *
 * THIS IS SAMPLE DATA. Every quantity, waste factor and package size is a plausible
 * starting point, not an authority. A contractor must review them against their own
 * crews and suppliers before quoting real work.
 *
 * Kept in lib/ rather than inside the seed script so the tests can import the exact
 * rates that get seeded. A known-answer test against a copy of the data would prove
 * nothing about what actually lands in the database.
 *
 * PRECISION: assembly_component.quantity_per_driver is numeric(12,4), so rates are
 * expressed to four decimal places. Where a real rate is finer than that (a house-wrap
 * roll covers about 1,350 sq ft, i.e. 0.00074 rolls per sq ft) the rate is rounded at
 * 4dp and the true coverage is stated in the component note.
 */

export type DriverUnit = Database['public']['Enums']['assembly_driver_unit']
export type RoundingRule = Database['public']['Enums']['rounding_rule']

export type SeedComponent = {
  /** catalog_item.code - must already exist for this company */
  code: string
  quantityPerDriver: number
  wastePercentBp: number
  roundingRule: RoundingRule
  packageSize?: number
  notes?: string
}

export type SeedAssembly = {
  name: string
  description: string
  driverUnit: DriverUnit
  notes: string
  components: SeedComponent[]
}

/**
 * Catalog items these assemblies need that the C06 catalog seed does not include.
 * Created only if the code is absent, and marked as sample data like the rest.
 */
export const EXTRA_CATALOG_ITEMS = [
  {
    code: 'INS-FANFOLD',
    name: 'Fanfold insulation backerboard',
    kind: 'material' as const,
    unit: 'sq' as const,
    unit_cost_cents: 3200,
    default_markup_bp: 2500,
    taxable: true,
    description: 'SAMPLE DATA. Per square (100 sq ft) bundle, 1/4 inch fanfold.',
  },
]

export const SAMPLE_ASSEMBLIES: SeedAssembly[] = [
  {
    name: 'Demo - strip existing siding',
    description: 'SAMPLE DATA. Tear-off, haul-out and site cleanup, priced per sq ft of wall.',
    driverUnit: 'sq_ft',
    notes: 'Assumes single-layer tear-off. Double-layer or stucco takes roughly twice the labor.',
    components: [
      {
        code: 'LAB-DEMO',
        quantityPerDriver: 0.012,
        wastePercentBp: 0,
        roundingRule: 'exact',
        notes: 'About 83 sq ft per crew-hour.',
      },
      {
        code: 'OTH-DUMP',
        quantityPerDriver: 0.0004,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
        notes: 'One 20 yd dumpster per about 2,500 sq ft.',
      },
      { code: 'LAB-CLEAN', quantityPerDriver: 0.004, wastePercentBp: 0, roundingRule: 'exact' },
    ],
  },
  {
    name: 'Water barrier - house wrap',
    description: 'SAMPLE DATA. Housewrap, seam tape and fasteners over sheathing, per sq ft.',
    driverUnit: 'sq_ft',
    notes: 'Rate assumes 6 in horizontal and 12 in vertical laps.',
    components: [
      {
        code: 'WRP-TYVEK',
        quantityPerDriver: 0.0008,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
        notes: 'One 9 ft x 150 ft roll covers about 1,350 sq ft; rate rounded up at 4dp.',
      },
      {
        code: 'WRP-TAPE',
        quantityPerDriver: 0.0008,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
        notes: 'One roll per about 1,250 sq ft of seams.',
      },
      {
        code: 'FST-NAIL15',
        quantityPerDriver: 0.0004,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
        notes: 'Cap nails, one box per about 2,500 sq ft.',
      },
      { code: 'LAB-HELP', quantityPerDriver: 0.008, wastePercentBp: 0, roundingRule: 'exact' },
    ],
  },
  {
    name: 'Backerboard - fanfold insulation',
    description: 'SAMPLE DATA. Fanfold underlayment over sheathing, per sq ft.',
    driverUnit: 'sq_ft',
    notes: 'Sold per 100 sq ft bundle, so the driver divides by 100 exactly.',
    components: [
      {
        code: 'INS-FANFOLD',
        quantityPerDriver: 0.01,
        wastePercentBp: 500,
        roundingRule: 'up_to_unit',
        notes: 'One square per 100 sq ft, 5 percent cutting waste.',
      },
      {
        code: 'FST-NAIL15',
        quantityPerDriver: 0.0004,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
      },
      { code: 'LAB-HELP', quantityPerDriver: 0.01, wastePercentBp: 0, roundingRule: 'exact' },
    ],
  },
  {
    name: 'J-channel and trim-out',
    description: 'SAMPLE DATA. J-channel around openings and terminations, priced per lin ft.',
    driverUnit: 'lin_ft',
    notes: 'J-channel ships in 12 ft 6 in sticks, so purchase quantity rounds to the stick.',
    components: [
      {
        code: 'TRIM-JCHAN',
        quantityPerDriver: 1,
        wastePercentBp: 1000,
        roundingRule: 'up_to_package',
        packageSize: 12.5,
        notes: '12 ft 6 in sticks, 10 percent waste for miters.',
      },
      {
        code: 'FST-NAIL15',
        quantityPerDriver: 0.002,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
      },
      {
        code: 'LAB-LEAD',
        quantityPerDriver: 0.05,
        wastePercentBp: 0,
        roundingRule: 'exact',
        notes: 'About 20 lin ft per hour including cuts.',
      },
    ],
  },
  {
    name: 'Vinyl siding - D4.5 clapboard',
    description: 'SAMPLE DATA. Siding, starter, fasteners and labor over prepared wall, per sq ft.',
    driverUnit: 'sq_ft',
    notes: 'The reference assembly for the takeoff engine. Siding is sold per square (100 sq ft).',
    components: [
      {
        code: 'SID-D45',
        quantityPerDriver: 0.01,
        wastePercentBp: 1000,
        roundingRule: 'up_to_package',
        packageSize: 1,
        notes: '10 percent waste covers cuts and pattern alignment.',
      },
      {
        code: 'TRIM-START',
        quantityPerDriver: 0.1,
        wastePercentBp: 500,
        roundingRule: 'up_to_package',
        packageSize: 12.5,
        notes: 'Starter strip along the bottom course.',
      },
      {
        code: 'FST-NAIL15',
        quantityPerDriver: 0.0004,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
      },
      { code: 'LAB-LEAD', quantityPerDriver: 0.025, wastePercentBp: 0, roundingRule: 'exact' },
      { code: 'LAB-HELP', quantityPerDriver: 0.02, wastePercentBp: 0, roundingRule: 'exact' },
    ],
  },
  {
    name: 'Trim - window and door openings',
    description: 'SAMPLE DATA. Casing, caulk and labor, priced per opening rather than per foot.',
    driverUnit: 'opening',
    notes: 'Driver is a count of openings. Use the J-channel assembly for the linear footage.',
    components: [
      {
        code: 'TRIM-WCASE',
        quantityPerDriver: 1,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
        notes: 'One casing kit per opening.',
      },
      {
        code: 'FST-CAULK',
        quantityPerDriver: 0.25,
        wastePercentBp: 0,
        roundingRule: 'up_to_unit',
        notes: 'One tube per four openings.',
      },
      {
        code: 'LAB-LEAD',
        quantityPerDriver: 0.75,
        wastePercentBp: 0,
        roundingRule: 'exact',
        notes: '45 minutes per opening.',
      },
    ],
  },
]
