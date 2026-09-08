import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/supabase'

/**
 * Browser-safe Supabase client. Carries the anon key only, so every query it makes is
 * subject to Row Level Security — which is the security boundary (Architecture Law 1).
 */

let cached: SupabaseClient<Database> | undefined

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing environment variable ${name}. See .env.example.`)
  }
  return value
}

export function getBrowserClient(): SupabaseClient<Database> {
  if (!cached) {
    cached = createClient<Database>(
      requireEnv('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
      requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    )
  }
  return cached
}
