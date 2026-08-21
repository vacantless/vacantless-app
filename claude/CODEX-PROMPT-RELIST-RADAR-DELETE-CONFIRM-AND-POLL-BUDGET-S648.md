# CODEX PROMPT - Relist Radar KI1053 (delete false-positive) + KI1054 (repost-poll budget/orphan) - S648

Worker branch: codex/s647-kijiji-refresh-preflight-slot (currently worker main 589e35e; the KI1052 repost free-slot WAIT poll is already merged). These two fixes are COUPLED - a reliable "is the old ad actually gone?" check fixes KI1053 AND lets KI1054 short-circuit instead of polling into the run timeout.

## What the S648 live E2E proved (test org 8ea1da48, ad 1741932319)
- Preflight passed (S647b solid, 3rd time). Delete ran and reported delete_outcome "already_gone" + set delete_confirmed_at.
- BUT the ad 1741932319 was STILL LIVE (verified in-browser: owner "My Ad's Status", Visits 6, Edit Ad / Delete Ad). The delete never removed it.
- Because the slot never freed, the KI1052 repost poll correctly hit no_free_slot every round, ran long, and the systemd oneshot (TimeoutStartSec=600) KILLED the run at ~10 min mid-poll -> the item was ORPHANED in publish_status='submitting' (claimed, approval still set, NO fail-safe written).

## KI1053 - delete confirm-gone FALSE-POSITIVE [BLOCKER]  (src/takedown-kijiji.ts)
Root cause, two bugs in the "is the ad gone?" logic:
1. `myAdsMentionsAd(page, adId, titleNeedle)` decides "listed in My Ads" by BODY-TEXT substring: `body.includes(adId)` and `body.toLowerCase().includes(titleNeedle)`. Kijiji renders each My-Ads entry's ad ID in the LINK HREF (e.g. `a[href*="1741932319"]`), NOT as visible body text, so `body.includes(adId)` is a false-negative; titleNeedle matching is also fragile (truncation/format). So the ad looks "not listed" even though it is live.
2. `confirmKijijiAdGone(...)` live-URL fallback: after navigating to the live URL it does `/not available|no longer available|deleted|removed|404|could not be found/i.test(bodyText)` over the WHOLE page. On the signed-in OWNER view the page contains "Delete Ad", help links, related/expired-ad chrome, etc., so this loose regex MATCHES and returns gone:true - while the ad is live. (Recorded proof was literally "Kijiji live URL reports removed: ... My Ad's Status ... Edit Ad Delete Ad Promote your ad ...".)

Danger: already_gone is treated as a SUCCESSFUL delete and sets delete_confirmed_at. The delete idempotency (delete_confirmed_at set -> already_gone -> skip delete) then PERMANENTLY skips the real delete on any re-run, so the slot never frees and the item can never complete.

Fix:
- `myAdsMentionsAd`: detect presence via DOM, not body text - `page.locator(a[href*="${adId}"]).count() > 0` (the My-Ads list links each ad by id). Keep titleNeedle only as a secondary signal.
- `confirmKijijiAdGone`: make the live-URL check require a POSITIVE removal state AND the ABSENCE of live signals. The ad is LIVE (=> gone:false) if the live URL shows owner chrome (/My Ad.?s Status/i, /Edit Ad/i, /Promote your ad/i) OR public-listing signals (reply/message form, price, description). Only conclude gone on a specific standalone removal banner (e.g. /this ad (is )?no longer available/i, /has been deleted/i, /could not be found/i, a real 404) AND when none of the live signals are present. Tighten/remove the bare `removed`/`deleted` substrings (they match chrome).
- Never return already_gone / gone:true while `a[href*="${adId}"]` exists in My Ads OR the live URL shows owner "My Ad's Status"/"Edit Ad". Make already_gone TRUSTWORTHY so the idempotency is safe.

## KI1054 - repost poll exceeds the 10-min run budget and ORPHANS the item [HIGH]  (src/phase-b-submit.ts + src/claim.ts)
Root cause: the KI1052 poll (RELIST_REPOST_FREE_SLOT_MAX_ROUNDS=6 x (fresh-page goto NAV_TIMEOUT_MS=90s + fillForm + photo download/attach + attemptFreePlan + RELIST_REPOST_FREE_SLOT_INTERVAL_MS=20s wait)) can run 10-18 min. The worker service is `Type=oneshot` with `TimeoutStartSec=600` (deploy/systemd), so systemd SIGKILLs the run at 10 min - here mid-poll, before the loop's fail-safe write. Item left 'submitting' (not needs_operator), which the box never re-claims -> permanent orphan.

Fixes (do all three):
1. Bound the poll's TOTAL wall-clock well under 600s. Add an overall deadline (e.g. RELIST_REPOST_FREE_SLOT_DEADLINE_MS ~= 240000) checked before each round; lower default rounds to ~3 and use a shorter in-poll nav timeout (~30-45s) so the whole delete+poll finishes with margin under 600s.
2. Short-circuit using the KI1053 reliable liveness check: right after the delete step, positively verify the old ad is gone. If it is STILL LIVE, DO NOT enter the repost poll at all - fail fast to needs_operator with a clear errorCode (e.g. kijiji_delete_not_confirmed / slot_not_freed), backup intact. (This also means KI1053's false-positive can't lead to a doomed long poll.)
3. Stale-'submitting' reclaim: add recovery so a run killed mid-flight self-heals. In the claim/sweep path, reclaim items stuck in publish_status='submitting' with the worker sentinel and updated_at older than ~12 min back to needs_operator (backup intact, approval preserved or re-set per existing fail-safe convention) so the next tick can retry instead of orphaning.

## Acceptance (live E2E on test org 8ea1da48)
Seed/keep a real live $0 ad as target, flags on + cron enqueue (source relist_radar_autorefresh), box claims:
- delete ACTUALLY removes the ad (verify the ad URL shows a genuine removal state, and My Ads no longer links a[href*=adId]); delete_outcome "deleted" (never a false already_gone on a live ad).
- repost poll posts a fresh $0 within the (now shorter) budget: new external_url != old, fresh ~60-day expiry, delete+repost attempt rows, backup has delete_confirmed_at + repost_confirmed_at, item live/done, $0.
- Whole run finishes well under 600s (no systemd kill); item never left in 'submitting'.
- Negative: if the delete cannot confirm the ad is gone, fail fast to needs_operator with kijiji_delete_not_confirmed, backup intact, NO repost attempted, NO orphan.

## Deploy (unchanged, rules 29/59)
push branch -> merge to worker main (PR + Chrome) -> rsync to root@62.238.44.133:/opt/vacantless-worker/ -> MANDATORY `chown -R worker:worker /opt/vacantless-worker` -> prove by a clean timer run. App flag RELIST_RADAR_EXECUTE_FREE_ENABLED stays OFF between runs. Prior context: claude/FINDINGS-RELIST-RADAR-DELETE-FALSEPOS-AND-POLL-ORPHAN-KI1053-KI1054-S648.md, claude/CODEX-PROMPT-RELIST-RADAR-REPOST-FREESLOT-WAIT-S648.md.
