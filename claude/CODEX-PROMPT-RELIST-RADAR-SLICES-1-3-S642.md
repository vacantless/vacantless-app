# CODEX PROMPT — Relist Radar, Slices 1–3 (S642)

**Repo:** `vacantless-app`. **Branch from:** current prod `main` (SHA `45cad2f`).
**Design of record:** `claude/DESIGN-RELIST-RADAR-EXPIRY-AUTOREFRESH-S642.md` — read it first.
**Ship each slice behind its own dark flag; each is independently dispatchable + provable.**

Relist Radar = Vacantless owns each portal ad's expiry clock from OUR data, warns 3 days before,
then refreshes free portals automatically (with a veto) or on affirmative money-consent for paid
ones, executing the repost on the expiry-day morning. This handoff covers Slices 1–3 (Slice 4 =
paid execution, depends on Phase 2 `WORKER_PAY_ONFILE`, out of scope here).

**Read before editing (exact anchors, do not blind-rewrite):**
- The KI1005 listing-health reminder cron (daily 10am ET digest) — the job we extend, not replace.
  Grep for the existing reminder scan/scheduler and its email builder.
- `lib/distribution-channels.ts` — channel defs (add per-portal TTL + `paid`/`free` classification).
- `RELIST_ONE_TAP_ENABLED` / CUT1 header CTA (`section-deeplink-opener.tsx`, `#distribute` /
  `#for-you-{key}` anchors) — the email "Manage" link targets this in-app surface.
- `LEASEUP_TAKEDOWN_ENABLED` take-down path — the scan's LEASED branch reuses it.
- Concierge lifecycle: `requestConciergePublish` → `authorizeAutopilotSubmit`
  (`distribution-actions.ts`) → worker `claimApprovedJob` → `completeConciergeItem`
  (`admin/concierge-actions.ts`); `distribution_publish_attempts` audit rows. A refresh re-drives
  this lifecycle for an already-live item.
- `distribution_channel_accounts.autopilot_publish_authorized` (per org+channel standing consent).
- The S642 Kijiji `attemptFreePlan` worker path (separate `vacantless-worker` repo) — the free
  execution muscle Slice 3 enqueues.

---

## Settings-driven config (applies to all slices)

Every tunable is a **per-org setting with a decided default**, never a hardcoded constant. Read from
a `relist_radar_settings` row/JSON (create it additively); apply the default when unset. The editing
UI is a later slice — ship the defaults now.

| Setting | Default |
|---|---|
| `notify_lead_days` | 3 |
| `refresh_now_semantics` | `confirm_run_on_scheduled_day` |
| `free_skip_behavior` | `last_chance_then_lapse` |
| `paid_lapse_followup` | `nudge` |
| `execution_time` | `expiry_day_morning` |
| `email_grouping` | `combined_per_property` |
| `autopilot_receipt` | `monthly` |
| standing autopilot (free) | off / opt-in (per org+channel) |

---

## SLICE 1 — Own the clock (flag: `RELIST_RADAR_CLOCK_ENABLED`, default off)

**Goal:** stop depending on portal expiry emails; compute expiry from our own post-time data, and
have the daily scan *detect* near-expiry vacant listings (no email, no execution).

1. **Migration (additive, nullable, no backfill):** add to the live-portal item row (the
   distribution run item / channel-account posting record — confirm the right table on read):
   `external_posted_at timestamptz null`, `external_expires_at timestamptz null`. Also add a
   `relist_radar_settings` store (per-org row or a JSONB column on the org settings table) holding
   the table above; unset ⇒ defaults.
