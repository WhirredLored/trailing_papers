import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

/**
 * Server-only Supabase client. Carries the SERVICE ROLE key, which BYPASSES Row Level
 * Security entirely — shipping it to a browser hands every tenant's data to every visitor
 * (Architecture Laws 1 and 9).
 *
 * The guard below runs at module evaluation, so an accidental import from client code
 * fails loudly the moment the bundle executes rather than leaking quietly. ESLint blocks
 * the import path as well; this is the control, that is the convenience.
 */

if (typeof window !== 'undefined') {
  throw new Error(
    'lib/supabase-server.ts was loaded in the browser. It holds the service-role key and ' +
      'bypasses RLS. Import lib/supabase-browser.ts from client code instead.',
  )
}

let cached: SupabaseClient<Database> | undefined

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`)
  }
  return value
}

export function getServiceRoleClient(): SupabaseClient<Database> {
  if (!cached) {
    cached = createClient<Database>(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
      requireEnv('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return cached
}
