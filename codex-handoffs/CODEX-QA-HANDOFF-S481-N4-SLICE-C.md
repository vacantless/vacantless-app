# Codex QA handoff — S481: N4 notice-library Slice C (operator Prepare-N4 flow)

**Range:** `fda748d..<S481 HEAD>` (single commit from DEPLOY-S481-N4-SLICE-C.sh).
**Migration:** NONE (the `notices` table + every column used shipped in 0140, S476).
**Posture:** PREPARE-FIRST (design section 4). No serve-on-behalf. Serve-on-behalf
stays gated behind the per-form legal-verify pass (design section 6).

## What it does
Extends the LIVE N1 frozen-snapshot lane to the LTB **Form N4** (arrears termination).
Operator flow on the tenancy page (new "LTB notices" section):
1. **Prepare N4** — derive arrears from rent + `rent_payments`, build the immutable
   snapshot (`buildN4Snapshot`), and insert a `notices` row `status='draft'`. Blocked
   (no row written) when `n4SnapshotBlocker` fires: `no_arrears` / `unresolved_credits`
   (unassigned or out-of-window payments — force the operator to assign them so the N4
   can't overstate) / `not_reconciling`.
2. **Download official N4 (PDF)** — authenticated operator route fills the real gov form
   from the frozen snapshot (works on a draft, so the operator has it in hand to serve).
3. **Record service** (hand/mail/courier) — flips `draft -> served`, lights up the public
   tenant view.
4. **File to vault** — server-fills the PDF, stores it in the documents bucket
   (`source='in_app_generated'`, `doc_type='notice'`), stamps `filed_document_id` +
   `status='filed'`. Idempotent.
5. **Void** — `status='void'`; the public view stops rendering.

Public routes (generalize `/n1/[token]`): `/notice/[token]` (HTML summary) +
`/notice/[token]/official` (filled gov PDF) — admin client, keyed only by
`service_token`, render ONLY a served notice with a reconciling snapshot, else 404.
`ltb-n4-2022.pdf` bundled into the official route via next.config outputFileTracingIncludes.

## Files
- `lib/n4-snapshot.ts` (parked spine, now committed) + `scripts/test-n4-snapshot.ts` (26/0)
- `lib/n4-render.ts` — tenant HTML summary (plain-language; official PDF is authoritative)
- `app/notice/[token]/route.ts`, `app/notice/[token]/official/route.ts` — public (served only)
- `app/dashboard/tenancies/[id]/n4/official/route.ts` — operator PDF (manage_tenancies)
- `app/dashboard/tenancies/n4-actions.ts` — prepareN4 / recordN4Service / fileN4ToVault / voidN4
- `app/dashboard/tenancies/[id]/n4-section.tsx` — operator UI
- `app/dashboard/tenancies/[id]/page.tsx` (edit) — load notices + render section
- `next.config.mjs` (edit) — bundle ltb-n4-2022.pdf

## Review focus (please attack these)
1. **Authz / org-stamping (KI744/748).** Every action derives ids from RLS reads and
   stamps `organization_id` from the RESOURCE's own org (`tenancies.organization_id` in
   prepareN4; `notices.organization_id` in fileN4ToVault), never `getCurrentOrg()`. Confirm
   no client-supplied org/id is trusted, and RLS WITH CHECK holds on the notices insert.
2. **No arrears overstatement (N4 is void if overstated).** prepareN4 defaults to
   `conservativeOwingCents` and hard-blocks on `hasUnresolvedCredits`; `fillOfficialN4`
   is fail-closed (throws on >3 rows / negative row / rows>total). Confirm the draft can't
   be served/filled with an overstated or non-reconciling table (public official route also
   guards `n4SnapshotReady`).
3. **Public exposure.** `/notice/[token]` + `/official` must reveal NOTHING for a draft/
   void notice or a wrong token (404), and render strictly the immutable snapshot (no
   re-derive/drift). Admin-client read scoped to the single `service_token` row.
4. **Concurrency.** recordN4Service flips only `draft` (`.eq('status','draft')`);
   fileN4ToVault is idempotent (`.is('filed_document_id', null)` guard + early return).
5. **Prepare-first honesty.** No path serves the tenant on the landlord's behalf; the app
   only records a service the operator performed.

## Gates (on device; next build is the Mac's job, KI716)
tsc --noEmit: 0 errors. Tests: n4 75/0, n4-pdf 22/0, n4-snapshot 26/0,
distribution-concierge 60/0 (S479 invariant preserved). Headless smoke: derive ->
freeze -> fillOfficialN4 (valid 785KB %PDF-) -> renderN4Html all pass.

## Notes
- Codex's paused S480b edit (`components/settings-tabs.tsx`) is intentionally NOT in this
  commit; it remains an uncommitted working change.
- First-use verify (Noam, post-deploy): prepare a test N4 on North Star QA -> Download
  official N4 -> record service -> open /notice/<token>/official and eyeball the filled form.

---

## S481b — folded your S481 review (DEPLOY-S481b-CODEX-FOLDS.sh, on top of 6f3302a)
- **P1 override overstatement** — `n4SnapshotBlocker` now also rejects `total > rowsOwe` (new `overstated` reason); new pure `creditN4RowsToTotal` reconciles a DOWN override by crediting the reduction to the most-recent rows (charged−paid=owing preserved, rows sum exactly to total). An override above the ledger is left unreconciled → blocked. Override is now down-only + safe.
- **P2 service timing** — v1 records IN-PERSON (hand) service only; mail/courier (deemed-service date math) deferred to the legal-verify gate.
- **P2 fileN4ToVault** — reserve-before-side-effects: CAS-claims `filed_document_id` (where null, `.select()`) before any upload/insert; loser no-ops; winner rolls back on failure. Exactly one vault doc.
- **P2 public HTML parity** — `/notice/[token]` now also requires `n4SnapshotReady` (matches `/official`).
- **P3 lint** — apostrophes escaped; eslint clean.
Gates: tsc 0; eslint clean; test-n4 83/0, test-n4-pdf 22/0, test-n4-snapshot 35/0, test-distribution-concierge 60/0; smoke (down reconciles + fills valid PDF; over → overstated).
