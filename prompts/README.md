# Build specifications

PaperTrail is built spec-first. Each `C##` file here is one complete, self-contained
specification — project context, domain model, the ten architecture laws, conventions,
acceptance criteria, and the exact commit message it must produce. One spec, one commit.

`MILESTONES.md` defines the gates between them. They are real gates, not checkpoints:
M1's tenancy gate in particular must be proven by passing cross-tenant isolation tests
before anything is built on top of it.

| Spec | Scope | Status |
|------|-------|--------|
| C01 | Scaffold: Next.js, TypeScript, Tailwind, tooling | shipped |
| C02 | Multi-tenant auth, `app_metadata` roles, RLS isolation | shipped |
| C03 | Company profile, branding, license/insurance tracking | shipped |
| C04 | Clients, properties, projects | shipped |
| C05 | Integer-cents money utilities and totals engine | shipped |
| C06 | Catalog price book, bulk repricing, CSV import, price history | shipped |
| C07 | Assemblies with waste, packaging, auditable takeoff math | shipped |
| C08 | Versioned estimate builder, immutable issued versions | next |
| C09 | Server-side PDF document generation | planned |
| C10 | Tokenised client share links with access logging | planned |
| C11 | ESIGN/UETA e-signature with audit certificate | planned |
| C12 | Change orders against approved estimates | planned |
| C13 | Invoices: deposit and progress billing | planned |
| C14 | Stripe payments, card and ACH, idempotent webhooks | planned |
| C15 | Work phases with estimated vs actual hours | planned |
| C16 | Phase-tagged photo sessions with time entries | planned |
| C17 | Offline-first field capture and sync | planned |
| C18 | End-to-end workflow integration | planned |
| C19 | Evidence packet export | planned |
| C20 | Hardening | planned |
| C21 | Launch | planned |

These files are verbatim source material and are excluded from Prettier — reflowing them
would change the specifications.
