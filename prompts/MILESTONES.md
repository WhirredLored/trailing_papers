# PaperTrail — Milestones & Exit Gates

## M1 — Foundation [C01–C04] → v0.1.0
Scaffold, multi-tenant auth with RLS, company profile, clients/properties/projects.
GATE: cross-tenant isolation tests pass for every table; a second company literally cannot see
the first's data. Nothing else ships until this is true.

## M2 — Estimating Engine [C05–C09] → v0.2.0
Money primitives, price book, assemblies/takeoff, versioned estimate builder, PDF documents.
GATE: a real past job of yours, re-estimated in the app, lands within 5% of what you actually
bid it at — and the takeoff derivation lines make the difference explainable.

## M3 — Client-Facing [C10–C11] → v0.3.0
Tokenized share links with access logging, ESIGN-grade signature with certificate.
GATE: send an estimate to your own phone as if you were a client, sign it, and confirm the
signed copy + certificate arrive by email and match hashes.

## M4 — Money [C12–C14] → v0.4.0
Change orders with work-gate warnings, deposit/progress/final invoices, Stripe card + ACH.
GATE: full test-mode cycle — estimate signed → deposit invoice → paid → change order signed →
final invoice → paid — sums exactly to the contract total, with duplicate webhooks harmless.

## M5 — Field [C15–C17] → v0.5.0
Phases and hour tracking, phase-tagged photo sessions, offline capture and sync.
GATE: run a real half-day of work through it in airplane mode; everything syncs once, nothing
lost, and signatures/payments correctly refuse to operate offline.

## M6 — Workflow & Ship [C18–C21] → v1.0.0
Pipeline and dashboard, evidence packet, security hardening, onboarding and launch.
GATE: RLS audit test green in CI; production smoke test (estimate → sign → invoice → pay,
refunded) passes on live infrastructure.
