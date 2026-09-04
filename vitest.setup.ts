/**
 * Vitest setup — loads .env.local before any test file runs so real-DB tests
 * can read Supabase credentials. Uses Node's built-in fs; no extra deps.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
    // File doesn't exist — fine, move on.
  }
}

