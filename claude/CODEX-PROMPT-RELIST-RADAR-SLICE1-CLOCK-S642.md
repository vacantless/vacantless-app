# CODEX PROMPT — Relist Radar Slice 1: Own the clock (S642)

**Repo:** `vacantless-app`. **Branch from:** current prod `main` (SHA `45cad2f`).
**Flag:** `RELIST_RADAR_CLOCK_ENABLED` (env, default unset/false). All new behavior is dead code
until this is `"true"`. Ship dark.
**Design of record:** `claude/DESIGN-RELIST-RADAR-EXPIRY-AUTOREFRESH-S642.md`. Full slice plan:
`claude/CODEX-PROMPT-RELIST-RADAR-SLICES-1-3-S642.md`. This prompt is Slice 1 only.

**Goal:** stop depending on portal expiry emails. Compute each portal ad's expiry from OUR own
post-time data, and have the existing daily reminder scan *detect* near-expiry vacant listings. No
email, no reposting in this slice — just the clock + detection.

---

## Read before editing (do NOT blind-rewrite)
- The **KI1005 listing-health reminder cron** (daily 10am ET "your ad needs a refresh" digest) —
  the job we EXTEND, not replace. Grep for its scan/scheduler + email builder; add a detection pass,
  don't fork a second cron.
- `lib/distribution-channels.ts` — channel defs; you'll add per-portal TTL + free/paid class.
- The live-mark paths that set an item's `external_url`: `completeConciergeItem`
  (`app/dashboard/admin/concierge-actions.ts`) and any API-autofire live-mark path
  (`lib/channel-publish-autofire.ts` / `postFacebookPageNow` / `postInstagramNow` completion). These
  are where you stamp post-time/expiry.
- `LEASEUP_TAKEDOWN_ENABLED` take-down path — the scan's LEASED branch defers to it (existing; no
  change here, just don't refresh-detect leased units).
- Confirm the correct table for a live-portal posting record (distribution run item vs
  `distribution_channel_accounts` posting row) before adding columns.

## Settings store (create additively; defaults when unset)
Add a `relist_radar_settings` per-org store (a per-org row, or a JSONB column on the existing org
settings table — pick what matches the codebase). Slice 1 only needs to READ `notify_lead_days`
(default **3**). Seed the full default set so later slices can read it:
`notify_lead_days=3`, `refresh_now_semantics=confirm_run_on_scheduled_day`,
`free_skip_behavior=last_chance_then_lapse`, `paid_lapse_followup=nudge`,
`execution_time=expiry_day_morning`, `email_grouping=combined_per_property`,
`autopilot_receipt=monthly`. Unset ⇒ defaults; never hardcode these as constants.

---

## Build steps

1. **Migration — additive, nullable, no backfill.** On the live-portal posting record add:
   `external_posted_at timestamptz null`, `external_expires_at timestamptz null`. Plus the
   `relist_radar_settings` store above. Safe, defaulted, no data migration.

2. **Per-portal TTL + class** in `lib/distribution-channels.ts`: add `ttlDays: number | null` and
   `paid: boolean` to each channel def. Kijiji = `{ ttlDays: 60, paid: false }`. Fill known paid
   TTLs; leave unknown TTLs `null` (those portals just don't get a computed expiry yet).

3. **Stamp at post time.** Wherever an item is marked live with an `external_url`, set
   `external_posted_at = now()` and, when the channel's `ttlDays` is known,
   `external_expires_at = now() + ttlDays days`. Idempotent (don't overwrite an existing
   `external_posted_at` on a re-mark unless it's a genuine fresh post).

4. **Extend the KI1005 scan — detection only.** In the existing daily job add a pass: for each live
   item with a known `external_expires_at`, compute days-to-expiry and classify:
   - unit **LEASED** → leave to the existing take-down branch; do not refresh-detect.
   - unit **AVAILABLE** and days-to-expiry ≤ `notify_lead_days` → record a `radar_candidate`
     (structured log line AND a dark `relist_radar_events` row: item, portal, org, expires_at,
     paid/free, detected_at).
   - else → nothing.
   Idempotent + single-flight per item+cycle (a per-cycle marker so a re-run never double-records).

---

## Fail-closed / invariants
- Flag off ⇒ **zero** behavior change; the reminder cron runs exactly as today.
- No email, no repost, no user-facing change in this slice — detection + data only.
- Leased units are never refresh-detected (take-down owns them).
- Reads `notify_lead_days` from settings, not a constant.

## Acceptance
1. Flag off ⇒ byte-for-byte current cron behavior; no new emails/actions.
2. Flag on, **test org `8ea1da48-0cd2-45a4-bfba-023b31a67884` only (never Agile `921f7c08`)**: a
   newly live portal post stamps `external_posted_at` + `external_expires_at` (Kijiji = +60d); the
   daily scan records `radar_candidate` rows for exactly the AVAILABLE items within 3 days of
   expiry; leased and out-of-window items are excluded; unknown-TTL portals are skipped cleanly.
3. `npx tsc --noEmit` clean on device.
4. Unit test the days-to-expiry classifier: in-window / out-of-window / leased / unknown-TTL /
   already-expired.
5. `smoke:*` run in the cloud (not device_bash — the box VM has no network).

_Standing: builds go to Codex; gh not on the Mac (merge via GitHub web/Chrome); prod SHA `45cad2f`;
no em dashes in user-facing copy. Slices 2 (email surface) and 3 (free execution) follow — do not
build them here._
