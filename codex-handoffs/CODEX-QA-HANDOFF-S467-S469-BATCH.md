# Codex QA handoff — S467 / S468 / S469 (2026-07-12)

**Review range:** `44d1d5c..afb4e8c` on `main` (3 deploys). Last Codex-ACCEPTED point = S466 (44d1d5c).
Commits, oldest→newest:
- `d10a118` **S467** — Slice C verified vs Stripe test mode (doc-only + harness).
- `e9f4e4b` **S468** — fix blank tenant N1: service-role reads bypass Next Data Cache (KI740/KI741).
- `afb4e8c` **S469** — generate the OFFICIAL LTB Form N1 PDF from the frozen snapshot (adds pdf-lib).

All three are LIVE on app.vacantless.com. No migrations in this batch. Gates below are green.

---

## S467 — Slice C VERIFIED (doc-only) — `d10a118`
Files: `app/dashboard/tenancies/stripe-rent-actions.ts` (banner comment only), `scripts/harness-stripe-slice-c.ts` (new).
- Rewrites the stale `!!! LIVE-UNVERIFIED` banner on `updateStripeRentAmount` to a `VERIFIED (S467, …)` note,
  and adds the Stripe test-mode harness. NO runtime/behavior change.
- The harness reconstructs create → `selectActiveSchedulePhase` → two-phase update against a Stripe TEST
  sandbox on a Test Clock (13/0). It fails closed without an `sk_test_…` key.
- You (Codex) already reviewed this in-flight; the S463→S467 comment nit is fixed. **Lowest risk in the batch.**

## S468 — blank-N1 root cause + fix — `e9f4e4b`  ← primary scrutiny
Files: `lib/supabase/admin.ts`, `app/n1/[token]/route.ts`, `app/api/cron/rent-increase/route.ts`.

**Root cause (confirmed live, converged with your parallel finding):** the public `/n1/[token]` route and the
rent-increase cron read via the SERVICE-ROLE admin client. In the Next 14.2 App Router, cookieless GET fetches
(which the service-role client makes) are cached in the framework Data Cache, so those routes served FROZEN rows +
a stale `rent_guidelines` read → BLANK new rent/increase/% on the served N1. The AUTHENTICATED operator N1
(user client → cookies → never cached) rendered `$2,241.80 / 1.9%` correctly on the SAME deployment. `dynamic=
"force-dynamic"` did NOT cover the supabase-js fetches. Proven by mutating rent_cents/start_date/effective on the
QA tenancy and watching the public page stay frozen while Vercel logs showed fresh serverless exec (cache=MISS).

**The fix — please verify each:**
1. `lib/supabase/admin.ts`: `createAdminClient()` now wraps `global.fetch` to pin `cache: "no-store"` on every
   service-role fetch. → **Scrutinize:** is this the right/complete seam? Any service-role caller that RELIED on
   caching? (Sweeps run every 15 min; correctness favors fresh reads.) Type of the fetch wrapper.
2. `app/n1/[token]/route.ts`: added `export const revalidate = 0` AND Codex-P1 hardening — the legacy no-snapshot
   derive fallback now runs ONLY when `n1_served_at` is set (an UNSERVED tenancy's default `n1_service_token`
   must not surface a notice → now 404s), and it 400s instead of rendering a null-amount notice. → **Scrutinize:**
   the gate ordering (snapshot branch first, then served-gate, then status/amount), and that no legitimately-served
   pre-snapshot tenancy is wrongly 404'd.
3. `app/api/cron/rent-increase/route.ts`: `export const revalidate = 0` (belt; the admin no-store is the real fix).
   → **Scrutinize:** confirm the cron's guideline/tenancy reads are now fresh and it cannot emit stale/blank amounts.

**Live verification done:** unserved QA tenancy → 404; a written served snapshot → page renders $2,200.00 / $2,241.80 /
1.9% AND reflects DB mutations (freeze gone). QA fixture fully restored.

