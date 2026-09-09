import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      // ARM64 Application Control policy blocks the native rollup binary on this machine.
      // Redirect to the pure-JS WASM build (same as C01's Next.js workaround).
      'rollup/parseAst': '@rollup/wasm-node/parseAst',
    },
  },
  test: {
    environment: 'node',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules/**', '.next/**'],
    setupFiles: ['./vitest.setup.ts'],
    // The live-project suites seed a tenant in beforeAll — an auth user plus a
    // chain of domain rows, each its own round trip — and tear it down again in
    // afterAll. That does not fit vitest's 10s default, and a hook that times
    // out mid-seed leaves the fixtures it already created behind in the real
    // project. Both isolation.test.ts and estimate-db.test.ts have done exactly
    // that; the generous ceiling is cheaper than the cleanup.
    hookTimeout: 60_000,
  },
})


