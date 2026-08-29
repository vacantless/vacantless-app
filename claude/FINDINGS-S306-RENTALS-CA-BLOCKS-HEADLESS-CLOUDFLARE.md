# FINDINGS S306: rentals.ca blocks the headless worker with Cloudflare Turnstile. The lane has a wall.

Written 2026-08-28 (Session 306). Confirmed by screenshot, not inferred.

## The evidence

`submit:r:dark`, Growth Test, 2026-08-28 22:01 UTC. The worker claimed the item, composed the ad, launched the browser as the `worker` user, navigated to the authenticated manage URL, and landed here:

```
final_url: https://rentals.ca/manage/listing?__cf_chl_rt_tk=S.X_vsN09xWIRvhDx.F50Yttz9a8HFKi36VlZ4MkphY-...
reached_form: false   outcome: "no_form"   steps_taken: 0
total_fields: 30      filled_count: 0      proxy_used: true
screenshot: artifacts/rentalsca-submit-2026-08-28T22-01-33-053Z.png
```

The screenshot, read directly:

> **rentals.ca** / **Performing security verification**
> "This website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot."
> Cloudflare Turnstile widget, "Verify you are human". Ray ID `a32697cc8a886cbc`.

## What it is NOT

Three hypotheses were on the table before the run. All three are wrong:

- **Not session expiry.** No login wall, no `sign_in_required`. The session carried the worker to the authenticated manage URL.
- **Not selector drift.** It never received a page to match selectors against.
- **Not our code.** The runner did everything correctly and stopped honestly.

## What it is

Anti-bot infrastructure on the portal's side. `proxy_used: true`, and a datacenter proxy IP is among the strongest signals Cloudflare scores against.

## This is a permanent stop, not an obstacle to route around

The project's own syndication roadmap Hard Boundaries already say it: **"Do not bypass CAPTCHA, payment confirmation, platform approval, or terms-sensitive checkpoints."** A page that says it exists to stop malicious bots is that checkpoint.

Explicitly out of scope, now and later:
- Solving or auto-clicking the Turnstile widget
- Rotating to residential IPs so the worker scores as human. Changing IP reputation to evade detection is the same act with better clothes.
- Fingerprint spoofing, stealth plugins, or any measure whose purpose is to be mistaken for a person

If that trade is ever considered it is a business and legal decision, not an engineering one, and it does not get made inside a worker patch.

## What it explains

- **Why July's success never repeated.** S567 posted to rentals.ca on 2026-07-25 and verified it live with a cold public fetch. The ad lapsed and no re-post ever succeeded. The capability did not rot; the door closed.
- **Why five runners sit at "reaches the form" with zero submits.** Kijiji, RentFaster, Viewit, Zumper and Rentals.ca are all third-party portals with logins. Rentals.ca is now confirmed protected. **Assume the others until proven otherwise, and prove it with one dark run each rather than a build.**
- **Why a month of engineering produced no live channel.** The work was sound. The destination was closed.

## The product consequence

"Vacantless posts everywhere for you" is not deliverable against portals that block automation. The keepable promise is the one the contract layer already encodes: **prepare everything, post where permitted, make the rest one tap.**

Two immediate corrections follow:

1. **The UI currently lies about this.** The property page lists Rentals.ca under "Connected now, Instant." The worker cannot reach the form. Same family as S670. The fix is the existing unbuilt ticket `CODEX-PROMPT-S305-PUBLISH-RAIL-READS-LAUNCH-COVERAGE.md`.
2. **The sanctioned route replaces the headless one.** Rentals.ca, Zumper/PadMapper and RentFaster all run partner or feed programmes for property managers. That is a business conversation, not a build, and a supported feed neither gets challenged nor breaks on a markup change. Recorded rule: [[feedback_sanctioned_source_over_scrape]].

## Secondary defect noticed in the same run

`photos_found: 0`, `photos_attached: 0`, `photos_below_minimum: true`, on a property carrying **18 photos**. The run never got far enough for this to matter, but the photo resolution step found nothing and should be checked before any future portal work.

## Status

Kijiji stays dark and parked at rung 3. No further rungs on any portal until a sanctioned route exists or a dark run proves that portal is not protected.
