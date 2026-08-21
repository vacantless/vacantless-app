# CODEX PROMPT - Relist Radar repost-after-delete free-slot WAIT fix (KI1052) - S648

## What happened (live E2E on test org 8ea1da48, worker branch codex/s647-kijiji-refresh-preflight-slot @ 4e83010)
The S647b preflight fix works: the Kijiji free-refresh preflight now PASSES (no false "Kijiji needs"),
and the worker DELETES the old ad and confirms it gone. But the REPOST then fails immediately:

- `preflight_passed_at`  = 2026-08-12T19:29:09Z  (plans_seen 6, reached_form, free-card selection deferred)
- `delete_confirmed_at`  = 2026-08-12T19:29:42Z  (proof: "My Ads no longer lists Kijiji ad 1741928659")
- `repost_failed_at`     = 2026-08-12T19:29:43Z  (~1 second after the delete confirmed)
- `repost_failure_reason`= "no_free_slot", message "free-slot banner was absent", plans_seen 0

error_code `kijiji_repost_failed_after_delete`. Fail-safe held (old ad deleted, $0 charged, backup intact,
item left needs_operator, operator_submit_approved_at cleared so the box does NOT auto-retry).

## Root cause
`runRelistRadarRepost` (src/phase-b-submit.ts, ~line 1341) reposts too eagerly and off a stale page:

1. First attempt reuses the PRE-DELETE preflight page: `attemptFreePlan(args.prepared.page, ...)`.
   `prepared.page` was navigated/filled during preflight WHILE THE OLD AD WAS STILL LIVE, so it reflects the
   occupied-slot state (the $0 Lite card is hidden while the single free slot is taken - the KI1050 fact).
   `readFreeSlot` (~line 261) scans that stale DOM, finds no free-slot banner, returns `no_free_slot`.
2. The one fresh-page retry (`retryPage` goto/fill/post) then fires ~1 second after `delete_confirmed_at`.
   Kijiji has NOT yet propagated the ad deletion to the post-ad free-slot availability that fast, so the
   fresh page ALSO reads `no_free_slot`. `no_free_slot` is in `transientFreePlanFailure` but there is only a
   single, immediate retry - no wait for the slot to actually free.

Net: the slot IS genuinely free (we just deleted the account's only ad), but the repost checks before Kijiji
reflects it, off a page that in the first attempt is stale. So a valid $0 refresh fails.

## The fix
In `runRelistRadarRepost`, replace the "one immediate attempt + one immediate fresh retry" with a bounded
poll that waits for the freed slot on a FRESH page each round:

- Do NOT use `args.prepared.page` for the repost (it is the pre-delete preflight page). Always repost on a
  page navigated AFTER the delete.
- After `delete_confirmed_at`, poll for the free slot: up to a bounded budget (e.g. ~120s total, ~6 rounds
  ~20s apart - make the budget and interval named consts). Each round: open a fresh page, goto
  `config.kijijiPostUrl`, wait for the form, fill (reuse the existing fill+photo path from the current
  retry block), click Post, then `attemptFreePlan`. If it posts live -> done. If it returns `no_free_slot`
  (or another `transientFreePlanFailure` outcome), close the page, wait the interval, and retry.
- Succeed as soon as a round posts live (write `repost_confirmed_at` + the new live_url + fresh ~60-day clock
  exactly as the current success path does).
- Only after the bounded budget is exhausted, fail with the EXISTING `kijiji_repost_failed_after_delete`
  route (backup intact, needs_operator) - unchanged.

Keep the fresh-page navigation/fill/photo logic that already exists in the retry block; just wrap it in the
bounded poll loop and drop the initial stale-`prepared.page` attempt. Do not remove the delete idempotency
(`delete_confirmed_at` -> `already_gone`) or any of the post-delete failure routes.

Notes / guardrails:
- A free post cannot be charged, so polling + re-clicking Post is safe (no paid risk); still, never select a
  paid plan - keep the WORKER_FREE_PLAN $0-only selection.
- Use `page.waitForTimeout(intervalMs)` for the wait (Date.now not needed); keep total rounds bounded so a
  genuinely occupied slot (real no_free_slot) still fails-safe after the budget instead of looping forever.
- Preserve every existing audit field (source relist_radar_kijiji_repost, retry meta, plan summaries).

## Files
- `src/phase-b-submit.ts`: `runRelistRadarRepost` - swap the single stale-page attempt + single retry for a
  bounded fresh-page poll-for-free-slot loop; keep the success + failure routes intact.

## Acceptance (live E2E is the discovery tool)
On test org 8ea1da48 with a real live $0 ad as the refresh target and all facts present:
- preflight passes, deletes the old ad, then within the poll budget REPOSTS a fresh $0 ad,
- new `external_url` != old, fresh ~60-day `external_expires_at`,
- `relist_radar_kijiji_delete` + `relist_radar_kijiji_repost` attempt rows present, repost outcome live,
- backup `worker_free_refresh` has `delete_confirmed_at` + `repost_confirmed_at`, item ends live/done, $0.
- Negative: if the account's free slot is genuinely occupied by a DIFFERENT ad, the repost still fails-safe
  after the bounded budget with `kijiji_repost_failed_after_delete`, backup intact, no paid post.

## Preconditions unchanged
Worker branch codex/s647-kijiji-refresh-preflight-slot is on the box now @ 4e83010 (S647b preflight fix,
proven this session). After this fix: push, merge d2203ad+4e83010+this -> worker main (PR + Chrome), rsync to
box, then `chown -R worker:worker /opt/vacantless-worker` (mandatory). RELIST_RADAR_EXECUTE_FREE_ENABLED is
reverted OFF between runs. Prior context: claude/CODEX-PROMPT-RELIST-RADAR-PREFLIGHT-FALSEPOSITIVE-FIX-S647b.md.
