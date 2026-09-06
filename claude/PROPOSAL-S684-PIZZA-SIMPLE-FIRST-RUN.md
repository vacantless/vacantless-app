# PROPOSAL S684: the first-time landlord's run, as easy as ordering a pizza

Written 2026-09-06 (Session 684), at Noam's request: "think about a first time user experience and how to make warming a session an easy nice experience as well as any payment prompt window, and look at what can be removed for simplicity from the language, copy and UI." Grounded in what a first-timer sees today (the Get online tab copy read live on 833 Pillette Unit 33 at 14:31Z), what the worker actually needs (a session, an approval, sometimes a payment), and what S684 did by hand.

## The pizza test

Ordering a pizza is three screens: pick what you want, say where it goes, pay. You never see the oven. A landlord's version: **pick where to advertise, connect the account once, pay only when a site charges.** Everything else the product currently shows (queues, proofs, run modes, done-for-you counters, credentials, feed rows, refresh watches) is the oven.

## What a first-timer sees today, and what it should say

Read off the live page. Left column verbatim, right column the replacement. Nothing on the right introduces a new concept.

| Today | Replace with |
|---|---|
| "GET ONLINE CHECKLIST. Ready to choose sites and publish. Choose the sites once. Vacantless prepares the copy and shows only sign-in, payment, or proof steps that need you. Nothing is posted automatically. You approve outside-site posts, paid steps, and live proof." | "**Advertise this rental.** Pick the sites. We write the ad and post it. You only step in to sign in once, or to pay when a site charges." |
| Four tiles: PROPERTY Live / SITES 2 selected / ACCOUNT ACCESS 2/17 ready / TOP-UP HELP Optional | One line: "**Live on 2 sites.** Zumper, Rentals.ca." plus "Add a site". |
| "DONE-FOR-YOU / TOP-UP. Pay Vacantless to post Rentals.ca. Vacantless takes over the site and records the live ad link here. 3 of 9999 done-for-you lease-ups this month. [Ask Vacantless to post it]" | Delete the section. Posting for you is the product, not an add-on. The button becomes the site's own row: "**Post on Rentals.ca**". |
| "Use a site yourself instead. Prepared copy, your login, your final proof" | Fold into a small link on each site row: "Post it myself". |
| "NEXT Publish Rentals.ca via your feed. Vacantless prepares the copy, links, and checks. You still approve any outside-site post or payment, and a site counts as Live only after the real ad link is saved. [Show checklist]" | Delete. The site row's status covers it. |
| "Posting status. Live 2/14 · 0 waiting on you · 1 needs refresh · 0 actions needed · Done-for-you 3/9999 used" | "**2 live · 1 needs you**" and the one that needs you says what: "Kijiji: pay $33.84 to post". |
| Rental sites picker: 17 rows, each with two grey pills ("Automated / Needs account", "Fallback / Fallback task", "Broker route / Broker route", "Connected post / Needs account", "Share / Planned"), red sub-copy "Connect or accept the account route before launch" on 8 of them, "Portal setup" + "Launch setup" buttons, a checkbox list that does not show what is already live. | **Six rows, no pills:** Kijiji (paid, $33.84), Facebook Marketplace, Zumper, Rentals.ca (free), RentFaster (paid), Realtor.ca (through your agent). Each row is one of three states: **Live since Sep 6** / **Post here** / **Coming soon** (greyed, no checkbox). Already-live rows are checked and locked. The nine "Planned" / "Fallback" destinations move under a "More sites" disclosure or go away. |
| "ACCOUNT ACCESS 2/17 ready. Credentials. Open launch setup" | Delete. Accounts are asked for at the moment a site needs one (below), never as a dashboard metric. |
| Property status "Live. Public page works. Use listing" | Delete the card. The public page is the ad; the site rows are the distribution. |
| "Facebook Marketplace needs refresh or repost before it counts as live." / "One listing first. Sign-in, payment, and proof wait inside Get online, and outside sites count as Live only after proof is saved." | "Facebook Marketplace: ad is 16 days old, repost?" One sentence, one verb. |

Rule for every string that survives: **a verb the landlord can do, a site name, a dollar amount or a date. No nouns from the engine** (proof, feed, credentials, route, fallback, done-for-you, launch, syndication, run, queue, concierge, desk, tracker).

## Warming a session, made nice

What happens today: a terminal script opens a Chromium window at the site's login, Noam types the password, presses Enter in Terminal; cookies are encrypted into `distribution_channel_sessions`. It works (S684 did it in three minutes) and no first-timer will ever do it.

What the pizza version is, in the shipped decision's shape (concierge until operator #2, `DECISION-S682-SELF-SERVE-CONNECT-STAYS-CONCIERGE.md`) and then in shape C:

