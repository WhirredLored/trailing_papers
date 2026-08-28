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
