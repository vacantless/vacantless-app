> **STATUS: SHIPPED + VERIFIED LIVE 2026-07-20 (Codex 0a81f7b, mig 0167 applied, Vercel READY; real-data smoke test passed; S531 f6d0434 added the confirm note field). CLOSED - do not rebuild.**

# CODEX BUILD S530 — e-Transfer email capture: rent in + trade payments out

Cut 2026-07-20 (s524, Noam-approved incl. the outbound/trades direction). Base: `8f0a845` (S528).
Design context: `claude/DESIGN-DIFFERENTIATION-BANKING-SYNDICATION-S529.md` (Appendix A) and the
ingress design lock `EMAIL-IN-INGRESS-DESIGN-LOCK-2026-06-28.md`.

## Goal

A landlord forwards an Interac e-Transfer notification email to their existing per-org ingest
address (`u-<token>@in.vacantless.com`). Vacantless parses it and files a PENDING suggestion the
landlord confirms in the dashboard:

- **RECEIVED** ("<name> sent you money") → "Looks like rent from <name>" matched to a tenancy.
  Confirm → records a rent payment through the SAME path as manual rent logging.
- **SENT** ("Your transfer to <name>") → "Payment to <payee>" expense suggestion with
  category + unit PREFILLED from the org's payee `categorization_rules` (S527 rules). Confirm →
  `insertExpenseAndAssign` (claim-first). This is how cleaners / painters / gardeners paid by
  e-Transfer land on the books with zero bank connection.

NEVER an unattended write to rent_payments or expenses. Confirm/dismiss is always the landlord.

## Why this shape (constraints that are design, not suggestion)

1. **Reuse the live S384 ingress rail unchanged for layers 1–3, 5, 6** (`lib/email-ingest.ts`):
   webhook secret (constant-time), recipient token→org, per-org verified-sender allow-list,
   auto-reply/loop drop, hashed-message-id dedupe. The forwarded email's From is the LANDLORD
   (they forwarded it), so the existing allow-list is the authority — no new trust surface.
2. **The one deliberate departure: this is a body-parse feature.** Today's ingress ignores
   bodies entirely (attachment-only, PII posture). e-Transfer capture adds a narrow body-parse
   branch with its own guardrails:
   - Parse ONLY when the body confidently matches Interac e-Transfer notification templates
     (marker phrases + interac.ca reference patterns; EN + FR templates).
   - Extract ONLY `{counterparty name, amount cents, date, direction}`.
   - **Parse-and-discard: never persist the raw body or headers.** Store the parsed tuple + the
     existing hashed message-id dedupe key. A non-matching body with no attachment → drop
     (existing policy); with an attachment → existing asset-capture path untouched.
3. **Double-count guards (the S518 single-source law, both directions):**
   - Received: confirming records the rent payment; a later bank-feed deposit LINKS to it via
     the existing rail rule (S519 `rent-from-bank` links, never re-records).
   - Sent: confirming creates the expense with NO bank_transaction_id; when the bank debit later
     arrives, reconcile must surface "link to existing expense" via the EXISTING
     `expenseMatchCandidateForTransaction` (`lib/reconciliation.ts`) so the operator links
     instead of creating a duplicate. If the reconcile debit UI does not currently offer the
     link action, add it (small, S527-adjacent — the candidate helper already exists).
4. **Suggestion, not conviction (feedback_dogfood_real_books_dont_guess):** received money only
   pre-fills a tenancy when the S519 classifier (`lib/rent-classify.ts` — `isInRentWindow`,
   amount match) says likely-rent; otherwise the suggestion is uncategorized "money in — you
   decide". Sent money prefills from a payee rule only on a confident payee match; otherwise
   category empty. Wrong guesses must cost one dropdown, not an unwind.

## Scope (est. 8–10 files, ONE additive migration)

- **NEW pure** `lib/etransfer-ingest.ts` — template detection (EN/FR received + sent), field
  extraction (name/amount/date/direction), forwarded-wrapper tolerance (Fwd:/Tr: subjects,
  quoted bodies, Gmail/Outlook/Apple Mail forward formats), match proposer (tenancy candidates
  via rent-classify; payee→rule candidates), and the dedupe key. No Supabase/Next imports.
