# DESIGN - Posting-assist Chrome extension MVP (S534)

Session 526, 2026-07-20. Advances Appendix B of `DESIGN-DIFFERENTIATION-BANKING-SYNDICATION-S529.md`
from sketch to buildable design. Companion: `DISTRIBUTION-SIDECAR-SPEC.md` (repo, the parked
copy-assist design whose hard boundaries all still stand) and the ILS outreach pack
(`OUTREACH-ILS-FEED-PROGRAMS-2026-07-20.md`, the BD half of the 1-click answer).

## Why this build

Noam's ask (s525 close): true 1-click distribution like RentSync. The honest answer has two
halves. Where feed programs exist (Zumper, Rentsync network, Kijiji pro), BD gets us real
syndication and the plumbing is already live (org feed + network feed + partner tracking).
Where no feed program exists (Facebook Marketplace, confirmed again 2026-07-20: no third-party
rental feed of any kind; Kijiji free tier), the only legitimate route is the operator's own
hands. The extension makes those hands 10x faster: open the portal's posting form, click
Fill on each field, stage photos, paste the tracked link, post, paste the proof URL back.
Near-1-click, zero partnerships, zero per-listing fees, fully inside portal ToS.

## What already exists (verified in repo at HEAD 6290592)

- `lib/listing-fill-sheet.ts`: per-portal ORDERED field list with resolved values, each field
  tagged `listing` / `preset` / `manual` and carrying its guardrail. This is the exact payload
  an extension consumes. Built for this ("or a future Claude-in-Chrome assist / extension").
- `lib/distribution-copilot.ts`: the stop-gate model (login / payment / captcha / final_review)
  with operator-facing labels. The extension inherits these verbatim.
- `lib/listing-copy.ts` + `lib/listing-guardrails.ts`: channel-fit title/body + traps.
- `lib/listing-distribution.ts`: `buildTrackedLink` + `reservableTrackerId` - the `?p=` inquiry
  link is FINAL before posting (hardening #2), so the extension can insert it safely.
- `lib/distribution-run.ts` + `distribution_run_items` (mig 0105): resumable launch runs; the
  proof flow ("mark posted + paste ad URL") already records to coverage + attribution.
- `lib/distribution-channels.ts` / `-capabilities.ts` (S480): the honesty matrix. Facebook and
  Kijiji are `assisted_manual` with `supportsCopilot`; nothing here changes that.
- `requireCapability("manage_properties")` + the `listing_marketing` entitlement flag
  (lib/billing.ts): the gate pair every distribution action uses.

Nothing about the in-app flow changes. The extension is a THIN CLIENT over the same content.

## Hard boundaries (unchanged from the sidecar spec, non-negotiable)

Never auto-submits (never clicks Post/Publish). Never scrapes portal data or reads the
operator's portal account. Never touches portal logins, payments, or CAPTCHAs (the four stop
gates surface as explicit "you do this" steps). Every DOM write happens on an operator click,
one field at a time. Transparent Web Store listing describing exactly what it does and does not
do. Facebook stays assisted-manual forever (no Meta rental feed exists; KI755 stands).

## Architecture

Three pieces, two repos:

**1. App-side kit endpoint (vacantless-app, Slice A, Codex ticket cut - `CODEX-BUILD-EXTENSION-
KIT-ENDPOINT-S534.md`).** A read-only, session-authed, entitlement-gated JSON endpoint:

    GET /api/extension/kit?property=<id>

returns, for each extension-supported channel (Kijiji + Facebook in MVP): the ordered fill
fields (from the fill sheet), title/body copy, the FINAL tracked link, guardrails, stop gates,
photo URLs (cover-first), and the deep link back to the property's Distribute tab. Pure
payload assembly lives in a new unit-tested `lib/extension-kit.ts`; the route only does auth +
gating + assembly. Dark by default: no `EXTENSION_ALLOWED_ORIGIN` env set means the route 404s
(same posture as the network feed). CORS restricted to the exact `chrome-extension://<id>`
origin with credentials, so a random website can never read the kit even from a logged-in
browser.

