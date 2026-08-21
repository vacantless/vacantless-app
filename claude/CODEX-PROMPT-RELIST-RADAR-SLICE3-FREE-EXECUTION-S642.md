# CODEX PROMPT — Relist Radar Slice 3: free execution + standing toggle (S642)

**Repo:** `vacantless-app` (+ the S642 free-plan path in `vacantless-worker`). **Branch from:**
`main` **after Slice 2 has merged.**
**Flag:** `RELIST_RADAR_EXECUTE_FREE_ENABLED` (env, default off). Ship dark.
**Design of record:** `claude/DESIGN-RELIST-RADAR-EXPIRY-AUTOREFRESH-S642.md`.

**Goal:** on the expiry-day morning, actually refresh **free** portals — automatically unless the
landlord vetoed — by enqueuing the worker expunge-relist, with the full destructive-op guardrails.
Add the standing hands-off toggle + monthly recap. **Free only; paid execution is Slice 4 (Phase 2,
`WORKER_PAY_ONFILE`) — out of scope here.**

---

## HARD PRECONDITIONS — ALL MET as of 2026-08-11 (S644). Cleared to build.
1. **Slice 1 merged to `main`** — DONE (PR #17, merge `cc5f56d`; `relist_radar_clock`).
2. **Slice 2 + email-send wiring merged to `main`** — DONE (PR #18, merge `fe061f2`). Prod `main`
   carries Slices 1+2; branch Slice 3 from current `main`.
3. **`vacantless-worker` is a Git repo with a remote** — DONE. `github.com/vacantless/vacantless-worker`
   (private); worker `main @ 6dece3f`.
4. **The S642 worker $0 path is built and proven green** — DONE. The free-plan gate (click-and-verify
   past the stale "Ad Duration" banner: assert selected $0 card + Total $0.00 + "Post Your Ad" + no
   paid button, click Post, judge by the live `/v-` result) plus compose null-defaults for every
   required Kijiji radio shipped in `codex/s642-kijiji-free-plan-worker` and MERGED to worker
   `main @ 6dece3f` (PR #1, S644). Proven LIVE 3x on the test org for ANY config (incl. smoking=null;
   real facts never invented, missing one fails safe as `needs_operator` naming the field), and
   DEPLOYED to the Hetzner box (rsync landed; timer active every 5 min; `WORKER_ENABLED=true`; run
   mode defaults to `submit:b:live:free`). See `00-NEXT-SESSION.md` S643 + S644 close blocks.

All preconditions satisfied — proceed with Slice 3.

---

## Read before editing
- Slice 1: `lib/relist-radar.ts`, `relist_radar_events`, the detection pass in
  `app/api/cron/distribution-freshness/route.ts`.
- Slice 2: the decision store + states (`skipped | paid_consented | kept_live | let_expire |
  no_response`) and the email omission for autopilot portals.
- Concierge lifecycle to re-drive for an already-live item: `requestConciergePublish` /
  `authorizeAutopilotSubmit` (`distribution-actions.ts`), the worker claim contract
  (`claimApprovedJob`), `completeConciergeItem` (`admin/concierge-actions.ts`),
  `distribution_publish_attempts` audit rows, and the concierge-cap RPC `claim_concierge_leaseup`
  (migration 0172) — which we must **skip** for free auto-refresh (§ guardrails).
- **Standing-consent flags (schema correction):** there is NO `autopilot_publish_authorized`
  column. The real per-channel columns are `distribution_channel_accounts.automation_authorized`
  (worker may act on this channel) and `auto_submit_allowed` (may act without a per-action human
  approval), from migration 0177. Use `automation_authorized === true && auto_submit_allowed ===
  true` as the standing hands-off signal. Only add a refresh-specific column if product wants
  refresh-consent distinct from initial-publish auto-submit (a later decision, not this slice).
- The worker free path: `attemptFreePlan` in `vacantless-worker/src/phase-b-submit.ts` (posts $0 as
  Owner, asserts Total $0.00 + "Post Your Ad" before Post). The app enqueues; the worker executes.

---

## Build steps

1. **Execution trigger (expiry-day morning).** In the freshness cron, for each **free** portal item
   at/again within the expiry window whose Slice-2 cycle decision is **NOT** `skipped` /
   `let_expire` (i.e. `no_response`, `kept_live`, or the org has standing autopilot ON) and unit is
   **AVAILABLE** → enqueue a **refresh job** by re-driving the concierge lifecycle for the
   already-live item into the worker-claimable shape:
   - `mode:"concierge"`, `publish_status:"needs_operator"`, `status:"in_progress"`,
     `operator_submit_approved_at: now`, `operator_submit_approved_by: <system/radar actor>`,
     `concierge_claimed_by: null`, `error_code/message: null`,
   - a `distribution_publish_attempts` audit row `source: "relist_radar_autorefresh"`,
   - point the worker lane at the free `attemptFreePlan` path (`WORKER_FREE_PLAN=true`).
   Gate on `RELIST_RADAR_EXECUTE_FREE_ENABLED`. Keep Slice 1 test-org scoping (never Agile).

2. **No concierge-pack credit.** A free auto-refresh must NOT call `claim_concierge_leaseup` / burn
   a concierge-pack credit (it's the org's own authorized account posting for free, not staffed
   concierge labor). Same carve-out as the S635 autofire slice §4 — document why in a comment.

3. **Destructive-op guardrails (expunge = delete → repost; all MUST hold):**
   - **Back up first:** persist the ad's content + all photo references on the item (the S641 backup
     pattern) BEFORE any delete.
   - **Repost with retry:** the worker deletes the old ad and reposts fresh $0 via `attemptFreePlan`
     (Owner account, select the $0 card, assert Total $0.00 + button "Post Your Ad" before Post).
   - **Confirm live before done:** only mark the cycle done once the new ad is confirmed live with a
     captured `external_url`; write the fresh `external_posted_at` / `external_expires_at` (new
     60-day clock) — reuse `completeConciergeItem`.
   - **Never a dark listing:** if the repost cannot confirm, do NOT leave the old ad expunged with
     nothing live. Prefer an ordering that only expunges once a fresh post is confirmable, or
     restore/retain on failure; on any worker stop (`needs_login`/`captcha`/no free slot) leave the
     item `needs_operator` with the backup intact, surfaced in Distribute like a manual concierge
     item.
   - **Idempotent + single-flight:** the concierge `concierge_claimed_by IS NULL` claim guard + a
     per-cycle marker so a double cron fire or double-enqueue never double-posts.
   - **Only near expiry:** never refresh a healthy mid-life ad — the views/age reset is only free at
     end-of-life.

4. **Standing autopilot toggle + monthly recap.** Use the corrected flags
   (`automation_authorized === true && auto_submit_allowed === true`) as the "keep it live, don't
   email me" opt-in: when both are true for a free portal, Slice 2 already omits the pre-expiry
   email and Slice 3 auto-refreshes on the expiry-day morning. Add a **monthly** "here's what we
   kept live for you" recap for these orgs (respect `autopilot_receipt = monthly`). Turning either
   flag off ⇒ back to Slice 2 auto-with-veto email.

---

## Fail-closed / invariants
- Flag off ⇒ Slice 2 behavior (emails, decisions, no repost).
- **Silence never spends money** — Slice 3 executes **free only**; paid stays notify+consent (Slice 4).
- `skipped` / `let_expire` items do NOT refresh (skip → last-chance path from Slice 2).
- Leased never refreshes → take-down instead.
- Never a dark listing; never double-post; never burn a concierge credit for a free refresh.
- Test org only; no em dashes in user-facing copy.

## Acceptance
1. Flag off ⇒ Slice 2 behavior unchanged (no reposts).
2. Flag on, test org, Owner-eligible Kijiji account: a `no_response` free item auto-refreshes on the
   expiry-day morning via the worker — posts a real $0 ad, confirms live, resets the clock, closes
   the cycle, **backup captured**, **no concierge credit consumed**, **never a dark listing**.
   Delete the test ad after.
3. A `skipped` item does NOT refresh (gets the Slice-2 last-chance path instead).
4. Standing autopilot ON ⇒ refreshes with no email + appears in the monthly recap; revoking ⇒ back
   to auto-with-veto email.
5. Induced worker stop (e.g. no free slot) ⇒ item left `needs_operator` with backup intact, old ad
   NOT expunged into a dark listing; surfaced in Distribute.
6. `npx tsc --noEmit` clean; `npm run lint` clean; tests for the decision→execute gate, the
   no-dark-listing failure ordering, and the no-credit carve-out. `smoke:*` in the cloud.

_Standing: builds go to Codex; gh not on the Mac (merge via GitHub web/Chrome); Owner-eligible
Kijiji account `admin@vacantless.com`; no em dashes. Slice 4 = paid execution (`WORKER_PAY_ONFILE`),
separate._
