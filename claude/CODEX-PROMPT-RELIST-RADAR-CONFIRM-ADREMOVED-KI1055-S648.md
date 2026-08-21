# CODEX PROMPT - Relist Radar KI1055: delete confirm FALSE-NEGATIVE on adRemoved redirect - S648

Worker branch: codex/s647-kijiji-refresh-preflight-slot (worker main now 4e05711 with KI1053/KI1054 deployed). Small, well-scoped fix.

## What the S648 live E2E proved (test org 8ea1da48, ad 1741932319)
- KI1053 fix WORKED: the delete is now real - the worker logged in (preflight reached_form=true, filled 19 fields, plans_seen 6 "you've reached the free ad"), found and deleted ad 1741932319. Confirmed in-browser: navigating the ad URL now redirects to
  `https://www.kijiji.ca/b-apartments-condos/windsor-area-on/c37l1700220?...&adRemoved=1741932319`
  i.e. Kijiji shows the definitive `adRemoved=<adId>` removal signal. The ad IS gone, the slot IS free.
- BUT `confirmKijijiAdGone` returned NOT gone -> `deleteKijijiAdFromMyAds` returned outcome `not_confirmed` -> the caller fail-fast to needs_operator with `kijiji_delete_not_confirmed` and did NOT repost. So a SUCCESSFUL delete was misread as a failure, and the refresh never completed (property left unlisted).
- This is the flip side of KI1053: safer (errs toward not-reposting, no orphan, $0, backup intact) but still blocks the happy path.

## Root cause (src/takedown-kijiji.ts -> confirmLiveUrlGone / confirmKijijiAdGone)
When a Kijiji ad is deleted, visiting its `/v-.../<adId>` detail URL 302-redirects to the CATEGORY BROWSE page `/b-...?...&adRemoved=<adId>`. `confirmLiveUrlGone` does `page.goto(liveUrl)` then scans the resulting body text:
- The browse page lists MANY other ads, whose cards contain "Reply", "Contact", "Message", etc. -> `publicListingSignal(text)` matches -> returns `gone:false` ("still shows live ad signals").
- Even absent that, the browse page has no removal banner, so `trustedRemovalSignal` is null and the function's default branch also returns `gone:false`.

So the reliable removal signal - the `adRemoved=<adId>` query param and/or the redirect AWAY from the `/v-.../<adId>` ad-detail URL to a `/b-` browse URL - is never checked. The owner/public text signals are read from the WRONG (redirected) page.

## The fix
In `confirmLiveUrlGone`, after `page.goto(liveUrl)`, FIRST inspect the FINAL URL (`page.url()`) before any body-text signal check:
- If the final URL contains `adRemoved=` (optionally matching the target adId), OR it no longer matches the ad-detail pattern `/v-...\/<adId>` and instead landed on a browse/category path (`/b-`), treat this as a TRUSTED REMOVAL -> return `{ gone: true, proof: "Kijiji redirected the deleted ad to <finalUrl> (adRemoved) " }`.
- Only if the URL still IS the ad-detail page (`/v-.../<adId>`) should the function fall through to the owner-live-signal / public-listing-signal / removal-banner text checks (those are correct for the KI1053 case where the owner is viewing their still-live ad in place).
- Keep the existing trustedRemovalSignal (banner + 4xx) and owner/public-signal logic as the fallback for the still-on-detail-page case.

Guardrails:
- Base the adId match on `kijijiAdIdFromUrl(liveUrl)` so a stray `adRemoved` for a different id doesn't false-confirm (belt-and-suspenders; `adRemoved=<thisAdId>` is the strong case).
- Do NOT loosen the owner/public checks - they must still catch the KI1053 "owner viewing live ad in place" case (URL stays `/v-.../<adId>`).
- `myAdsMentionsAd` (a[href*=adId]) is unchanged and correct.

## Acceptance (live E2E on test org 8ea1da48)
Seed a real live $0 ad, flags on + cron enqueue, box claims:
- delete removes the ad; `confirmKijijiAdGone` now returns gone:true via the adRemoved/redirect signal; delete_outcome `deleted`.
- repost poll then posts a fresh $0 on the freed slot: new external_url != old, fresh ~60-day expiry, delete+repost attempt rows, backup has delete_confirmed_at + repost_confirmed_at, item live/done, run well under the 600s budget, $0.
- Negative (KI1053 still covered): if the owner ad is genuinely still live (URL stays /v-.../<adId>, shows "My Ad's Status"/"Edit Ad"), confirm returns gone:false -> kijiji_delete_not_confirmed fail-fast, no repost.

## Deploy (rules 29/59) - NOTE the .env lesson
push -> merge to worker main (PR + Chrome) -> rsync to root@62.238.44.133:/opt/vacantless-worker/ **WITH `--exclude '.env'`** (a prior rsync without it clobbered the box .env and disabled the worker) -> `chown -R worker:worker /opt/vacantless-worker` -> confirm WORKER_ENABLED=true and a clean tick. App flag RELIST_RADAR_EXECUTE_FREE_ENABLED stays OFF between runs. Prior context: claude/CODEX-PROMPT-RELIST-RADAR-DELETE-CONFIRM-AND-POLL-BUDGET-S648.md, claude/FINDINGS-RELIST-RADAR-DELETE-FALSEPOS-AND-POLL-ORPHAN-KI1053-KI1054-S648.md.
