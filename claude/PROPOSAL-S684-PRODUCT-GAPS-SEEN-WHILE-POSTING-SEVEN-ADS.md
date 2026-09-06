# PROPOSAL S684: six product gaps seen while the system posted seven ads in one day

Written 2026-09-06 (Session 684), at Noam's request ("if you see how to make Vacantless better and you don't want to lose it, apply it here"). Each item names the moment it bit, the live evidence, and the smallest build. Ranked by how often it will bite an operator who is NOT Cowork.

## 1. Portal leads do not enter the funnel unless the portal emails the org alias (HIGH)

**Bit today:** 50 Glenrose #4's Zumper listing shows two renter interests from its previous run; Vacantless has 0 leads for that unit ever. Zumper messages go to the Zumper account's email, which for the shared "GR" account is not any org's inbox alias. Rentals.ca emails the contact_email the worker fills (`u-...@in.vacantless.com`), so Rentals.ca leads DO land; Zumper's do not.
**Build:** (a) the Zumper runner fills the listing's contact email with the org's `in.vacantless.com` alias where Zumper allows a per-listing contact; (b) failing that, a Zumper inbox-forward instruction in the concierge desk when a Zumper post goes live; (c) the S306 Kijiji lead-email ingest generalised to Zumper's "New lead" template. Measure: leads with `source = zumper` > 0.

## 2. "Expiry watch" is a calendar guess, not the portal's expiry (HIGH)

**Bit today:** Zumper emailed Noam that Glenrose had expired; Vacantless had no tracker for it and, even with one, `leasing.listing_health` only says "needs refresh" 14 days after `posted_on`. Rentals.ca free listings expire in 21 days; Kijiji paid ads in 31; Zumper on its own schedule. The rule is one number for every portal.
**Build:** per-portal `expires_on` on `listing_posts` written by the runner from what the portal says (Rentals.ca plan card: "expire in 21 days"; Kijiji: order expiry; Zumper: read the listing's expiry from the manage page), plus a "renew" concierge item raised 3 days before it, which for the free portals is a re-run and for Kijiji is the payment prompt (S679 lane). The 14-day rule stays as the fallback when `expires_on` is null.

## 3. A new org has no listing-health alert row, so it is silently unwatched (HIGH, one line)

**Bit today:** Abbas Husain's org had no `notification_settings` row for `leasing.listing_health`; Agile and Davis Muscovitch Rentals did. Nothing would ever have told anyone Glenrose lapsed. Added by hand today (`b3325a29`).
**Build:** seed the default notification rows on org creation (or treat a missing row as enabled-with-owner-email in `sendListingHealthAlerts`). One insert in the onboarding action or one `?? default` in the cron.

## 4. The "Rental sites" launch picker reads as status and is not (MEDIUM)

**Bit today:** Noam: "its strange the ones that are done aren't already checked". The picker on the Get online tab is an add-sites form; Zumper was live on all three units and rendered unchecked.
**Build:** render already-live and already-queued channels in the picker as checked-and-locked with their status pill ("Live on Zumper since 2026-09-06"), and only offer the checkbox for channels with no open or live item. Same component, read `distribution_run_items` per channel.

## 5. A concierge request for a headless channel cannot reach the approval gate (MEDIUM, already filed)

**Bit today, again:** Rentals.ca requests for 33 and 36 landed `queued`; nothing moves them to `needs_operator`; Unit 3's open Kijiji item hid the request button. Same two gaps as S683 (`CODEX-PROMPT-S683-ZUMPER-GATE-AND-PER-CHANNEL-CONCIERGE-BUTTON.md`). Every post this system has made needed a hand-written approval. Bumping it here because it is now four channels wide, not one.

## 6. The runner's failure vocabulary hides the two most common real causes (MEDIUM, filed)

**Bit today:** a dead session reported `end_not_reached`; a Cloudflare wall reported `challenge: unknown`. An operator reading the desk would chase the form. `CODEX-PROMPT-S684-RENTALSCA-RUNNER-NEEDS-LOGIN-TURNSTILE-AND-HIDDEN-PILLS.md`. Worth a desk-level change too: show `outcome` + `challenge` + `final_url` on the concierge item card so nobody has to open the attempt JSON.

## Not a gap, a note for the box

Rentals.ca challenges the Decodo proxy IP with Turnstile and passes Noam's residential IP. The Hetzner box runs through the proxy. If Rentals.ca ever moves to the box, either a residential exit for rentals.ca or the human-click gate (headed, 3-minute wait) has to exist there too. Today every Rentals.ca post runs from the Mac.
