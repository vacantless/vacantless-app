# CODEX PROMPT - Relist Radar KI1056 (flaky delete needs retry) + KI1057 (repost round too slow / Post button not found) - S648

Worker branch: codex/s647-kijiji-refresh-preflight-slot (worker main now f076b76; KI1050-1055 all deployed + PROVEN LIVE). These are the last two reliability issues before the delete->repost happy path completes end to end. Both are browser-automation timing/reliability - budget for 1-2 live E2E iterations.

## What the S648 live E2E proved (test org 8ea1da48, ad 1741943272)
The whole logic chain is now correct and PROVEN live:
- preflight passes, worker logs in (reached_form, filled 19, plans_seen 6).
- DELETE actually removes the ad; CONFIRM recognizes it: delete_outcome "deleted", delete_proof "My Ads no longer links the ad, and Kijiji redirected the deleted ad to ...adRemoved=1741943272" (KI1053 + KI1055 validated).
- fail-safe holds: on failure the item lands needs_operator (kijiji_delete_not_confirmed or kijiji_repost_failed_after_delete), backup intact, no orphan (KI1054), $0.
Two RELIABILITY gaps remain:

## KI1056 - the My Ads delete is FLAKY (intermittent) [HIGH]  (src/takedown-kijiji.ts)
- Same ad 1741943272: attempt 1 -> delete_outcome not_confirmed (ad verified STILL LIVE in-browser, URL stayed /v-.../<id>, no adRemoved). Re-run (attempt 2) -> delete_outcome "deleted" (worked). So deleteKijijiAdFromMyAds found the ad and ran clickFirstVisibleDeleteControl + confirmDeleteModal, but the deletion did not take on attempt 1 and did on attempt 2. Across the session: 1741928659 deleted 1st try, 1741932319 deleted 1st try, 1741943272 needed a 2nd try. Intermittent.
- Likely cause: confirmDeleteModal's reason-radio + final-confirm sequence doesn't always complete (modal not fully rendered, required reason not selected, or confirm button not yet enabled), so the modal closes without deleting; confirmKijijiAdGone then correctly reports still-live.
- Fix: add a bounded internal DELETE RETRY. In deleteKijijiAdFromMyAds (or its caller runRelistRadarDelete), if confirmKijijiAdGone returns not-gone, re-navigate My Ads and re-run clickFirstVisibleDeleteControl + confirmDeleteModal up to ~3 attempts (short waits between) before returning not_confirmed. Also harden confirmDeleteModal: wait for the modal to be visible, ensure a reason is actually selected, wait for the confirm button to be enabled, click, then wait for the ad row (a[href*=adId]) to disappear from My Ads before returning. Keep the existing adRemoved/URL confirm (KI1055) as the success signal.

## KI1057 - repost poll round exceeds its deadline and can't find the Post button [HIGH]  (src/phase-b-submit.ts)
- First-ever repost on a genuinely FREE slot (after a real delete) FAILED: free_slot_poll ran ONE round, elapsed 247361ms (> the 240000ms deadline -> deadline_exhausted), reached_form=true, filled_count=14, photos_found=1, photos_downloaded=1, photos_attached=0, post_button_found=false, plans_seen=0, error "Kijiji repost poll could not find the Post button after delete." -> repost_failed_after_delete.
- So on the slow residential proxy, a single repost round takes ~247s (nav 45s cap + fillForm 14 fields + photo download + attach + postButtonLocator), blows the 240s deadline, never attaches the photo (attached=0), and postButtonLocator returns null. Meanwhile the NORMAL $0 seed post (full NAV_TIMEOUT_MS 90s + FORM_WAIT_MS 20s, same account) finds the Post button and posts reliably.
- Root: the KI1054 bounded budgets (RELIST_REPOST_NAV_TIMEOUT_MS 45s, deadline 240s, 3 rounds) are too tight for the proxy AND the repost re-does the full fill+photo path, leaving the page not ready when postButtonLocator runs.
- Fix (pick the combination that makes the repost as reliable as the proven normal post while staying under the 600s systemd cap):
  1. Locate the Post button the SAME robust way the normal post does (scroll into view + explicit wait for the button) instead of a one-shot postButtonLocator; wait for form-ready before looking.
  2. Loosen the repost round budgets to match the working normal-post timings (e.g. nav ~90s, form wait ~20s) and set the overall deadline high enough for ~2 rounds while still finishing well under 600s (raise TimeoutStartSec if needed, but prefer keeping the run bounded).
  3. Investigate photos_attached=0 - the attach step is not completing and may be leaving the page unready; make attach bounded/non-blocking, or reuse the exact attach routine the seed post uses.
  Simplest robust option to evaluate: have the repost reuse the proven normal-post submit routine (the one that reliably posts the $0 seed) rather than the bespoke bounded poll, wrapped in the free-slot wait + fail-safe.

## Acceptance (live E2E on test org 8ea1da48)
Seed a real live $0 ad, flags on + cron enqueue, box claims: delete removes the ad (retrying if needed, delete_outcome deleted, adRemoved confirmed), then the repost posts a fresh $0 on the freed slot within budget: new external_url != old, fresh ~60-day expiry, both attempt rows, backup has delete_confirmed_at + repost_confirmed_at, item live/done, run under 600s, $0. Fail-safe paths (delete truly cannot confirm, or repost genuinely can't post) still land needs_operator with backup intact and no orphan.

## Deploy (rules 29/59)
push -> merge to worker main (PR + Chrome) -> rsync to root@62.238.44.133:/opt/vacantless-worker/ WITH --exclude '.git' --exclude 'node_modules' --exclude '.env' -> chown -R worker:worker /opt/vacantless-worker -> confirm WORKER_ENABLED=true + a clean tick. App flag RELIST_RADAR_EXECUTE_FREE_ENABLED stays OFF between runs. Box is UNREACHABLE from the cloud sandbox - Noam runs rsync/chown. Prior: claude/CODEX-PROMPT-RELIST-RADAR-CONFIRM-ADREMOVED-KI1055-S648.md, claude/CODEX-PROMPT-RELIST-RADAR-DELETE-CONFIRM-AND-POLL-BUDGET-S648.md.
