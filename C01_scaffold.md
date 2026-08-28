# ══════════════════════════════════════════════════════════════════════════════
# PROJECT CONTEXT (read fully before writing any code)
# ══════════════════════════════════════════════════════════════════════════════
You are building PaperTrail. Unless this prompt is the scaffold commit (C01), assume the
codebase below exists and is green — build on it, never rewrite it.

WHAT PAPERTRAIL IS
Field-first contracting software for residential trades: estimate → e-signed approval →
scheduled work → phase-tagged photo evidence with logged hours → change orders → invoice →
payment. Built for a contractor standing on a jobsite with one hand free and no signal.

THE THESIS (this decides every design tradeoff)
Competitors handle estimate→invoice. Contractors lose money on DISPUTES and unsigned change
orders. PaperTrail's differentiator is an unbroken EVIDENCE CHAIN: every document a client saw,
every signature, every change order, and every photo is timestamped, attributed, and immutable
once issued. When a homeowner says "I never approved that," the contractor produces the record
in ten seconds. Anywhere you must choose between convenience and an auditable record, choose
the record.

STACK (fixed — do not substitute)
- Next.js (Pages Router) + TypeScript + Tailwind, deployed on Vercel
- Supabase (Postgres + Auth + Storage + RLS) — RLS is the security boundary, not the API layer
- Stripe for payments (Checkout + webhooks); ACH and card
- PWA: installable, offline-capable, mobile-first — the primary device is a phone in a work glove
- PDF generation server-side; email via a transactional provider
NON-GOALS for v1: no payroll, no accounting-suite replacement, no crew chat, no native apps,
no marketplace, no AI estimating.

DOMAIN MODEL (canonical — do not rename these concepts)
  company        — the contractor's business (multi-tenant root; every table carries company_id)
  user           — belongs to a company, has a role (owner | admin | crew)
  client         — homeowner/customer
  property       — a job address; a client may have several
  project        — work at a property; holds phases, photos, documents, money
  catalog_item   — reusable priced line item (labor or material) owned by the company
  assembly       — a recipe converting a measured dimension into materials + labor
                   (e.g. "vinyl siding, per 100 sq ft" → siding squares, J-channel LF,
                   starter strip LF, nails, labor hours), each component with a waste factor
  estimate       — versioned; issued estimates are IMMUTABLE, revisions create a new version
  change_order   — a delta against an approved estimate; same signature flow; blocks work
                   until signed
  invoice        — issued against an estimate/change orders; supports deposit + progress billing
  payment        — a Stripe transaction against an invoice
  signature      — an ESIGN/UETA-grade signing event with a full audit trail
  phase          — a stage of work on a project (demo, water barrier, backerboard, J-channel,
                   siding, trim, cleanup) with estimated vs actual hours
  photo_session  — a set of photos captured against a phase, with time entries
  document       — any generated PDF (estimate, change order, invoice, signed copy)

ARCHITECTURE LAWS (non-negotiable)
1. TENANCY IS ENFORCED IN THE DATABASE. Every table has company_id and an RLS policy keyed to
   the caller's company. No query anywhere relies on an application-layer filter for isolation.
   A missing RLS policy is a security defect, not a TODO.
2. ROLES COME FROM app_metadata, NEVER user_metadata. user_metadata is user-writable; treating
   it as authorization is privilege escalation. Re-check authorization in every API route —
   middleware is a convenience, not a control.
3. ISSUED DOCUMENTS ARE IMMUTABLE. Once an estimate, change order, or invoice is issued or
   signed, its content and totals are frozen and a PDF snapshot is stored. Corrections happen
   by new version or credit note, never by mutation. Enforce in the database, not just the UI.
4. MONEY IS INTEGER CENTS. Never floats, never JS number arithmetic on dollars. One money
   utility module does all formatting and math; every total is recomputed server-side and never
   trusted from the client.
5. WRITES THAT MOVE MONEY OR STATE ARE ATOMIC AND IDEMPOTENT. Use transactions or Postgres
   functions with row locks for anything read-then-write (issuing, approving, payment
   application). Stripe webhooks must be idempotent — the same event delivered twice changes
   nothing the second time.