## S469 — official LTB Form N1 PDF — `afb4e8c`
Files (new unless noted): `lib/forms/ltb-n1-2022.pdf` (bundled template), `lib/n1-official-pdf.ts`,
`app/n1/[token]/official/route.ts`, `scripts/test-n1-official-pdf.ts`, `app/n1/[token]/route.ts` (mod: passes
`officialPdfUrl`), `lib/n1-render.ts` (mod: optional `officialPdfUrl` + print-hidden download button),
`next.config.mjs` (mod: `experimental.outputFileTracingIncludes`), `package.json`/`package-lock.json` (adds pdf-lib).

- `lib/forms/ltb-n1-2022.pdf` is the gov Form N1 v.01/04/2022, PRE-CLEANED OFFLINE (hybrid AcroForm+XFA; XFA
  stripped + structure normalized so pdf-lib can parse/fill it — raw template = 0 fields in pdf-lib). Bundled into
  the official-N1 serverless fn via `outputFileTracingIncludes: { "/n1/[token]/official": [".../ltb-n1-2022.pdf"] }`.
  → **Scrutinize:** is the tracing key correct for a route handler? (Post-deploy the route returned a real PDF, so
  tracing worked in prod — but confirm the key form is robust across Next 14.2.)
- `fillOfficialN1(snapshot)`: pdf-lib fill. **Comb-aware formatters** — `StartDate` (10-cell, "/" pre-printed at
  cells 3&6) and `RentIncAmount1/2` (9-cell, "." pre-printed at cell 7) get POSITIONAL strings with a BLANK at the
  separator cell, so nothing doubles (this fixed a real "cents in twice" bug). Radios/`Check1` selected via
  `getOptions()[0]` = the first (month / landlord / guideline) option of the FROZEN template. Throws LOUD if the
  template is missing (never a silent blank legal form). → **Scrutinize:** the `getOptions()[0]` assumption (it
  depends on the frozen template's option order — safe because the template is version-pinned, but flag if fragile);
  comb math for edge amounts (>$999,999.99 truncates dollars to 6 cells); the `"setText"/"select" in f` casts.
- `app/n1/[token]/official/route.ts`: public download keyed by `n1_service_token`, built ONLY from a served
  snapshot with a real amount (else 404). `revalidate=0`, `runtime=nodejs`. → **Scrutinize:** same token-scoping
  posture as `/n1/[token]`; no info leak; the 404 conditions.

**Known/among-us item (your call):** the generated PDF is NOT flattened. Values are correct and render in all real
viewers (browser/Preview/Adobe — XFA was stripped so Adobe uses the AcroForm layer), but text-EXTRACTORS don't read
AcroForm appearance streams (that's why a WebFetch text-scrape looked "blank"). Proposed **S470: `form.flatten()`**
so the served notice is locked + renders/extracts identically everywhere. Verified locally that flatten renders
perfectly and pdf-lib round-trips it clean (fitz emits benign xref warnings). Not shipped yet — advise.

---

## Gates (green on device, 2026-07-12)
- tsc `--noEmit` clean; eslint clean on all changed files (per-deploy).
- S468: guideline-lookup 7/0, n1-snapshot 19/0, n1-render 33/0, rent-increase 38/0, sweep 18/0, renewal 42/0.
- S469: **test-n1-official-pdf 8/0** (pure comb formatters + end-to-end fill asserts field values against the
  bundled template), test-n1-render 33/0, n1-snapshot 19/0. Also validated the fill in the Cowork cloud with
  pdf-lib 1.17.1 against the committed template (8/0) + rendered both pages.

## Cleanup nit (not in this batch)
`vacantless-app/__n1test.ts` and `vacantless-app/__deriv.ts` are stale scratch files from the S463 debug session,
still untracked at the repo root. Safe to delete.

## Lessons recorded (memory)
- KI741: in the Next App Router, a SERVICE-ROLE (cookieless) supabase client's reads are eligible for the fetch
  Data Cache and `force-dynamic` does not reliably opt them out — pin `cache:"no-store"` on the admin client.
- LTB-N1-OFFICIAL-FORM-FILL-SPIKE-2026-07-12.md — field map + comb gotchas + build plan (repo/project root).
