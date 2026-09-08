import type { Database } from './supabase'

/**
 * Short aliases over the generated Supabase types.
 *
 * `types/supabase.ts` is regenerated with `supabase gen types typescript --linked`
 * and must never be edited by hand. These helpers are the stable surface the app
 * imports, so a regeneration does not ripple through every call site.
 */

type PublicTables = Database['public']['Tables']

/** A row as it comes back from a select. */
export type Tables<T extends keyof PublicTables> = PublicTables[T]['Row']

/** The shape accepted by .insert(). */
export type Insert<T extends keyof PublicTables> = PublicTables[T]['Insert']

/** The shape accepted by .update() — every column optional. */
export type Update<T extends keyof PublicTables> = PublicTables[T]['Update']

/** A database enum, e.g. Enums<'catalog_item_kind'>. */
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T]