Auth is the operator's existing app session cookie. No new token system: the extension's host
permission for the app domain lets its fetches carry the session. Not signed in = 401 and the
panel shows "Open Vacantless and sign in."

**2. The extension (NEW repo `vacantless-extension`, Slice B, Cowork-built).** Manifest V3,
Chrome side panel. Operator opens Kijiji's or Facebook's posting page, opens the panel, picks
the unit (or the panel infers the last-viewed kit). Panel renders the fill sheet as a
checklist: each `listing`/`preset` field gets a **Fill** button (writes that one field into the
matched form input via `chrome.scripting.executeScript` on the click) and a **Copy** button
(clipboard fallback); `manual` fields render as instructions with the guardrail. Photos: v1
stages downloads + a "copy all" helper; the operator drags them into the portal's picker (file
inputs cannot be programmatically populated cross-origin, and faking it would cross the
automation line anyway). Stop gates render as the four "you do this" cards. The final step
deep-links to the Distribute tab's proof flow - the extension itself never writes to
Vacantless in v1.

**3. Field mappings as data.** Per-channel selector maps (`mappings/kijiji.json`,
`mappings/facebook.json`) keyed by fill-sheet field id, versioned in the extension repo,
refreshable without a store release (fetched from the app with the kit, falling back to the
bundled copy). When a selector misses, that field's Fill button degrades to Copy with a "site
changed, paste this one" note. The extension therefore NEVER hard-breaks: worst case it is
exactly today's copy-assist. Selector rot is a maintenance fact, not a failure mode.

## The one-click doctrine (Noam, s526)

The operator must EXPERIENCE one click even where the mechanics are assisted. Design rule:
every screen shows exactly ONE primary button, and everything that can legitimately happen
automatically behind that button does. Concretely:

- In Vacantless: one "Post everywhere" button starts the launch run and opens the first
  portal's posting page with the panel armed. Channel order comes from the run.
- In the panel: the primary action is **Fill this page** - ONE click writes every mapped field
  on the form in a single user gesture (Chrome policy draws the line at auto-SUBMIT and at
  acting without a user gesture; one gesture driving many field writes is squarely inside it).
  Per-field Fill/Copy buttons exist only as the repair path when a selector misses.
- The residual human clicks are exactly the ones portal ToS force onto a human: photo picker,
  CAPTCHA if shown, and the portal's own Post button. The panel frames them as "review and
  post" - one moment, not a checklist.
- After Post: one "I posted it - here's the link" paste completes proof, coverage, refresh
  nudges and attribution in a single action.

Net per channel: open (auto), Fill this page (1 click), photos (drag), Post (1 click), proof
(1 paste). The operator's felt experience is "I clicked twice per site." Marketing language
stays honest per the S480 matrix ("you always press Post - nothing sends behind your back"),
but the PRODUCT feel is one-click. Same doctrine applies when a feed partner IS accepted:
those channels collapse to literally zero clicks, and the cockpit shows both kinds side by
side without the operator caring which is which.

## Plan B - the walled garden (no partner ever says yes)

Assume every ILS ignores or rejects the outreach. Vacantless must still be the best
distribution product in Canada for small landlords. The stack that gets there, all of it
partner-free and mostly already built:

1. **The extension is the flagship, not the fallback.** With the one-click doctrine, guided
   posting on the channels renters actually use (Kijiji, FB Marketplace) beats RentSync's
   feed coverage for OUR ICP - RentSync doesn't reach FB Marketplace at all (nobody with a
   feed does; confirmed again 2026-07-20). "Every channel that matters in 5 minutes, with
   proof and attribution" needs no one's permission.
2. **Own the destination: vacantless.com as its own listing surface.** The network feed
   already aggregates every customer's ready listings; pointing it inward gives a public
   browse/search surface on our own domain with fast pages, structured data for search
   engines, and every inquiry landing directly in the customer's pipeline. Zero partners,
   compounding SEO, and the one ILS that can never kick us out. (Separate design when this
   lane is picked; the feed + public /r pages already exist.)
