# CODEX — Fix the landlord-campaign cadence anchor so late-enrolled/old orgs don't burst (S608)

**Noam approved the fix direction (S608).** Build it, then show Noam the diff + test output BEFORE pushing to main — this is a live-behavior change to real landlord sends.

## Problem (confirmed live)
Cadence for the landlord campaign anchors each step to `organizations.created_at` (`campaignStartMs` in `lib/landlord-campaign.ts`). The campaign flag (`LANDLORD_CAMPAIGN_ENABLED`) only flipped 2026-08-01, but orgs were created weeks earlier. For any org whose `created_at` predates the full 28-day cadence window, ALL step anchors are already in the past, so on the natural cron its remaining steps are gated only by the 24h min gap → it BURSTS ~one email per day instead of the intended weekly [0,7,14,21,28]d spacing.

- Confirmed repro: **Paul Peretz** (org `ee112b4d...`, `created_at` 2026-06-26, `step_sent=2`) would have sent `tax_export` (~Aug 2), `listing_marketing` (~Aug 3), `upgrade_ask` (~Aug 4) on consecutive days.
- **Stopgap already applied:** Paul is currently `landlord_campaign_opted_out=true` (set via SQL 2026-08-01) so nothing fires while this is built. `step_sent` is preserved at 2. Do NOT change Paul's row — re-inclusion is a separate signed-off step AFTER this ships.

## Fix requirement
Anchor the cadence to **`GREATEST(created_at, CAMPAIGN_START)`** instead of `created_at` alone, where `CAMPAIGN_START` = the date the campaign became active (2026-08-01). Pick the cleanest mechanism:
- Preferred (minimal): a single configurable `CAMPAIGN_START` constant/env (default `2026-08-01T00:00:00Z`) used in the anchor calc.
- Or (more correct, if you'd rather): a per-org `landlord_campaign_started_at` timestamp stamped when an org first becomes a candidate, anchoring to that. Migration + backfill if so. Your call — state which you chose and why.

Net effect: every org's steps space weekly from `max(its creation, campaign start)`. Old orgs (Paul) space weekly from the flip; recent orgs are unchanged.

## Must-not-break
- Orgs created AFTER `CAMPAIGN_START` (David `baa9410d` created 2026-07-28, Mahmood `f7d00035` created 2026-07-29): `GREATEST` picks `CAMPAIGN_START` for both since they predate the flip by a few days — acceptable, it just spaces them weekly from Aug 1 (David rent_collection ~Aug 8, Mahmood ~Aug 8, etc.). Confirm this is the intended read and note it. Truly-later orgs (created after Aug 1) must anchor to their own `created_at`.
- The first-year skip of `rent_increase_confirm` (advance step_sent without stamping `last_sent_at`) must still work.
- The 24h min-gap (when `last_sent_at` is non-null) and 120d max-age gates unchanged.
- `?dry=1` (just fixed in 7b4b778) must still reflect the corrected schedule.

## Test (focused, required)
Add/extend a test in the campaign test suite (`scripts/test-landlord-campaign.ts` or wherever the step engine is unit-tested) proving:
1. **Old org** (created well before `CAMPAIGN_START`, e.g. Paul's shape: created 2026-06-26, step_sent=2) → next step (`tax_export`) is due at `CAMPAIGN_START + 14d`, NOT within 24h. The remaining steps land ~weekly, not daily.
2. **Recent org** (created after `CAMPAIGN_START`) → anchored to its own `created_at`, spacing unchanged from today's behavior.
3. Existing suite still green (currently 76/0), `tsc --noEmit` clean, lint clean.

## Deliverable
One commit (`fix(campaign): anchor cadence to max(created_at, campaign_start) to prevent catch-up bursts`) + the test. Show Noam the diff + test output before pushing. Do NOT manually fire `/api/cron/landlord-campaign`.

## After it ships (Cowork/Noam, not this ticket)
Re-include Paul: `update organizations set landlord_campaign_opted_out=false where id='ee112b4d-49f1-4b07-bcf9-04d3c7c2876c';` — he'll then resume `tax_export` at `CAMPAIGN_START + 14d` (~Aug 15), properly spaced.