1. **Ask only when needed, in the site's row.** Clicking "Post on Rentals.ca" on an org with no session shows one card: "**Sign in to Rentals.ca once.** We keep you signed in so we can post for you. You never share your password with us." One button: **Sign in**.
2. **One window, the site itself, nothing else.** The button opens a hosted headed browser (shape C) or, until that exists, a Vacantless-branded page that says "We'll open Rentals.ca. Sign in as you normally would, then come back here." The window shows the site's own login, full size, with a thin Vacantless bar at the top: "Signed in? Click Done." No Terminal, no Enter key, no cookie talk.
3. **Detect, do not ask.** The bar turns green by itself when the manage page loads (`/manage` reached, no login form), and captures. The landlord clicks nothing after signing in. Same detection the runner already uses (`FORM_SELECTOR` / `LOGIN_SELECTOR`).
4. **Say what was kept and how to undo it.** After capture: "Rentals.ca connected. Sign out from Vacantless any time in Settings." That sentence is the whole privacy story a landlord needs.
5. **Re-warm reads the same.** When a session dies (S684: 43 days, silently), the site row flips to "**Sign in to Rentals.ca again**" with the same one card. Never "session expired", never "needs_login". Detect it from a bounce to `/login` (the KI1170 fix) and from the runner, not from a calendar.
6. **The Cloudflare box is a human moment, so treat it as one.** If the site shows "Verify you are human", the window simply shows it and the bar says "Rentals.ca is checking you're a person. Tick the box." The worker waits (`FORM_WAIT_MS` is already there). Do not try to hide or explain it.

Until shape C ships, the concierge version of the same six steps: the site row says "**Ask us to connect Rentals.ca**", we send a calendar link, and on the call the landlord signs in on a screen-share while we capture. The landlord's experience is the same card and the same green "connected"; only who drives the window changes.

## The payment prompt, made nice

What exists: `needs_payment` renders on four surfaces, `operator_action_url` renders as a link, the worker never writes it, nothing notifies, and the CVV wall means a human always pays (KI1168). Growth Test has two items that have sat at the desk since 2026-08-12 because nobody was told.

The pizza version is one email and one screen, and it is the same screen for Kijiji, RentFaster and any future paid site:

- **The email** (subject: "Kijiji is ready to post 833 Pillette Unit 3 for $33.84"): "Your ad is written and waiting. Kijiji charges $33.84 for 31 days. [Pay and post] [Skip Kijiji]". Two buttons, nothing else. Sent the moment the worker parks at the fee wall; re-sent once after 48 hours; then the item auto-skips with a note so it never rots (the Growth Test lesson). This is `leasing.distribution_job_needs_action` with a payment body, plus `operator_action_url` written by the worker (`SCOPE-S679-KIJIJI-PAYMENT-PROMPT-LANE.md`).
- **The screen** ("Pay and post" lands here): a card with the ad preview (photo, title, price), one line "Kijiji, 31 days, $33.84", and the site's own payment form embedded or opened in a window with the same thin bar: "Enter your card details on Kijiji. We never see them." When the wall clears, the bar goes green: "Posted. Kijiji ad live." The worker resumes from the cart, the S683 human-gate shape. A **saved-card CVV field is still the site's**, so the landlord types three digits and nothing more.
- **Spend limits without the vocabulary.** `spend_authorized` + `spend_max_cents` become one sentence in Settings: "**Let Vacantless spend up to $ [50] per month on ads without asking.**" Off by default; the prompt above is what "asking" looks like. `WORKER_PAY_ONFILE` and the env cap stay engine-side and never appear.
- **A receipt, not a status.** After posting: "Kijiji: live, $33.84, expires Oct 4. We'll ask before renewing." That last clause is the expiry watch (product gap 2) said as a promise.

## What to remove outright (simplicity list)

1. The "Done-for-you / Top-up" concept, counter and section. Posting for you is default.
2. "Portal setup" and "Launch setup" as two buttons. One list.
3. The status pills ("Automated", "Fallback task", "Broker route", "Connected post", "Planned") and the red "Connect or accept the account route before launch" line under eight rows.
4. "Proof" as a word the landlord sees. Live is live; the runner proves it (Rentals.ca) or a person confirms it (Zumper), and the landlord sees "Live since Sep 6" either way.
5. The four KPI tiles on the checklist (Property / Sites / Account access / Top-up help).
6. "Credentials 2/17 ready". Accounts are asked for per site, at the moment of need.
7. The nine destinations with no execution path (SpaceList, CoStar, WhatsApp, LinkedIn, Snapchat, ...) from the default list. "More sites" disclosure or nothing.
8. Everything that repeats the "nothing is posted automatically, you approve" sentence. Say it once, on the first screen, in seven words: "We post only where you say yes."
9. "Simple view / Advanced" toggle: if the simple view needs a toggle, it is not the simple view. Ship the simple one; put the engine detail on the admin concierge desk, which is where it belongs.

## Sequence, smallest first

1. Copy pass on the Get online tab (table above). No schema, no behaviour. Half a day.
2. Site rows as the only surface: three states, locked-when-live (also closes product gap 4). One component.
3. Payment email + screen on the existing `needs_payment` / `operator_action_url` plumbing, with the 48-hour re-send and auto-skip. Closes the S679 lane and the Growth Test rot.
4. "Sign in once" card + hosted window (shape C), with detect-on-manage-page capture and the re-sign-in state. This is the one that needs a build decision; until then, the concierge wording of the same card.

Everything here keeps the engine exactly as it is. It changes what the landlord is asked, when, and in which words.
