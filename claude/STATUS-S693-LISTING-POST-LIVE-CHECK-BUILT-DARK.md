# STATUS S693: listing-post live check for hand-posted rows, built dark (2026-09-07)

_Last updated: 2026-09-07 (Session 693). Uncommitted on the Mac until Noam runs `COMMIT-S693-LISTING-POST-LIVE-CHECK.sh`; never pushed by the bridge._

## What it is

A `live` row in `listing_posts` on Kijiji, Zumper or Rentals.ca had nothing checking whether the ad still exists. When Kijiji removed 506 Manning's ad `1743093990` on 2026-09-07 the row kept saying live until a human walked the page (KI1200). This check fetches the public page behind every such row, classifies it, and flips the row to `removed` with a dated note when the portal itself says the ad is gone. Nothing else is ever written.

## Files (vacantless-app)

| Path | Role |
|---|---|
| `lib/listing-post-live-check.ts` | Pure: target derivation, classifier, the one permitted patch |
| `app/api/cron/listing-post-live-check/route.ts` | Cron route: fetch, classify, guarded write, JSON summary |
| `scripts/test-listing-post-live-check.ts` | 111 assertions (`npm run test:listing-post-live-check`) |
| `package.json` | `test:listing-post-live-check` script |
| `COMMIT-S693-LISTING-POST-LIVE-CHECK.sh` | Commit-only script, explicit paths, no push |

Gate on the bridge 2026-09-07: 111/111 tests, `tsc --noEmit` clean, `eslint` clean on the three files, `test-no-client-secret-imports` 0 offenders. Reviewer pass: 2 P2 and 7 P3 fixed (time budget; `removed` requires a 200 landing; never synthesize an end URL; subdomain hosts and uppercase schemes; newest-first scan; `?portal=` validated; comment on the write guard corrected; 26 edge tests added). `?secret=` in the query string was left as is because every existing cron route accepts it.

## Measured signals (2026-09-07, not carried)

| Portal | Removed | Live | Bot wall from a datacentre fetch |
|---|---|---|---|
| Kijiji | 200 after one redirect to the category search page with `adRemoved=<ad id>` | 200, no redirect, end URL still `/v-.../<ad id>` | none seen (cloud fetch reached both pages) |
| Zumper | 200 on `/listings/<id>/<slug>`, text carries "Alert me when this rental is available.", MONTHLY RENT renders "-" (the `<title>` still names a price) | 200 on `/listings/<id>/<slug>`, "Check availability" / "Request tour" | 200 with `<title>Client Challenge` |
| Rentals.ca | redirect to the bare city page (`/windsor-on/833-pillette-road-6` -> `/windsor-on`) | 200 on the same path, ld+json / "Contact Property" | 403 `<title>Just a moment...` (Cloudflare) |

A Rentals.ca slug that never existed renders a "Missed Shot! Oops! We couldn't find the page" page on the same path; that is NOT the removed signal and classifies `unknown`.

Zumper rows store the login-walled `/manage/properties/listing/<id>` URL; the check derives `zumper.com/listings/<id>` and never rewrites the row's URL.

## Verdicts

`live`, `removed`, `challenge`, `needs_login`, `unreachable`, `unknown`, `unsupported`. Order of evidence: END url, then HTTP status, then page text. Only `removed` is writable, and only from `live`; the update is guarded with `.eq("status","live")` so a hand edit in the same minute is not overwritten. A `removed` verdict additionally requires a 200 landing; 403/429/503 or a Cloudflare / "Client Challenge" page is `challenge`; 404/410 and any unmatched shape are `unknown`. Facebook, Instagram and the feed portals are `unsupported` (login-walled; not fetched).

Note appended on a flip: `live-check 2026-09-07 22:40Z: REMOVED (kijiji_ad_removed_redirect). Kijiji redirected ad 1743093990 to the search page with adRemoved=1743093990. Row flipped live -> removed by the listing-post live check; nothing was re-posted.`

## Dark gate

- Not in `vercel.json` `crons`. Nothing fires on its own.
- Writes only when `LISTING_POST_LIVE_CHECK_ENABLED` is on (Vercel env, bakes at build) AND the call has no `?dry=1`. Flag off = `mode: "dry_flag_off"`, report-only.
- Query: `?dry=1`, `?post=<listing_posts.id>`, `?portal=kijiji|zumper|rentals_ca` (anything else is 400), `?limit=N` (default 20, max 200). Rows scan newest first. 48 s time budget inside `maxDuration = 60`; rows left over are counted in `deferred` with `reason: "time_budget"`.
- Auth: `Authorization: Bearer $CRON_SECRET` (the existing cron pattern).

## What is expected from Vercel's egress (unmeasured until the first dry run)

From the cloud container today, Kijiji answered cleanly and Zumper and Rentals.ca walled a plain fetch. Vercel's IPs may be treated the same, so the first dry run will most likely read Kijiji rows as `live` / `removed` and the Zumper and Rentals.ca rows as `challenge`. That is the honest result: a walled portal leaves its rows alone. If Zumper and Rentals.ca stay walled, the classifier can be reused by the worker (Playwright, real browser, Noam's IP for Rentals.ca per KI1169) by feeding it the rendered page text; that is a follow-up, not part of this build.

## Next steps, in order

1. Noam runs `COMMIT-S693-LISTING-POST-LIVE-CHECK.sh` from his terminal (commit only).
2. Push when convenient (ships dark; any app push deploys prod; the diff never touches the Meta OAuth path).
3. First dry run from his terminal against prod: `curl -H "Authorization: Bearer $CRON_SECRET" "https://app.vacantless.com/api/cron/listing-post-live-check?dry=1"`; read `mode`, per-row `verdict` and `end`. Expect Kijiji rows `live` (Units 3 and 33 paid ads), the Manning Kijiji row not present (already `removed`).
4. Only if the dry run reads correctly: set `LISTING_POST_LIVE_CHECK_ENABLED=true` in Vercel (needs a redeploy), then add a daily schedule to `vercel.json` (suggest `30 14 * * *`, after the freshness cron).

## Deliberate states, not tasks

- The route exists but is unscheduled and report-only. 
- Facebook Marketplace rows are not checked (login wall).
- No `last_checked_at` column: the check writes nothing on `live`. Adding one is a migration and waits for the Meta verdict like 0225 and 0226.
- Rentals.ca and Zumper are expected to answer `challenge` from Vercel; not a defect.
