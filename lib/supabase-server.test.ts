import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Acceptance check for C01: the service-role client must throw rather than load in a
 * browser. This is the test that keeps Law 9 honest as the app grows.
 */
describe('lib/supabase-server', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws when evaluated in a browser', async () => {
    vi.stubGlobal('window', {})
    await expect(import('./supabase-server')).rejects.toThrow(/service-role key/i)
  })

  it('loads on the server', async () => {
    const mod = await import('./supabase-server')
    expect(mod.getServiceRoleClient).toBeTypeOf('function')
  })
})
