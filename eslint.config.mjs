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
  {
    // The ONE exception, and it is deliberate (C10). The client share page renders
    // on the server so a phone on bad LTE gets a single HTML response, and it uses
    // the service-role client inside getServerSideProps to resolve the token -
    // there is no session to give RLS a user to filter by.
    //
    // Law 9 still holds, and is verified rather than assumed: Next strips
    // getServerSideProps and its imports from the client build, and this page
    // declares `unstable_runtimeJS: false`, so it ships NO client JavaScript for
    // the key to reach. The runtime guard in lib/supabase-server.ts remains the
    // real control. Do not widen this to a glob: every other page stays covered.
    files: ['pages/v/\\[token\\].tsx', 'pages/v/[[]token].tsx', 'pages/v/*token*.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
  prettier,
]

export default config
