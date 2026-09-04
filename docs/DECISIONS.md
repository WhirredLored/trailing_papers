# Decisions

Every judgment call made while building PaperTrail, one line each (Architecture Law 10).

Format: `YYYY-MM-DD | <commit> | <decision> | <why>`

2026-08-27 | C01 | App scaffolded in the prompt-pack repo rather than a separate one | The pack ships as a directory handed to an agent; keeping prompts and code together keeps each commit next to the prompt that specified it.
2026-08-27 | C01 | Tailwind v4 with the CSS-first `@import 'tailwindcss'` and no tailwind.config | v4 is current, content paths are auto-detected, and one less config file to drift.
2026-08-27 | C01 | Vitest over Jest | Native ESM and TypeScript with no transform config, and it reuses the Vite resolver for the `@/` alias.
2026-08-27 | C01 | Service-role guard is a module-level `typeof window` throw, not the `server-only` package | `server-only` only trips in React Server Components; this app is Pages Router, so that package would silently pass. ESLint `no-restricted-imports` backs the runtime guard up at author time.
2026-08-27 | C01 | Existing pack README extended with a Setup section rather than replaced | The pack README is the repo's front door; C01 asked for setup steps, not a new document.
2026-08-27 | C01 | DECISIONS.md seeded with these lines rather than the header alone | C01 asked for a header-only file, but Law 10 requires a line per judgment call and this commit made six.
2026-08-27 | tooling | Supabase MCP server added at project scope, .mcp.json committed | Project scope is what Supabase documents, and project_ref is public (it is in the project URL), not a secret.
2026-08-27 | tooling | .agents/skills committed to git, .claude/skills gitignored | The symlinks Claude Code reads carry absolute paths to this checkout and break on any other machine; the vendored skill text is committed so upstream changes arrive as reviewable diffs, since skills load as instructions.
2026-09-04 | C02 | Rollup ARM64 native binary patched to redirect to @rollup/wasm-node/dist/native.js | Application Control policy blocks .node binaries; @rollup/wasm-node exposes the same parse/parseAsync/xxhash* interface rollup's native.js expects; patching is stable across npm installs via a postinstall note in BUILDLOG.
2026-09-04 | C03 | deposit_pct stored as integer 0-100, default_tax_bp as integer basis points | Consistent with Law 4 (integer math); avoids float rounding on percentages; tax displayed to user as decimal, converted on save.
2026-09-04 | C03 | Logo upload via base64 body (not multipart) | Keeps the API route simple and avoids multipart parser config across environments; 5 MB cap enforced server-side; upsert=true replaces existing logo atomically in Storage.
2026-09-04 | C03 | company-assets Storage bucket must be created manually in Supabase dashboard | Storage bucket creation requires the Management API or dashboard; it cannot be created via SQL migration; documented in BUILDLOG AWAITING HUMAN.
2026-09-04 | C04 | client/property/project tables duplicate C02 tenancy template exactly | Strict adherence to C02 template: `company_id` on every table, `deleted_at` for soft deletes, `updated_at` trigger, and explicit RLS policies (select/insert/update).
2026-09-04 | C04 | project_user linking table added | Allows many-to-many relationship for assigning team members to projects, with its own RLS policies tied to `company_id`.

