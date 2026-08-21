# CODEX — Confirm campaign step count + whether Paul gets daily catch-up touches (S608, READ-ONLY)

**Task:** READ-ONLY investigation + written report. Do NOT change code, do NOT ship anything, do NOT manually fire `/api/cron/landlord-campaign` (it bypasses the cadence gate and cascades).

## Why
The landlord campaign flag flipped 2026-08-01, but the orgs were created weeks earlier. Cadence for step ≥ 1 is anchored to `organizations.created_at` (`campaignStartMs`), and `landlord_campaign_last_sent_at` only enforces the 24h MIN gap when non-null. So an org whose `created_at` predates the full cadence window has ALL its step anchors in the past, meaning its remaining steps are gated only by the 24h min gap → potentially ~one touch per day (catch-up), not weekly.

**Paul Peretz** (org `ee112b4d...`) is the org to check: `created_at` 2026-06-26, `landlord_campaign_step_sent=2`, `landlord_campaign_last_sent_at` 2026-08-01 00:54 UTC. His cadence anchors (created_at + 7/14/21/28d = Jul 3/10/17/24) are all in the past.

## Questions to answer (from the code — this is the same step/cadence engine as `/api/cron/landlord-campaign`)
1. **How many steps does the campaign have total (the `max`)?** List the ordered steps and each one's step-type (e.g. `rent_increase_confirm`, `rent_collection`, …) and cadence day.
2. **Is Paul at `step_sent=2` already at `max` (campaign complete for him), or does he have remaining steps?**
3. **If he has remaining steps:** for each, does it SEND for a first-year org like Paul, or does it SKIP (and does the skip advance without consuming the 24h gap)? Walk Paul's journey forward from now and give the concrete dates + content of any further emails he would receive on the natural cron.
4. Same one-line forward-walk for **David** (`baa9410d`, created 2026-07-28, step_sent=1) and **Mahmood** (`f7d00035`, created 2026-07-29, step_sent=1, last_sent NULL) so we have the full expected send schedule for all three.

## Deliverable
A short written report: the step list + `max`, and a dated forward schedule per org (David / Mahmood / Paul) of exactly which emails will send on the natural cron and when. No code changes.
