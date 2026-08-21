# CODEX PROMPT — Relist Radar Slice 2b: wire the actual email send (S642) — APPROVED

**Repo:** `vacantless-app`. **Target branch:** add a commit to **`codex/s642-relist-radar-email`**
(`5bfa23c`) so the email surface merges as one coherent slice.
**Flag:** `RELIST_RADAR_EMAIL_ENABLED` (env, default off). Ship dark.
**Explicit approval granted (Noam, 2026-08-11):** wiring the cron to send Relist Radar emails
containing property/listing expiry details is approved, on the **staged test-org QA** plan below.
The safety reviewer's hold is lifted for this specific wiring.

**Goal:** connect the already-built Slice 2 substrate (decision store, tokens, email-builder copy,
registered notification events) to the existing notification **send** path so the freshness cron
actually dispatches the three Relist Radar emails — still dark, still test-org scoped, still
record-intent-only (no repost, no charge).

---

## Read before editing
- Slice 2 substrate (this branch): `lib/relist-radar.ts` (email builder copy,
  `createRelistRadarDecisionToken`, `relistRadarDecisionTokenHash`, the omission helper), migration
  0212 (`relist_radar_events` sent-stamps + `relist_radar_decision_tokens`), the decision route.
- The registered events: `leasing.relist_radar`, `leasing.relist_radar_last_chance`,
  `leasing.relist_radar_paid_lapse` in `lib/notifications.ts`.
- **The existing notification dispatch/send path** that `leasing.listing_health` already uses to
  email operators from the freshness cron — reuse it verbatim; do NOT build a new mailer.
- Slice 1 detection pass in `app/api/cron/distribution-freshness/route.ts` — the send passes run in
  the same cron, gated by `RELIST_RADAR_EMAIL_ENABLED`.
- `RELIST_RADAR_TOKEN_SECRET` (fallback `CRON_SECRET`) — the token-signing secret; the send path
  needs it set to mint links.

## The three send passes (all gated on `RELIST_RADAR_EMAIL_ENABLED` + test-org scope, idempotent via sent-stamps)

1. **Notice email (3 days out).** Select `relist_radar_events` where `event_type='radar_candidate'`,
   `notice_sent_at IS NULL`, `decision IS NULL`, org = `RELIST_RADAR_TEST_ORG_ID` (never Agile).
   Group per property (`email_grouping='combined_per_property'`). For each in-window portal row:
   omit free portals whose account has the **standing auto-refresh consent** (see schema note
   below); for the rest, mint a decision token per offered action
   (`createRelistRadarDecisionToken` → insert the **hash** row into `relist_radar_decision_tokens`),
   build the free/paid row copy (en + fr) from the Slice 2 builder, render subject/body through the
   `leasing.relist_radar` event, and dispatch via the existing notification send path to the org's
   operator/listing-lane recipients. Stamp `notice_sent_at = now` on every event included. One email
   per property per cycle (the stamp is the idempotency guard).

2. **Last-chance email (expiry eve).** Free events with `decision='skipped'`,
   `last_chance_sent_at IS NULL`, expiry within one day. Mint `keep_live` / `let_expire` tokens,
   render `leasing.relist_radar_last_chance`, send, stamp `last_chance_sent_at`.

3. **Paid-lapse nudge (post-expiry).** Paid events with `decision IS NULL`,
   `lapse_nudge_sent_at IS NULL`, past expiry. Set `decision='no_response'`, mint a `consent` token,
   render `leasing.relist_radar_paid_lapse`, send, stamp `lapse_nudge_sent_at`.

## Schema note (correction — do NOT use `autopilot_publish_authorized`)
That column does not exist. The real per-channel consent columns are on
`distribution_channel_accounts` (migration 0177): **`automation_authorized`** (worker may act on
this channel) and **`auto_submit_allowed`** (may act without a per-action human approval). For "this
free portal is standing hands-off, omit it from the notice email," key on
`automation_authorized === true && auto_submit_allowed === true`. If product later wants a
refresh-specific consent distinct from initial-publish auto-submit, that's a new column in a later
slice — for now reuse these two. (Slice 3 will use the same corrected flags.)

## Fail-closed / invariants
- Flag off ⇒ no radar email; the existing `listing_health` digest is unchanged.
- Test org only; never Agile `921f7c08`.
- Record-intent-only: no repost, no charge, no external portal action anywhere in this slice.
- Tokens single-use (hash stored, raw only in the link); sends idempotent via the `*_sent_at`
  stamps; en + fr both render; no em dashes in copy.

## Staged test-org QA acceptance
0. **Prereq:** confirm the test org's operator/listing-lane notification recipient is Noam's inbox
   (so the QA email actually lands where he can see it), and `RELIST_RADAR_TOKEN_SECRET` is set.
1. Flag off ⇒ cron sends no radar email (regression clean).
2. Flag on, test org, with a seeded near-expiry AVAILABLE Kijiji item: running the cron sends **one
   real combined per-property email** to the test recipient — free row shows Skip + Manage, (if a
   paid item is seeded) paid row shows "Refresh for $X" + Manage; en + fr render; subject/body come
   from the registered events.
3. Clicking a link hits `/api/relist-radar/decision/[token]`, records the decision, and a second
   click / forwarded copy is rejected (used/tampered/expired). No repost or charge occurred.
4. Re-running the cron does NOT re-send the same cycle's email (sent-stamp idempotency).
5. `npx tsc --noEmit`, `npm run lint`, `npm run build` clean; token/copy unit tests still green;
   `smoke:*` in the cloud.

_Merge order: this rides the `codex/s642-relist-radar-email` branch, which is stacked on Slice 1
(`codex/s642-relist-radar-clock`). Merge Slice 1 to main first, then retarget this branch's PR base
to main and merge. Keep the flag OFF in prod until the test-org QA above is eyeballed._
