# FINDINGS S684: Rentals.ca posted three units live from the worker; the two walls on the way were a Cloudflare challenge on the proxy and a dead session the runner misnamed

Written 2026-09-06 (Session 684). Follows FINDINGS-S683-ZUMPER-CONCIERGE-HAS-NO-PATH-TO-THE-GATE.md.

## Result

833 Pillette Units 3, 33 and 36 are live on Rentals.ca from `vacantless-worker` (`submit:r:live:free`), 3 of 3, free Limited plan, nothing spent [verified 2026-09-06 16:22Z via Supabase + the three public pages]:

| Unit | Item | Rentals.ca id | Public URL | Rent | Photos |
|---|---|---|---|---|---|
| 3 | `606b1b77` | 1540335 | https://rentals.ca/windsor-on/833-pillette-road-7 | $1,250 | 10 |
| 33 | `e20a97ee` | 1540336 | https://rentals.ca/windsor-on/833-pillette-road-8 | $1,225 | 8 |
| 36 | `4c3deac5` | 1540338 | https://rentals.ca/windsor-on/833-pillette-road-id1540338 | $1,450 | 10 |

Unlike the Zumper runner, the Rentals.ca runner marks its own work live (S567 rule: `listingActive` read off the listing's own card after Enable, plus a public URL). Items came out `done` / `live` / `verified_live`, trackers `live` with `posted_on 2026-09-06`. **No desk confirm and no `posted_on` hand-fix on this channel.** With S682/S683's four Zumper posts the system has SEVEN live worker posts.

**Free Limited listings expire in 21 days: 2026-09-27.** A renewal on the free plan is a re-run, not a payment.

## Path taken (same shape as S683, and the same two gaps)

- Units 33 and 36: UI "Add these sites" (Rentals.ca) -> new run, `feed_partner` / `needs_operator`; UI "Ask Vacantless to post it" -> `concierge` / `queued`. `concierge_leaseup_claims` is per property per month and idempotent, so `concierge_usage.count` stayed at 3.
- Unit 3: "Vacantless is already posting Kijiji" (the open Kijiji `needs_payment` item, gap 2) hid the request button, so "More site options -> Add" (`addRunChannel`, mode NULL / `queued`) then a SQL mirror of `requestConciergePublish`.
- All three: SQL mirror of `approveConciergeSubmit` (gap 1: nothing moves a Rentals.ca request to `needs_operator` either), approvals staggered by one second, one `operator_approved_submit` attempt row each.

## Wall 1: Cloudflare challenges the worker through the proxy

Dark run 1 (14:57Z, proxy on) landed on rentals.ca's "Performing security verification / Verify you are human" Turnstile page (`__cf_chl_rt_tk` in the URL), filled 0/30 and released. The 2026-08-28 Growth Test run hit the identical wall. The July runs that reached the form used the same proxy, so the clearance has lapsed since. **Direct IP from Noam's Mac (`PROXY_URL=""` inline) passed with `challenge: none` on every later run.** The rentals_ca session is warmed from that IP anyway (`warm-session.ts` runs `proxyUrl: null`).

Classifier gap: the run reported `challenge: "unknown"` although `CAPTCHA_SELECTOR` names `challenges.cloudflare.com`; the interstitial had not rendered the iframe inside the 1 s check. Cheap fix: also match the interstitial copy or the `__cf_chl` URL token.

## Wall 2: the 2026-07-25 session was dead, and the runner called it `end_not_reached`

Dark run 2 (15:01Z, direct IP) reached `input[name="address"]` momentarily, then was bounced to `/login?redirect-after-login=%2Fmanage%2Flisting` with only "Log In" and the cookie banner visible. Outcome `end_not_reached`, `challenge: none`. The login check lives only on the `!reachedForm` branch, so a post-form redirect to `/login` is never classified `needs_login`. **Anyone triaging by outcome string would have chased the form.** Fix: after the first step, if `page.url()` matches `/login`, set `outcome = "needs_login"`.

Re-warm (`WARM-S684-RENTALSCA-AGILE.sh`, headed, direct IP, Noam typed the password) rewrote the session row at 15:42:01Z. Dark run 3 (15:53Z): `submit_ready`, 15/30, 10 photos, 3 steps, plan wall reached, 0 validation errors.

## Mapping v0.2.0 gaps seen in the fill results (honest omissions, not blockers)

- `rentalsca-pets` ("Yes"), `rentalsca-lease-term` ("1 Year"), `rentalsca-short-term`, `rentalsca-parking-included`: pills present but hidden (`label--primary` / `label--disabled`), skipped `not_on_step`. The ads state neither pets nor lease term.
- `rentalsca-bm-laundry`, `rentalsca-bm-pet-friendly`: "Building Features" row not on screen, skipped. Laundry (record: `in_building`) is not stated.
- `rentalsca-parking-spots`: `no_value` (record `parking` NULL); Rentals.ca accepted the form without it.
- `move_in` was set to the record's `available_date` 2026-09-05 (a past date); accepted.

## Also seen

- The Agile Rentals.ca account holds five older **Disabled** 833 Pillette listings (two $1,195, three $1,250; leads 5/1/1/3/0) from July and the S684 dark runs. Harmless; optional UI cleanup. Do not confuse them with the three Active ones.
- `external_posted_at` is NULL on all three items although `publish_status` is `live`; `posted_on` on the tracker is what the app reads.
- The "Rental sites" launch picker on the Get online tab shows every channel unchecked even when that channel is live (Zumper on all three). It is an add-sites form, not a status view; Noam read it as status. UI gap, filed here, not fixed.

## Scripts (project root)

`PUSH-S684-ZUMPER-HONESTY-FIXES.sh` (worker `9af7fc2` pushed), `RUN-S684-RENTALSCA-DARK-AGILE-UNIT3.sh` (proxy, hit Cloudflare), `RUN-S684-RENTALSCA-DARK-AGILE-UNIT3-v2-HEADED-DIRECT.sh` (the proof), `WARM-S684-RENTALSCA-AGILE.sh`, `RUN-S684-RENTALSCA-LIVE-FREE-AGILE-UNITS-3-33-36.sh`. Logs: `RENTALSCA-DARK-S684-*.log`, `RENTALSCA-LIVE-S684-*.log`.
