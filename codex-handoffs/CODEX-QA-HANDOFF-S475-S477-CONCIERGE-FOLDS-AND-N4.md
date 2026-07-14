# Codex QA handoff — S475 (concierge P2 folds) + S476/S477 (N4 notice-library Slices A+B)

Review as two units. All LIVE + Vercel READY (`app.vacantless.com` = `132964b`).

## Commits / range
- **S475** `a60cbb8` — folds YOUR S474b review (3× P2 on the concierge "Publish for me" lane).
- **S476** `aa63b1c` — N4 Slice A: `notices` table (migration `0140`, applied) + pure logic.
- **S477** `132964b` — N4 Slice B: official Form N4 fill.
- **Full range:** `7fa4b36 (S474b) .. 132964b` on main.
- **Migration applied to prod (`nvhvdyxpyogvadpjlvij`) via MCP + verified:** `0140` (15 cols,
  RLS on, 1 org policy, 4 indexes, N-type CHECK). No other DB change.

---

## UNIT 1 — S475: concierge P2 folds (re-review of YOUR S474b findings)

Your three S474b P2s, folded:

1. **Multi-org authZ** — `app/dashboard/properties/actions.ts` `requestConciergePublish`.
   It checked role/plan against `getCurrentOrg()` (an arbitrary `.limit(1)` org) while RLS
   returns run items from ANY org in `user_org_ids()`. Now it derives `organization_id` from the
   RUN, then re-checks the role via the new **org-scoped** `getRoleForOrg(orgId)` (`lib/membership.ts`)
   AND `hasEntitlement(runOrg.plan, "listing_marketing")` for THAT exact org.
   - **Review:** confirm no residual `getCurrentOrg()` authZ path; a multi-org user can't spend org
     A's paid plan/role to unlock concierge for org B's run; `getRoleForOrg` is correctly org-scoped
     (memberships is `(organization_id, user_id)` unique).

2. **Cross-org `listing_post` integrity** — `app/dashboard/admin/concierge-actions.ts`
   `completeConciergeItem` (service-role, no RLS). The denormalized `listing_post_id` is now
   validated against the run-derived `org+property+portal` (stale/corrupt FK -> discarded +
   re-resolved); every `listing_posts` write is pinned to `org+property+portal` and **error-checked**
   (`?err=trackfail`); a portal item is NOT marked live without a valid tracker.
   - **Review:** confirm no path overwrites another org/property's post; the item can't go live if the
     tracker insert/update failed.

3. **Non-atomic desk mutations** — `claim`/`complete`/`reject` now carry `mode='concierge'` +
   `publish_status IN CONCIERGE_OPEN_STATUSES` predicates (claim also `concierge_claimed_by IS NULL`),
   `.select("id")` the affected rows, and redirect `?err=stale` on 0 rows. `completeConciergeItem`
   also early-guards before doing listing_post work.
   - **Review:** confirm two-staff double-claim / double-complete and stale-form re-open of a live item
     all resolve to 0 rows (Postgres re-evaluates the WHERE against the committed row). Note: the desk
     UI allows complete/reject without claiming (by design) — the open-status predicate is the guard,
     not claim-ownership. Flag if you'd require claim-ownership on complete.

Gates (device): tsc --noEmit clean; eslint clean; `test-distribution-concierge` 60/0 (unchanged —
`canRequestConcierge`/pure logic untouched).

---

## UNIT 2 — S476/S477: N4 notice-library (Slices A + B). NEW code.

**Posture: PREPARE-ONLY.** Nothing is wired to a route yet; `fillOfficialN4` is imported by no app
route. Serve-on-behalf (agent signer) + the operator flow are Slice C, behind the per-form
legal-verify gate (N-FORM-LIBRARY-DESIGN-2026-07-12.md section 6). So this batch changes NO running
app behaviour — review it as a library + data.

### Slice A (`aa63b1c`)
- **`supabase/migrations/0140_notices.sql`** — generic `notices` table (N4 first; N1/N5/N12/N13 in
  the type CHECK). Org-scoped RLS (`organization_id IN user_org_ids()`), `authenticated` grants, no
  `service_role` grant (prepare-only). Immutable-`snapshot` + `service_token` shape generalized from
  the `n1_*` columns.
  - **Review:** RLS parity with the other org-scoped tables (`distribution_runs`); the `service_token`
    unique index; whether leaving out a `service_role` grant is correct for now (Slice C's public
    `/notice/[token]` route will read via the admin client, which bypasses RLS anyway).
- **`lib/n4.ts`** (pure): `deriveN4TerminationDate` (RTA s.59: 14d monthly/yearly/bi-weekly, 7d
  daily/weekly — CHECKLIST values, flagged for legal-verify), `deriveN4Arrears` (charges rent per due
  period, credits period-tagged payments; **unassigned + out-of-window payments are SURFACED, NOT
  applied** so it can never overstate arrears -> void), `resolveN4OwingCents` (operator override wins).
  - **Review (highest value):** the arrears math. Is "surface but don't apply" the right conservatism?
    The net-owing floor at 0. The `firstPeriodISO` window cap. `endOfMonthISO` leap handling.

### Slice B (`132964b`)
- **`lib/forms/ltb-n4-2015.pdf`** — the Board-approved Form N4 (rev 2015-11-30), XFA-stripped +
  normalized offline (qpdf --qdf -> pdf-lib drops XFA -> recompressed, 759KB). 43 AcroForm fields.
- **`lib/forms/shared-combs.ts`** — `combAmountCents(cents, cells)` (dollar cells + blank-over-"." +
  cc; THROWS on over-wide amount) + `combDateISO` ("DD MM YYYY", blanks over "/"). Width-parameterized
  for the N4's 9/10/11-cell amounts.
- **`lib/n4-official-pdf.ts`** — `fillOfficialN4(snapshot)`. Field map verified via the spike;
  Signature/SignDate left blank (wet/e-sign); no flatten; strips LiveCycle JS. SelectSign 1=landlord /
  2=agent.
- **`lib/n4.ts`** `packN4ArrearsRows` — the **LTB 3-row overflow rule**: the form table holds only 3
  rows; the instructions say combine periods into row 1/2 but the LAST completed row must show the LAST
  period. Impl: <=3 -> one row each; >3 -> row 1 = all-but-last combined (earliest from .. second-last
  to, summed), row 2 = last period alone.
  - **Review (highest value):** does the packing satisfy the LTB instruction exactly? Edge cases: 1
    period, exactly 3, exactly 4, many. Any legal issue combining non-contiguous periods (here they're
    always contiguous monthly).
- **Comb formatters:** confirm no digit truncation (the throw), the blank-over-separator offset for the
  wider (10/11-cell) amount combs. NOTE: comb alignment was **visually verified** on a rendered sample.

Gates (device): tsc --noEmit clean; eslint clean (all touched); `test-n4` 70/0; `test-n4-pdf` 17/0
(golden field-map readback); sample PDF rendered + human-verified.

## Out of scope
- N4 Slice C (operator Prepare-N4 UI, `notices` row creation + snapshot, vault filing, e-consent, the
  legal-verify gate) — NOT built yet.
- The N1 lane (`lib/n1-official-pdf.ts`) keeps its own verified comb copies; `shared-combs.ts` is the
  go-forward shared toolkit (N1 not refactored onto it this batch — flag if you want that dedupe).
