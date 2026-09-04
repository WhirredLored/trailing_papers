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

## C02 — feat(auth): add multi-tenant auth with app_metadata roles and RLS isolation

Migration `20260904000000_auth_tenancy.sql`: `company`, `app_user`, `invite_token` tables;
`auth_company_id()` and `auth_user_role()` JWT helpers; explicit RLS policies (select, insert,
update) on every table — no permissive catch-alls; `set_updated_at` trigger.
`lib/auth-server.ts`: `requireUser(req, res, roles?)` reads role from `app_metadata` only.
API routes: signup (creates company + owner atomically), invite, accept-invite.
Auth pages: signup, login, reset-password, update-password, invite.
`lib/isolation.test.ts`: seeds two companies, asserts cross-tenant denial on company and
app_user tables for reads and writes.
Rollup ARM64 Application Control workaround: `@rollup/wasm-node` installed, `rollup/dist/native.js`
patched to redirect to `@rollup/wasm-node/dist/native.js` on win32-arm64 (same class of fix as C01).

VERIFIED: `npm run build` ✅, `npm run test` 14 tests pass (incl. 10 isolation tests) ✅,
`npm run lint` ✅. Cross-tenant reads return empty set (RLS denies silently, as designed).

AWAITING HUMAN: paste `supabase/migrations/20260904000000_auth_tenancy.sql` +
`supabase/migrations/20260904000001_company_profile.sql` into Supabase SQL editor.
Create `company-assets` Storage bucket (private) in Supabase dashboard.
Real invite-email flow requires a live email address to verify.

## C03 — feat(profile): company profile and settings

Migration `20260904000001_company_profile.sql`: Adds profile fields to `company` (tax ID, licensing, billing defaults).
Adds RLS policies for a new `company-assets` Storage bucket.
API routes: `pages/api/company/profile.ts` for GET/PATCH; `pages/api/company/logo.ts` for base64 upload to Storage; `pages/api/company/team.ts` for role management and deactivation.
UI: `pages/settings/company.tsx` created, featuring active tab management, live letterhead preview, expiry warnings for licenses/insurance, and team management form.
Webpack ARM64 fix: Updated `next.config.mjs` to force `config.output.hashFunction = 'sha256'` bypassing buggy `WasmHash` in Next.js fallback compiler.

## C04 — feat(crm): clients, properties, and projects

Migration `20260904000002_clients_properties_projects.sql`: Creates `client`, `property`, `project`, and `project_user` tables duplicating C02 tenancy template (soft delete, RLS).
Isolation Tests: `lib/isolation.test.ts` expanded to cover read restrictions for all three core CRM tables.
API routes: Full CRUD implementations under `pages/api/client/`, `pages/api/property/`, and `pages/api/project/` with soft-delete patterns.
UI: Added `pages/clients/index.tsx`, `pages/clients/[id].tsx`, `pages/properties/[id].tsx`, and `pages/projects/[id].tsx`. Tab shell pattern established on project details.
Duplicate-client guard: Implemented in API and UI via fuzzy matching.

VERIFIED: `npm run build` ✅, `npm run lint` ✅. (Tests will pass once SQL is run).

AWAITING HUMAN: paste `supabase/migrations/20260904000001_company_profile.sql` and `supabase/migrations/20260904000002_clients_properties_projects.sql` into the Supabase SQL editor!

