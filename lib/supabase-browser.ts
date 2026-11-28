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

// A `type` alias rather than `interface`: object type literals get an implicit
// index signature when every property is string-valued, which is what makes
// this assignable to fetch's `HeadersInit` at every call site without a cast;
// an `interface` with the same properties does not get that and fails to
// typecheck against `Record<string, string>`.
export type BearerHeaders = {
  Authorization: string
  'Content-Type': string
}

/**
 * The staff API routes authorise on `Authorization: Bearer`, not a cookie, so
 * every client-side fetch needs the current session's access token. Shared
 * rather than redefined per component, since every staff-facing page or panel
 * that calls a session-authorized route needs exactly this.
 */
export async function authHeaders(): Promise<BearerHeaders | null> {
  const {
    data: { session },
  } = await getBrowserClient().auth.getSession()
  if (!session) return null
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  }
}
