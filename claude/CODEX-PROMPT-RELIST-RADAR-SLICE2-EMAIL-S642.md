# CODEX PROMPT — Relist Radar Slice 2: notify + consent surface (S642)

**Repo:** `vacantless-app`. **Branch from:** `main` **after Slice 1 (+ the exactString fix) has
merged** — Slice 2 relies on the settings resolver actually reading string settings from the DB.
**Flag:** `RELIST_RADAR_EMAIL_ENABLED` (env, default off). Ship dark; execution stays dark (links
record intent only — no reposting in this slice; that's Slice 3).
**Design of record:** `claude/DESIGN-RELIST-RADAR-EXPIRY-AUTOREFRESH-S642.md`. Full slice plan:
`claude/CODEX-PROMPT-RELIST-RADAR-SLICES-1-3-S642.md`.

**Goal:** turn the Slice 1 `relist_radar_events` `radar_candidate` rows into ONE combined
per-property email whose per-portal rows speak the right consent language, with secure one-click
links that record a decision. No repost yet.

---

## Read before editing (build on Slice 1, don't duplicate)
- `lib/relist-radar.ts` (Slice 1) — settings resolver, classification, `RELIST_RADAR_TEST_ORG_ID`,
  `relistRadarOrgAllowed`. Reuse; do not re-implement.
- `supabase/migrations/0211_relist_radar_clock.sql` — `relist_radar_events` (the candidate log),
  `relist_radar_settings`. Slice 2 reads candidates and records decisions.
- `app/api/cron/distribution-freshness/route.ts` — the Slice 1 detection pass. The email build runs
  from here (or a sibling cron the same job invokes); reuse `RELIST_RADAR_EMAIL_ENABLED` gate.
- The **KI1005 listing-health email builder / templates** (en + fr) the freshness cron already uses
  to send digests — extend these; do not fork a new mail path.
- `lib/distribution-channels.ts` — `paid` / `ttlDays` metadata + channel display names.
- CUT1 in-app relist surface (`RELIST_ONE_TAP_ENABLED`, `#distribute` / `#for-you-{key}`) — the
  "Manage" link target.

## Read settings (now that exactString is fixed)
`resolveRelistRadarSettings` for the org: use `notify_lead_days`, `email_grouping`
(`combined_per_property`), `paid_lapse_followup` (`nudge`), `free_skip_behavior`
(`last_chance_then_lapse`). Never hardcode — read from the row, defaults when unset.

---

## Build steps

1. **Migration (additive):** a per-cycle decision store — either extend `relist_radar_events` with
   `decision text` (`skipped | paid_consented | kept_live | let_expire | no_response`),
   `decided_at timestamptz`, `decided_via text`, or a sibling `relist_radar_decisions` keyed by the
   same `(run_item_id, cycle_date)`. Keep the Slice 1 idempotency key intact. Nullable, no backfill.

2. **Signed one-click tokens:** HMAC-signed (reuse the app's existing token/secret util if there is
   one — grep `app/job/[token]` and any `signToken`/`hmac` helper), bound to
   `{ run_item_id, portal, action, cycle_date }`, single-use, short TTL. Actions: `skip` (free
   veto), `consent` (paid money-yes), `keep_live` (free last-chance yes), `let_expire`. A server
   route (e.g. `app/api/relist-radar/decision/[token]/route.ts`) validates + **burns** the token,
   records the decision on that item's cycle, and shows a tiny confirmation page. A reused or
   forwarded/tampered token is rejected. **No execution — record intent only.**

3. **Combined email builder** (extend the freshness/listing-health mailer; en + fr), grouped one
   email per property (`email_grouping`), each in-window portal a row:
   - **Free row:** "<Portal> ad for <address> expires <date>. We'll refresh it automatically that
     morning." Buttons: **Skip this one** (`skip`) · **Manage** (→ CUT1 `#distribute`). No
     "refresh now" button — silence already refreshes on the scheduled morning.
   - **Paid row:** "<Portal> ad expires <date>. Refresh for $<price>?" Buttons: **Refresh for
     $<price>** (`consent`) · **Manage**. Copy states the charge + repost run on the expiry-day
     morning, not at click time.
   - Omit free portals that have the standing autopilot toggle ON (Slice 3 owns those + the monthly
     recap).
   Send at `notify_lead_days` before expiry (default 3). Idempotent per property per cycle (don't
   re-send the same cycle's email).

4. **Last-chance + paid-lapse-nudge (send, still no repost):**
   - Free item marked `skipped` that reaches expiry eve → one **last-chance** email ("expires
     tomorrow — [Keep it live] (`keep_live`) · [Let it expire] (`let_expire`)"). Honors
     `free_skip_behavior = last_chance_then_lapse`.
   - Paid item at expiry with `no_response` → post-expiry **"repost for $<price>?"** nudge
     (`paid_lapse_followup = nudge`).

5. **No money is spent and nothing is reposted in Slice 2.** All buttons only record a decision
   state for Slice 3 to consume. Gate everything on `RELIST_RADAR_EMAIL_ENABLED`; keep the Slice 1
   test-org scoping (`RELIST_RADAR_TEST_ORG_ID`, exclude Agile `921f7c08`).

---

## Fail-closed / invariants
- Flag off ⇒ no radar email, zero change to the existing freshness/health digest.
- Tokens single-use + tamper-evident; a forwarded email cannot act on another listing or fire twice.
- Free-autopilot portals are omitted from the email (no double-handling with Slice 3).
- Still no execution/charge anywhere in this slice.
- Test org only; no em dashes in user-facing copy; en + fr both render.

## Acceptance
1. Flag off ⇒ no radar email; existing digest unchanged.
2. Flag on, test org: a `radar_candidate` produces the correct combined per-property email; free vs
   paid rows render the right copy + buttons; each button records the right decision state; a
   reused/forwarded/tampered token is rejected; free-autopilot portals are omitted.
3. Last-chance email fires for a `skipped` free item at expiry eve; paid `no_response` gets the
   post-expiry nudge.
4. `npx tsc --noEmit` clean; `npm run lint` clean; unit tests for token sign/verify/burn and for
   per-portal copy/branch selection (free vs paid, autopilot-omitted).
5. `smoke:*` in the cloud, not device_bash.

_Standing: builds go to Codex; gh not on the Mac (merge via GitHub web/Chrome); prod SHA at Slice-2
branch time = main after Slice 1 merge; no em dashes. Slice 3 (free execution + standing toggle) is
next — do not build it here._