- **NEW** `scripts/test-etransfer-ingest.ts` — fixtures for: received EN + FR, sent EN + FR,
  Gmail/Outlook forward wrappers, non-Interac lookalike REJECTED (a phishing-style body must
  not parse), amount forms ($1,234.56 / 1 234,56 $), dedupe stability, direction detection,
  rent-window matching, payee-rule matching. Target the S52x test depth (30–50 asserts).
- **EDIT** `app/api/inbound/asset/route.ts` (or a thin sibling route reusing the same auth
  helpers — Codex's call; keep ships-dark: unset `INBOUND_WEBHOOK_SECRET` → 404 no-op) — after
  the existing sender/token gates, try e-Transfer body-parse BEFORE the attachment path; on
  match, insert a pending `etransfer_captures` row and stop.
- **NEW migration `0167_etransfer_captures.sql`** — ADDITIVE, one org-scoped table
  `etransfer_captures` (org id, direction, counterparty_name, amount_cents, txn_date,
  suggested_tenancy_id / suggested_category / suggested_property_id nullable, status
  pending|confirmed|dismissed, created refs to rent_payment/expense on confirm, dedupe key
  UNIQUE per org, timestamps). RLS via `user_org_ids()` AND explicit GRANTs to authenticated +
  service_role (KI: RLS without the grant bites — mirror mig 0166).
- **EDIT** a review surface — recommend a "Captured e-Transfers" section on
  `/dashboard/expenses` beside the existing Money-in panel (one queue, both directions, badge
  count), with per-row Confirm (server action → record rent via the existing manual path /
  `insertExpenseAndAssign`) and Dismiss. Empty state explains the forward-to address and links
  the copyable address.
- **EDIT** money nav/hub card copy only if needed to surface the queue (keep minimal).

**Entitlement:** gate on the existing `capture_email_in` entitlement (same switch as email-in
asset capture) — one mental model for "forward things to Vacantless". Show-locked with upsell
for orgs without it (feedback_feature_visibility_two_axes).

## Don't touch

`lib/statements.ts`, `lib/reminders.ts`, bank-import/*, `app/dashboard/expenses/import-actions.ts`,
billing, `vercel.json`, workflows, rent_payments/expenses SCHEMA (rows only via existing
helpers), the S528 files' new copy, anything SMS.

## Invariants (verify list for the Cowork pass)

1. No unattended writes: every path out of the webhook ends in a PENDING row or a drop — never
   rent_payments/expenses.
2. Raw body/headers never persisted; only the parsed tuple + hashed dedupe key.
3. All six ingress layers still pass unchanged for the attachment path (email-ingest tests stay
   green).
4. Confirm paths are claim-first + idempotent (double-tap safe); dedupe key blocks the same
   notification landing twice.
5. Reconcile double-count guards hold in BOTH directions (deposit links to recorded rent; debit
   offers link-to-existing-expense).
6. Org-scoping: RLS + grants on `etransfer_captures`; suggestions only ever reference the
   capture's own org's tenancies/properties/rules.
7. Ships dark: no `INBOUND_WEBHOOK_SECRET` → no-op; no entitlement → locked surface, no ingress
   processing for that org (drop with a logged reason).

## Process (standing)

Codex: build on a branch off `8f0a845`, tsc+lint+build+tests green on-device, commit+push (if
`.git/index.lock`, rm -f it). Migration is NOT applied by Codex — Cowork applies `0167` via
Supabase MCP PROMPTLY on deploy (KI814: additive new-table mig = no getCurrentOrg race, but
apply before the queue surface gets traffic). Cowork verifies by cloning the public repo into
the cloud: exact file scope, `git diff --check`, invariants above, `npx tsx
scripts/test-etransfer-ingest.ts` + regression `test-email-ingest`, `test-rent-classify`,
`test-reconcile-assign`, then Vercel READY.
