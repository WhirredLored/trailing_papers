import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { FlatCompat } from '@eslint/eslintrc'
import prettier from 'eslint-config-prettier'

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
})

const config = [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    // Law 9: the service-role key never reaches the browser. The runtime guard in
    // lib/supabase-server.ts is the real control; this makes the mistake fail at lint
    // time instead of at request time.
    files: ['pages/**/*.tsx', 'components/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/supabase-server', '@/lib/supabase-server'],
              message:
                'lib/supabase-server.ts holds the service-role key and bypasses RLS. Use lib/supabase-browser.ts in components and pages.',
            },
          ],
        },
      ],
    },
  },
  prettier,
]

export default config
