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
  },
})