3. **Recycle our own demand.** Waitlist + lead matching across a landlord's units (and later,
   opt-in across the network) means a renter who misses one unit gets offered the next - a
   distribution channel no ILS has, because only the platform holding the pipeline can do it.
4. **Attribution stays the moat.** Whatever the channel mix, Vacantless is the only surface
   telling the landlord which channel leased the unit. Incumbents syndicate and go silent.
5. **Paid assist later (post-GTM):** structured boost flows for the channels that sell
   placement (Kijiji top ads, Meta paid catalog ads via the Marketing API - the one Meta
   surface that legitimately takes a feed), attribution-gated per the existing spend rules.

BD acceptances, if and when they come, upgrade individual channels from "2 clicks" to "0
clicks" - a bonus on top of a product that is already #1 without them, not a dependency.

## MVP scope

Channels: Kijiji + Facebook Marketplace (the no-feed giants; every other channel is either a
feed candidate riding the BD track or low-volume). Chrome only. Panel default = Fill this
page (one gesture, all mapped fields); per-field buttons as repair path. Distribution:
unlisted Web Store link to Noam first, listed after real-world burn-in. Entitlement:
`listing_marketing` (Growth+), enforced server-side by the kit endpoint; the extension is
useless without it.

Out of scope v1: any write from the extension into Vacantless (proof stays in-app), Firefox/
Edge, photo auto-insertion, multi-unit batch mode, auto-detecting which listing matches the
open form, Facebook pacing changes (KI756/757 posture unchanged).

## Selector-rot CI (Playwright as the extension's immune system - Noam, s526)

Playwright is explicitly REJECTED for posting (credential custody + fingerprinting + ToS +
the customer's account carries the ban risk + it would torch the BD lane with the same
companies we're applying to). It is explicitly ADOPTED for testing, in the extension repo
from day one:

1. **Mapping validation (the core job).** A nightly Playwright job loads each portal's
   posting form (Kijiji: the public post-ad page; Facebook: the Marketplace rental create
   form behind a throwaway test login kept OUT of customer scope) and asserts every selector
   in `mappings/*.json` still resolves to a visible, fillable element. Read-only: fill
   nothing, submit nothing, just query the DOM. A miss opens an issue with the failing field
   id BEFORE any operator hits a dead Fill button; the fix ships as a mapping-file refresh
   (server-fetched, no store release). Turns selector rot from a customer-facing failure
   into a morning CI email.
2. **Extension QA.** Playwright drives Chrome with the extension loaded against a local
   fixture page: panel renders the kit, "Fill this page" writes every mapped field in one
   gesture, per-field repair path works, degraded copy-mode works when a selector is
   deliberately broken. Gate for every extension release.
3. **Never in the posting path.** No headless browser ever posts, logs into a customer
   account, or runs against a portal with customer data. The job uses no Vacantless customer
   session and no real listing content.

Fallback when a portal blocks the nightly load (bot walls apply to us too): the job degrades
to running the same assertions against recorded DOM snapshots refreshed manually, and the
copy-mode fallback in the extension already guarantees no hard break either way.

## Sequencing

1. Slice A (kit endpoint) - Codex ticket ready now; additive, no migration, dark until env set.
2. Slice B (extension scaffold + Kijiji mapping + the Playwright harness above) - Cowork
   in-session build in the new repo; Kijiji's form is stable enough to be the first mapping.
3. Slice C - Facebook mapping + Web Store submission (start the review early; unlisted first).
4. Later: run-item write-back (mark step done from the panel), more channels, batch mode.

## Risks owned up front

Portal DOM churn (mitigated: mapping-as-data + copy fallback + server-refreshable maps).
Web Store review time and policy scrutiny (mitigated: honest listing, no remote code, minimal
permissions: sidePanel, scripting, activeTab + the two portal hosts + app host). Extension
origin leaking kit data (mitigated: exact-origin CORS + credentials + entitlement gate +
read-only payload). Operator confusion between "filled" and "posted" (mitigated: the panel's
last card is the proof step; nothing in the panel ever says "posted" - S528 honesty language).
