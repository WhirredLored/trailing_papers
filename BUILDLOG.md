# Build log

One line per commit: what was built, what was verified, what still needs a human.

## C01 — build(repo): scaffold Next.js TypeScript app with Supabase and tooling

Next.js 15 (Pages Router) + TypeScript strict + Tailwind v4, ESLint 9 flat config + Prettier,
Vitest with 4 passing tests. Supabase browser (anon) and server (service-role) client factories,
the latter guarded by a module-level browser check and an ESLint import restriction.
`lib/money.ts` placeholder establishes integer cents. `.env.example`, `.gitignore`,
`docs/DECISIONS.md`, README setup steps. Placeholder landing page, no auth, no domain tables.

VERIFIED: `npm run build`, `npm run test`, `npm run lint`, `npm run typecheck` all pass.
Service-role client proven to throw when evaluated with `window` defined (lib/supabase-server.test.ts).

AWAITING HUMAN: nothing functional — no Supabase project is connected yet, so the client
factories are constructed but never exercised against a real instance. First real check is C02.

NOTE: this machine is Windows on ARM64 and an Application Control policy blocks
`@next/swc-win32-arm64-msvc`; Next fell back to the WASM compiler. Builds succeed, just slower.
Not a code defect — no action taken.