6. OFFLINE IS A FIRST-CLASS PATH, NOT A FALLBACK. Field capture (photos, time entries, notes,
   phase updates) must work with zero signal and sync later with conflict handling. Money
   operations and signatures REQUIRE connectivity and must say so plainly rather than queueing.
7. EVERY CLIENT-FACING LINK IS AN UNGUESSABLE TOKEN, scoped to one document, revocable, with
   access logged (timestamp, IP, user agent). No client account required to view or sign.
8. AUDIT, DON'T DELETE. State changes on documents, signatures, and payments append to an audit
   log. Destructive actions soft-delete with attribution.
9. Secrets only in environment variables; Stripe webhooks verified against the RAW request body;
   service-role keys never reach the browser.
10. Scope discipline: implement ONLY what this prompt asks. Unrelated findings become a line in
    docs/DECISIONS.md (`YYYY-MM-DD | <commit> | <decision> | <why>`), not code. Every judgment
    call gets a DECISIONS.md line.

CONVENTIONS
- Tables and columns snake_case singular (`change_order`, `company_id`); TypeScript types
  PascalCase; React components PascalCase; hooks `useThing`; API routes REST-ish under
  /api/<resource>. Migrations are timestamped SQL files, never edited after being applied.
- Every table: id (uuid), company_id, created_at, updated_at, created_by. Soft delete via
  deleted_at where Law 8 applies.
- `npm run build` and `npm run test` (and `npm run lint`) must pass before the commit is done.

DELIVERABLE FORMAT
If you are an agent with filesystem access: apply the changes, run the checks yourself, and
commit with the exact message quoted at the end of this prompt — verbatim. Then append your
status line to BUILDLOG.md and continue if running a mission file; otherwise stop and report.
If you are a chat session: output the complete contents of every new or changed file (full
files, not diffs), a one-line summary, then that same commit message.

VERIFICATION SPLIT (for agents)
Verify yourself: builds, tests, lint, type checks, SQL that runs, RLS policies proven by a test
that attempts cross-tenant reads and is denied, Stripe flows against test-mode keys.
Cannot verify: real-device field use, real client signing on a real phone, print output, email
deliverability, and anything requiring a live payout. Implement to spec, list what awaits human
verification, and never claim results you did not observe.

LEGAL NOTE (carry into any user-facing copy you write)
E-signature and contract features must satisfy ESIGN/UETA basics: disclosed intent to sign,
consent to do business electronically, association of the signature with the record, and a
retained tamper-evident copy the signer can download. Implement those mechanics faithfully.
Do NOT write legal advice into the product, and do not generate contract clause libraries or
warranty language — leave those as company-supplied templates for the contractor's own attorney
to approve.

# ══════════════════════════════════════════════════════════════════════════════
# TASK — M1 commit C01: project scaffold

This IS the scaffold commit.

IMPLEMENT
1. Next.js (Pages Router) + TypeScript + Tailwind, strict TS. ESLint + Prettier. Vitest (or
   Jest) configured and running one trivial passing test so `npm run test` is real from day one.
2. Directory structure: /pages, /pages/api, /components, /lib (money.ts placeholder, supabase
   client factories), /types, /supabase/migrations, /docs.
3. Supabase client factories in /lib: a browser client (anon key) and a server-only client
   (service role, never imported into client code — enforce with a lint rule or a runtime guard
   that throws if loaded in the browser).
4. .env.example with every required variable named and commented; .gitignore covering .env*,
   .next, node_modules, and any generated PDFs.
5. docs/DECISIONS.md with its header line only. A README with setup steps.
6. A placeholder landing page. No auth, no domain tables yet.

ACCEPTANCE
- `npm run build`, `npm run test`, `npm run lint` all pass. Service-role client cannot be
  imported from a client component without throwing.

COMMIT MESSAGE (use verbatim)
build(repo): scaffold Next.js TypeScript app with Supabase and tooling