2. **Per-portal TTL:** add a `ttlDays` (and `paid: boolean`) field to each channel def in
   `lib/distribution-channels.ts`. Kijiji free `ttlDays: 60, paid: false`. Fill known paid TTLs;
   leave unknowns null (those portals simply don't get a computed expiry yet).
3. **Stamp at post time:** where an item is marked live with an `external_url`
   (`completeConciergeItem` and any API-autofire live-mark path), set `external_posted_at = now()`
   and `external_expires_at = now() + ttlDays` when `ttlDays` is known.
4. **Extend the KI1005 scan:** in the existing daily job, add a pass that, for each live item with a
   known `external_expires_at`, computes days-to-expiry and classifies: LEASED → (take-down branch,
   existing); AVAILABLE + within `notify_lead_days` → **log a `radar_candidate`** (structured log /
   a dark `relist_radar_events` row); else nothing. **No email, no repost in this slice.**
   Idempotent + single-flight per item+cycle (a per-cycle marker so re-runs never double-log).

**Acceptance:** flag off ⇒ zero behavior change. Flag on ⇒ new live posts stamp
`external_posted_at`/`external_expires_at`; the daily scan logs the correct set of near-expiry
AVAILABLE items on the test org (`8ea1da48`, never Agile `921f7c08`); leased units are excluded;
`npx tsc --noEmit` clean; unit test the days-to-expiry classifier (in-window / out-of-window /
leased / unknown-TTL).

---

## SLICE 2 — The notify + consent surface (flag: `RELIST_RADAR_EMAIL_ENABLED`, default off)

**Goal:** turn `radar_candidate`s into one combined per-property email whose per-portal rows speak
the right consent language, with secure one-click links that record intent. Execution stays dark
(links record the decision; nothing reposts yet).

1. **Tokenized links:** HMAC-signed, single-use, short-TTL tokens bound to `{item_id, portal,
   action, cycle}`. Actions: `skip` (free veto), `consent` (paid money-yes), `keep_live` (free
   last-chance yes), `let_expire`. A server route validates + burns the token and records the
   decision on the item's cycle. A forwarded email cannot repost another listing or fire twice.
2. **Combined email builder** (extend the KI1005 email templates; en + fr): one email per property
   grouping all in-window portals. Per-portal row copy:
   - **Free:** "<Portal> ad for <address> expires <date>. We'll refresh it automatically that
     morning." Buttons: **Skip this one** (`skip`) · **Manage** (→ CUT1 `#distribute`). No "refresh
     now" button (silence already refreshes on the scheduled morning).
   - **Paid:** "<Portal> ad expires <date>. Refresh for $<price>?" Buttons: **Refresh for $<price>**
     (`consent`) · **Manage**. Copy states the charge + repost run on the expiry-day morning.
   - Free portals with standing autopilot ON are omitted from the email.
3. **Decision capture states** (on the item's cycle record): `skipped`, `paid_consented`,
   `kept_live`, `let_expire`, or `no_response`. No execution yet — Slice 3 consumes these.
4. **Last-chance + lapse-nudge scaffolding (send, still no repost):** if a free item is `skipped`
   and reaches expiry eve, send the last-chance email ("expires tomorrow — Keep it live / Let it
   expire"). If a paid item hits expiry `no_response`, send the post-expiry "repost for $X?" nudge.
   Gate all of this on `RELIST_RADAR_EMAIL_ENABLED`; honor `email_grouping` + `notify_lead_days`
   from settings.

**Acceptance:** flag off ⇒ no radar email. Flag on ⇒ correct combined email on the test org with
working, single-use, tamper-evident links; each button records the right decision state; a reused/
forwarded token is rejected; free-autopilot portals are omitted; last-chance + paid-nudge emails
fire at the right cycle points; en + fr render; `tsc` clean; unit tests for token sign/verify/burn
and for the per-portal copy/branch selection.

---

## SLICE 3 — Free execution + standing toggle (flag: `RELIST_RADAR_EXECUTE_FREE_ENABLED`, default off)

**Goal:** on the expiry-day morning, actually refresh free portals — auto unless vetoed — by
enqueuing the S642 worker expunge-relist, with the full guardrails. Add the standing hands-off
toggle.

1. **Execution trigger:** on the expiry-day-morning scan, for each free item whose cycle decision
   is NOT `skipped`/`let_expire` (i.e. `no_response`, `kept_live`, or org has standing autopilot) →
   enqueue a **refresh job** = re-drive the concierge lifecycle for the already-live item:
   set it to the worker-claimable shape (`mode:"concierge"`, `publish_status:"needs_operator"`,
   `operator_submit_approved_at:now`, standing-authorization audit row `source:
   "relist_radar_autorefresh"`), pointing the worker at the free `attemptFreePlan` path. **Do NOT
   consume a concierge-pack credit** (free channel — skip `claim_concierge_leaseup`, same carve-out
   as S635 §4).
2. **Guardrails (must hold — expunge is destructive):**
   - **Back up** the ad's content + all photos before any delete (persist the backup on the item).
   - **Delete old → repost fresh $0 with retry.** Worker uses the S642 recipe (Owner account, select
     the $0 card, assert Total $0.00 + button "Post Your Ad" before Post).
   - **Confirm the new ad is live** (captured `external_url`) **before** marking the cycle done;
     carry forward new `external_posted_at`/`external_expires_at` (fresh 60-day clock).
   - **Never delete-then-fail into a dark listing:** if repost can't confirm, do not leave the old
     ad expunged with nothing live — leave `needs_operator` with the backup intact and surface it in
     Distribute. Prefer an ordering that only expunges once a fresh post is confirmable, or restores
     on failure.
   - Idempotent + single-flight (concierge `concierge_claimed_by IS NULL` guard + per-cycle marker)
     so a double-fire never double-posts.
3. **Standing autopilot toggle:** reuse/extend `distribution_channel_accounts.autopilot_publish_
   authorized` as the per-org+channel "keep it live, don't email me" opt-in; when on for a free
   portal, Slice 2 already omits the email and Slice 3 auto-refreshes on schedule. Add the monthly
   "here's what we kept live for you" recap for these orgs.
4. **Only near expiry:** execution only ever fires in the lead/expiry window — never refresh a
   healthy mid-life ad (the views/age reset is only free at end-of-life).

**Acceptance:** flag off ⇒ Slice 2 behavior (emails, no repost). Flag on, test org, an Owner-
eligible Kijiji account: a `no_response` free item auto-refreshes on the expiry-day morning via the
worker, posts a real $0 ad, confirms live, resets the clock, closes the cycle — **backup captured,
never a dark listing**. A `skipped` item does NOT refresh (gets the last-chance path). Standing
autopilot ON ⇒ refreshes with no email + appears in the monthly recap. Revoking the toggle ⇒ back to
auto-with-veto email. `tsc` clean; tests for the decision→execute gate, the no-dark-listing failure
ordering, and the no-credit-consumption carve-out. Delete the test ad after.

---

## Cross-slice invariants (all must hold)
- **Silence never spends money** — paid never auto-reposts on no-response (Slice 3 executes free
  only; paid execution is Phase 2).
- **Leased never refreshes** — take-down instead.
- **Flag off ⇒ byte-for-byte current behavior** at every slice.
- **Fail-closed** — a worker stop leaves the item visible + re-runnable, never a silent drop or a
  dark listing.
- Test org `8ea1da48-0cd2-45a4-bfba-023b31a67884` only, **never** Agile `921f7c08`. No em dashes in
  any user-facing copy. `smoke:*` run in the cloud, not device_bash (box VM has no network).

_Standing SHA: prod `45cad2f`. Owner-eligible Kijiji account: `admin@vacantless.com`._
