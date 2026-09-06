# CODEX PROMPT S684: Rentals.ca runner - classify a post-form login bounce as needs_login, detect the Cloudflare interstitial, and reach the hidden pills

Repo: `vacantless-worker`. Base: `main` at `9af7fc2` or later. Evidence: `vacantless-app/claude/FINDINGS-S684-RENTALSCA-THREE-LIVE-CLOUDFLARE-AND-A-DEAD-SESSION.md`. Three live Agile listings (1540335/6/8) were produced with the code as it is; nothing here is urgent, all three are honesty and triage fixes.

## 1. `needs_login` after the form was seen (`src/phase-b-submit-rentals.ts`)

Today the login check runs only inside `if (!reachedForm)`. On 2026-09-06 15:01Z a dead session showed `input[name="address"]` for an instant, then redirected to `/login?redirect-after-login=%2Fmanage%2Flisting`; the run reported `outcome: end_not_reached`, `challenge: none`, `visible_buttons_at_stop: ["Log In", ...]`. Add, after the first `fillForm` step and again at every `Next`, a check `if (/\/login\b/i.test(page.url()) || await isVisible(page, LOGIN_SELECTOR, 500))` that sets `challenge = "sign_in_required"`, `outcome = "needs_login"`, releases with the audit `"Rentals.ca submit: session bounced to login after the form; released (approval preserved)"`, and stops stepping. Keep `end_not_reached` for a wizard that stalls while still signed in.

## 2. Turnstile interstitial detection

`CAPTCHA_SELECTOR` already names `iframe[src*="challenges.cloudflare.com"]` but the 1 s check ran before the widget rendered, so the run said `challenge: "unknown"`. Treat any of these as `captcha` without waiting for the iframe: `page.url()` containing `__cf_chl`, or body text matching `/performing security verification|verify you are human/i`. Record `challenge: "cloudflare_turnstile"` so the desk can tell a proxy problem from a login problem.

## 3. Hidden pills and the Building Features row (`mappings/rentalsca.json`, `src/fill.ts`)

Fill results on all three live runs: `rentalsca-pets` ("Yes"), `rentalsca-lease-term` ("1 Year"), `rentalsca-short-term`, `rentalsca-parking-included` were `skipped:not_on_step` with the marker `hidden:label label--primary` / `label--disabled`; `rentalsca-bm-laundry` and `rentalsca-bm-pet-friendly` were skipped because the "Building Features" row was not on screen. Capture the create wizard again (see `_meta.capturedFrom`) and find what reveals those pills (a preceding toggle, an accordion, a scroll) and where the Building Features row lives; then either add the revealing action to the mapping or scroll the row into view in `fill.ts` before the tagpill/amenitylink handlers give up. Do not guess a selector; capture it.

## Gates

`tsc --noEmit` clean. `npm run submit:r:dark` against North Star QA (never Agile) must still reach `submit_ready`; run it once with the session row deliberately emptied to prove `needs_login` fires. Do not touch the Zumper runner.
