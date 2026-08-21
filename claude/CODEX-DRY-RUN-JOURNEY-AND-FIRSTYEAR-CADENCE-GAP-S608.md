# CODEX — Fix ?dry=1 to simulate the full journey + investigate the first-year cadence gap (S608)

**Task:** (A) Make the landlord-campaign `?dry=1` preview simulate the FULL multi-step journey. (B) Investigate + **REPORT** a suspected cadence-anchor gap for first-year orgs. **TWO SEPARATE commits; do NOT change live send behavior without Noam's sign-off.**

## Repo context (paths are best-guess — verify by reading the code before editing)
- Route: `app/api/cron/landlord-campaign/route.ts`. The GitHub Action (`reminders.yml`, ~every 15 min) drives it. It has a `?dry=1` preview mode and a `test_to`/`test_org` path.
- Org campaign columns: `landlord_campaign_step_sent` (int), `landlord_campaign_last_sent_at` (timestamptz), `landlord_campaign_opted_out` (bool), `landlord_campaign_email` (text).
- Step model: ordered touches. step 0 = `rent_increase_confirm`, next step = `rent_collection`. Cadence spacing `[0,7,14,21,28]` days, 24h min between sends, 120d max age. Candidate query = `plan='free' AND opted_out=false AND step_sent<max AND fresh`; recipient = `landlord_campaign_email` (skip null).
- First-year orgs (tenancy < ~12mo) can't take an increase, so at step 0 they evaluate as skip (reason like `skipped:no_unconfirmed_rent_units`) and ADVANCE past step 0 to the `rent_collection` step.

## PART A — fix the dry-run (preview-only, SAFE to ship)
- **Problem:** `?dry=1` only evaluates each org's CURRENT step. A first-year org at step 0 is reported `skipped:no_unconfirmed_rent_units` and the preview STOPS — it does not simulate the skip-advance, so it hides that the org will actually send `rent_collection` at the next step. This made a human read "David only" when the real live audience was David + Paul + Mahmood.
- **Fix:** in dry mode, simulate the whole journey per candidate org — walk the steps the way a real sequence of cron runs would (same skip/advance rules) — and report the terminal ACTION each org would take (e.g. "would send: rent_collection") plus the intermediate skips, not just the first step's skip.
- **Acceptance:** `?dry=1` lists, per candidate org, WHICH email would be sent and at which step. First-year orgs show `rent_collection`, mature orgs show `rent_increase_confirm`. No org that would eventually send is reported as a bare "skipped".
- **Commit A independently.** Preview output only, no live sends.

## PART B — investigate the cadence-anchor gap (READ-ONLY + report; do NOT ship a live change yet)
- **Observed in prod 2026-08-01:** first-year org **Mahmood** (org `f7d00035...`, tenancy start 2026-08-01) skip-advanced to `step_sent=1` but has `landlord_campaign_last_sent_at = NULL`, and did NOT send `rent_collection` across ≥2 natural cron runs (03:49 + 11:40 UTC). **Paul** (org `ee112b4d...`, first-year, tenancy start 2026-03-01) DID send `rent_collection` — but ONLY because the cron was MANUALLY fired during S607 testing (manual firing bypasses the cadence gate), which set his `last_sent_at`.
- **Hypothesis to confirm or refute in the code:** when a first-year org skip-advances to step 1 WITHOUT setting `last_sent_at`, the "is it due?" check for step ≥ 1 has no anchor to measure the 7-day spacing from, so on the natural cron it never becomes due — i.e. first-year orgs would SILENTLY never get their `rent_collection` touch on the natural rail.
- **Do:** read the exact due/cadence logic. Determine precisely what anchor step ≥ 1 uses when `last_sent_at` is null. State definitively whether Mahmood will EVER send `rent_collection` on the natural cron, and if not, why.
- **Report back BEFORE changing live behavior:** root cause in one paragraph + proposed fix (e.g. set `last_sent_at` when skip-advancing, OR anchor cadence to org enrollment/`created_at`, OR treat null `last_sent_at` at step ≥ 1 as due). Recommend the least-blast-radius option.
- **Do NOT ship the live-behavior fix until Noam signs off** (this changes real sends to real landlords). **Do NOT manually fire** `/api/cron/landlord-campaign` to test — it cascades. Reason from the code + a dry run / local test.

## Deliverables
- Commit A (dry-run fix, pushed).
- A written root-cause + fix proposal for B (no live commit yet).
