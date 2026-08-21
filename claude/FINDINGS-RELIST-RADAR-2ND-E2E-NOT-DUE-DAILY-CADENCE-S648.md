# FINDINGS - Second confirmatory Relist Radar E2E blocked by freshness daily-cadence (not_due) - S648

Context: after the KI1050-1057 delete->repost chain was PROVEN live earlier today (test org
8ea1da48, deleted 1741945214, reposted 1741945806, fresh clock 2026-10-12), we attempted a
SECOND same-day confirmatory run. It could NOT be forced via the natural cron enqueue path.
No code bug - this is the freshness cron's per-item cadence. Nothing destructive happened
(the box never got an approved job); all state reverted clean.

## What the freshness cron actually does (observed from prod logs)
Route: `GET /api/cron/distribution-freshness` (gated by DISTRIBUTION_FRESHNESS_ENABLED [standing,
Added Jul 20] + CRON_SECRET; Vercel "Run" passes it). Per-item dispositions seen in the
`details[]` log array:
- `skipped: run_inactive`  -> the item's distribution_run.status != 'active'.
- `skipped: not_due`       -> item is in-cadence / not yet due for a refresh action this pass.
- `result: stale, reason: posted_on_stale, next: <TOMORROW>` -> freshly flagged; next action ~24h out.
Summary counts: {scanned, verified, flagged, skipped, errors}. flagged = items newly marked stale.

## Why the 2nd run would not fire same-day (item 4dc42e36, run 1363918e)
1. After the successful repost, the parent run 1363918e was set to `status='completed'` -> item
   skipped `run_inactive`. Setting run status back to 'active' cleared that (only the kijiji item in
   that run is live; the rentfaster/viewit siblings are needs_operator/no-URL, so blast radius is safe).
2. With the run active, the item was skipped `not_due`. It had already been flagged (candidate
   d2974d44, cycle_date 2026-08-13, detected 02:15) AND executed (repost 02:27) THIS cycle. The
   cron keeps it in a ~daily cadence -> not due again until the next cycle (2026-08-14). Aging
   external_posted_at to 60 days did NOT make it due (flagged stayed 2, our item still not_due) -
   the not-due gate is the per-item cadence, not the posted_on age alone.
3. Net: the successful run worked because it was that cycle's FIRST flag+execute. Same-day re-fire
   needs the item's "next due" reset, whose exact computation is in the app source
   (executeRelistRadarFreeRefreshes / the freshness scan) - NOT reproducible blind from Supabase.

## How to run the 2nd confirmatory E2E cleanly next time (recommended recipe)
Do it with the vacantless-app repo cloned so the due/execute gate can be read, OR simply let it
happen on a FRESH cycle. Concretely:
- Seed a genuinely NEW at-expiry state: run.status='active'; item live with external_posted_at ~60d
  ago; external_expires_at at/near now; relist_radar_backup=null; last_attempt_id=null; clear the
  prior cycle's radar_candidate for that item (delete d2974d44 or use a NEW cycle_date) so detection
  re-flags fresh. Then flags ON (RELIST_RADAR_CLOCK_ENABLED + RELIST_RADAR_EXECUTE_FREE_ENABLED =1,
  Production, REDEPLOY, wait READY), and run the cron. Confirm the item flips to approved/needs_operator
  with relist_radar_backup captured before expecting the box to claim.
- Read executeRelistRadarFreeRefreshes to confirm exactly what makes an already-flagged candidate
  EXECUTE (vs. just flag with next=tomorrow). In the proven run the execute happened ~12 min after
  the flag on a subsequent cron pass with the execute flag on - so a two-pass (flag, then execute)
  cadence on a fresh cycle is the pattern to reproduce.
- Box is UNREACHABLE from the cloud sandbox; monitor via distribution_publish_attempts
  (relist_radar_kijiji_delete then _kijiji_repost) + Chrome verify. Have Noam confirm the box timer
  active (systemctl is-active vacantless-worker.timer) and paste journalctl if debugging.

## State left clean (verified 2026-08-13)
- Vercel: both RELIST_RADAR flags DELETED again; flags-off Production redeploy 9Au1rNpBh is live.
  Search "RELIST_RADAR" in env vars = No Results.
- DB item 4dc42e36 restored to TRUE post-success state: live/done, url .../1741945806,
  external_posted_at 2026-08-13 02:27:43, external_expires_at 2026-10-12 02:27:43,
  last_attempt_id f926ba4a, operator_submit_approved_at null; run 1363918e back to 'completed'.
- No approved/submitting kijiji jobs. No destructive Kijiji action occurred this session.
- Decodo proxy (box Kijiji egress) had drained to $0 + auto-paused; re-funded $10 + re-enabled ON.

## Bottom line
The delete->repost chain remains PROVEN (once, live). The second confirmatory run is additive
confidence and is best done on a fresh cycle with repo access - not forced same-day. Core task done.
