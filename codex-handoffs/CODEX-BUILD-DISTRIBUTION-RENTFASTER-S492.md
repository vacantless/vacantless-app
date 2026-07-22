# Codex Build Ticket — S492: Landlord "Market this property" reframe + RentFaster deep card

**Date:** 2026-07-15 · **Author:** Cowork (grounded against real code) · **Status:** IMPLEMENTATION-READY — build on the Mac
**Base:** HEAD `54ee07d` (clean tree), migration ledger `0137–0146`. **NO migration in this slice.**
**Repo:** `.../Agile Lead to Lease Engine/vacantless-app`

> ### Read this first — numbering + stale-state reconciliation
> The originating brief was written against stale state (it says HEAD `c8ea623`, mig `0145`, "Active **S490** goal"). Since then **S490** (viewing-booked alert + confirm-first, `145a08f`, mig `0146`) and **S491** (tier copy, `943568e`/`54ee07d`) shipped. Neither touched the distribution nav / publish / RentFaster surfaces, so there is **no conflict** — this is the **S492** slice in our ledger. Do **not** redo the S488 command center, the S489 health panel / setup blockers / helper-window-primary flow / realtor_ca live-URL hardening, or the RentFaster base channel — those are shipped. Realtor.ca referral network stays dark-launch only; **do not** build the referral network here.
>
> ### Divergences from the brief that change the work (grounded 2026-07-15)
> - **"Distribute done" string does not exist.** Coverage already reads honestly as **"Live coverage N/7"** (`distribute-tab.tsx:500`). The real "reads-as-live" bug is that **`submitted` maps to run-status `"done"` with a positive tone** — fix that instead (§2b).
> - **RentFaster `portalUrl` is the 404 path in prod** (`distribution-channels.ts:125` = `.../list-property/`). Correct is `/admin/add-listing/` (§3a).
> - **The dishonest "no posting needed" feed copy is in `marketing-kit-card.tsx:234`**, and an honest version already exists on the Distribute tab to mirror (§2d).
> - **No computed "next best action" banner exists** — there is a static "Go to Distribute →" bridge card (`page.tsx:2078-2094`). "Route the user to Publish" = make that the primary next action, not tweak a banner that isn't there (§1e).

---

## Product goal (unchanged from brief)

Make the first-time landlord path feel like **`Properties → 50 Glenrose → Market / Publish`**, not `Rentals → Photos & marketing → Distribute → checklist`. Win on **connection quality, not logo count**: publish to each channel the best way that channel allows, track proof, show *live* vs *merely submitted* honestly, and turn every channel into attributed renter leads. Depth over breadth — make the **main path** and **RentFaster** excellent; do **not** add shallow cards.

---

## PART 1 — Landlord nav + property-journey reframe (copy/label, keep routes)

Change product *language* only; keep routes, hrefs, ids, and internal code names.

**1a. Top nav** — `app/dashboard/dashboard-nav.tsx`, `NAV` array (L37-63)
- Relabel **`"Rentals"` → `"Properties"`** (keep `href: "/dashboard/properties"`).
- Keep **`"Leasing"`** (`/dashboard/leasing`) — it correctly scopes inquiries / showings / applications / screening / lease workflow.
- Keep **`"Tenants"`** (`/dashboard/tenants`) — post-lease residents / tenancies.
- Leave "Overview", "Money", "Maintenance", "Settings", "Your plan", "Refer a landlord", "Captures" unchanged.

**1b. Properties list page** — `app/dashboard/properties/page.tsx`
- BrandBanner (L98-103): title **`"Rentals"` → `"Properties"`**; keep `eyebrow="Portfolio"`; subtitle → something client-centric, e.g. **"Your landlord clients' properties and their marketing status."**
- Empty state (L264-266): **"No rentals yet" → "No properties yet"**, CTA **"Add your first rental" → "Add your first property"** (keep `href="#add-rental"` id unchanged).
- Prefer "property/properties" over "rental(s)" in user-facing help/empty copy on this page **where safe** (do not touch route strings, form field names, or `StatusChip`/DB values).

**1c. `market` tab label** — `app/dashboard/properties/[id]/page.tsx:1687`
- `<TabPanel tabId="market" label="Photos & marketing" …>` — keep `tabId="market"`. Consider relabeling to **"Photos & listing copy"** so "Market/Publish" (the action) is not confused with a *content-editing* tab. The two Distribute-tab back-links that point here (`distribute-tab.tsx:323` "Finish setup in Photos & marketing →", `:749` "Full copy & field sheet in Photos & marketing →") must match whatever label you choose.

**1d. Property ROW — add a Market/Publish action** — `app/dashboard/properties/page.tsx` (rows L184-263)
- For a **live/vacant** listing (status live/available, not leased), add an obvious **`"Publish / Market →"`** action on the row that links straight to the property's Distribute tab (`/dashboard/properties/{id}#distribute-header`). Place it beside the existing `CopyIntakeButton`/`Edit`. Do not show it for leased rows.
- This is the row-level entry to the marketing job; it must not require the user to open the detail page and hunt for a tab.

**1e. Prioritized next action → Publish, not "Photos & marketing"** — `app/dashboard/properties/[id]/page.tsx:2078-2094`
- Today a static "Go to Distribute →" bridge card exists. For a **live property with no inquiries**, make **Publish/Distribute the primary next action** (prominent, first) and demote the "Finish setup in Photos & marketing →" links to secondary. Do **not** bury the user in the `market` tab as the default next step.
- No new "AI next-best-action" engine — just prioritize the existing bridge so the obvious next click is Distribute when the listing is live and empty.

---

## PART 2 — Distribution / Publish flow honesty + first-run clarity (`distribute-tab.tsx`, `launch-run-panel.tsx`, `distribution-publish.ts`, `marketing-kit-card.tsx`)

**2a. "In active run" must not count defaults before a real run** — `distribute-tab.tsx:198-200`
- Current: `const activeChannels = launchRun.run ? runItems.length : launchRun.startChannels.filter((c) => c.defaultSelected).length;`
- Change so that with **no active run** the value is **0** (and/or the metric is hidden / relabeled "Ready to publish: N"). "In active run" must reflect **actual run items only**. Suggested: `const activeChannels = launchRun.run ? runItems.length : 0;` and, if you want to keep the pre-run signal, render a separate **"Selected to publish: N"** metric from `defaultSelected` — clearly not "in active run".

**2b. `submitted` must never read as "live"/"done"** — `lib/distribution-publish.ts`
- L66/L70: labels `submitted:"Submitted"`, `live:"Live"` are fine. The problem:
  - L81: submitted `tone: "positive"` (green family, same as live).
  - L239: `if (status === "live" || status === "submitted") return "done";` — collapses submitted into the terminal `"done"` run status.
- Fix: give **submitted** its own non-terminal treatment — a neutral/amber tone and a run status that is **not `"done"`** (e.g. `"submitted"`/`"pending_proof"`), so the checklist progress and any "done" aggregate do not count a submitted-but-unproven post as complete. Keep the existing separate **"Submitted, not live"** health metric (`distribute-tab.tsx:506-508`). **Verify no downstream code treats `"done"` as the only terminal state in a way this breaks** (completion gauges, coverage %). → **Open question 2 below.**

**2c. First-run CTA + feedback** — `app/dashboard/properties/[id]/launch-run-panel.tsx:228`
- Button text **"Start publish checklist" → "Add selected channels to publish checklist"**.
- After the run starts/channels are added, **anchor/scroll to the active checklist** and show clear feedback (the server action already redirects to `#distribute-header` in `actions.ts`/`distribution-actions.ts` — verify it lands on the checklist, and add an inline confirmation, e.g. "N channels added to your publish checklist"). If the redirect anchor doesn't reliably scroll, add a `scrollIntoView` on the active checklist panel on mount when a run is freshly created.

**2d. Remove dishonest auto-syndication copy** — `app/dashboard/properties/[id]/marketing-kit-card.tsx:228,234`
- Current L228 `"Syndicating to rental aggregators"` + L234 `"This rental is included in your listing feed for Rentals.ca, Zumper, and partner sites - no posting needed."`
- **Replace with the honest wording already used on the Distribute tab** (`distribute-tab.tsx:719-721`): *"This rental is in your Vacantless feed. A partner site still needs to accept and show it before it is live there."* Do **not** name Rentals.ca/Zumper as guaranteed destinations and do **not** say "no posting needed" — no accepted partner feed route exists. Submitted/feed state must never read as live.

---

## PART 3 — RentFaster deep card (`distribution-channels.ts`, `listing-fill-sheet.ts`, `listing-guardrails`, `distribute-tab.tsx`)

RentFaster is the **model channel**. Real dogfood findings from Noam's logged-in account for **50 Glenrose Unit 4** drive every item below.

**3a. Fix the portal URL (prod bug)** — `lib/distribution-channels.ts:125`
- `portalUrl: "https://www.rentfaster.ca/list-property/"` → **`"https://www.rentfaster.ca/admin/add-listing/"`** (`/list-property/` is a 404). Add card copy that the flow **starts logged in**, then choose **`Single Unit`**. The "Open RentFaster.ca →" button (`distribute-tab.tsx:738-743`) will then point at the working page.

**3b. Fix the fill sheet** — `lib/listing-fill-sheet.ts:691-869` (`rentFasterFields`, `RENTFASTER_STEP`)
- **Property type** (currently preset `"Apartment"`): RentFaster **Single Unit has no "Apartment"**. Change to an **editable assumption + "Review property type"** prompt — e.g. default to `"Fourplex"` for a unit in a 4-plex and label the field **"Review property type (RentFaster Single Unit has no 'Apartment' — pick the closest; e.g. Fourplex)"**.
- **Province** (currently absent): **add** a field/guardrail **"Province" preset "Ontario"** with note **"RentFaster defaults to Alberta — set it to Ontario."**
- **Address**: annotate **"Use Google autocomplete: type the address, Arrow-Down/Enter to select a suggestion, then confirm the postal code auto-filled."** **Community**: note **"may not populate until the address suggestion is selected."**
- **Photos** (currently Step 3, **before** payment Step 4): RentFaster only allows photo upload **after payment**. **Do not instruct uploading photos before the payment gate** — move the photos step to after payment (or clearly annotate "Photos upload only after payment — do this in the post-payment step"). Fix the step ordering so the sheet never says "upload photos" pre-payment.
- **Home Features**: note **"selected via an inline 'Add Feature' picker, not checkboxes."**
- **Promotion**: guardrail **"The promotion UI can appear pre-selected — do not add a paid promotion unless you want one."**
- **Payment** (currently hardcoded `"New Rental Ad - $54.50 + tax"`): replace the single stale price with **package guidance**, not one number:
  - "Confirm the selected package, add-ons, and total **before paying** (the public price page may differ)."
  - Observed checkout (2026-07): **Single Listing ≈ $47.50**; **Single Listing + Credit Report ≈ $67.50**; **Zumper Network Add-On +$29**; a **default cart came to ≈ $109.05 with HST** (Credit Report + Zumper preselected). For a **lean base listing (≈ $53.68 with HST)**, **remove the Credit Report package and the Zumper add-on** unless you want them.
- **Downstream syndication** (new copy): "RentFaster says a base listing also lists on **Rentals.ca, RentBoard, and RentCanada** — treat that as **RentFaster's downstream syndication (paid lane), not a Vacantless integration**. Capture the RentFaster live URL as proof. **Zumper/PadMapper is a paid add-on, not automatic.**"
- **Contact**: note "RentFaster contact methods default to Phone/Text/Email and may use your RentFaster account phone/email. Leads may arrive via **RentFaster's inbox/contact methods** as well as your Vacantless tracked link."

**3c. RentFaster operator tools on the card** — `app/dashboard/properties/[id]/distribute-tab.tsx:736-750`
- **Open RentFaster** — keep the button; it now uses the corrected `portalUrl` (§3a).
- **Field sheet inline or one click** — surface the RentFaster field sheet **from the card** (expandable/`<details>` or a direct in-card link), not only via the "Photos & marketing" back-link.
- **Copy title** and **Copy description** — add **separate** buttons (today there's only a single combined `"Copy this channel's wording"`, `distribute-tab.tsx:616,745-746`). Keep the combined one if useful, but expose title and description independently.
- **Copy tracked inquiry link** — add a per-channel **Copy tracked link** button (§3d).
- **RentFaster gotchas checklist** on the card: province default (Alberta→Ontario), remove Credit Report + Zumper add-on unless wanted, Google-autocomplete address, **photos only after payment**, promotion not auto, and **proof capture** (paste the real `rentfaster.ca` live ad URL before marking live).

**3d. Per-channel pre-reserved tracked link, before posting** — reservation from S487 / mig `0144`
- The reserved blank `listing_posts` draft per (property, portal) already exists (`actions.ts:1289-1338` `startDistributionRun` `reservedByChannel`; `:1577-1646` `addRunChannel` `reservedPostId`; partial unique index `listing_posts_blank_draft_unique`). Today the tracked link (`buildTrackedLink(publicUrl, listing_post_id)`) only surfaces **when live** (`page.tsx:1240-1252`) and RentFaster is **not** a co-pilot channel, so **no attributed link is offered pre-post**.
- **Surface the reserved tracked link on the RentFaster card *before* posting**, using the reserved draft's `listing_post_id`, so the operator can paste an **attributed** inquiry link into the RentFaster ad instead of the base non-attributed public link. **Do not** force the base link. → **Open question 1 below** (confirm this doesn't cross a "tracked link only when live" invariant — it shouldn't; the reserved draft exists precisely for pre-post attribution).

---

## PART 4 — Honest channel invariants (PRESERVE — all confirmed present at `54ee07d`)

Do not weaken any of these:
- **No fake direct integrations.** Rentals.ca and RentFaster are **not** connected feeds — no partner-accepted route exists. (Fixing §2d is part of honoring this.)
- **Never** auto-login, auto-pay, auto-submit, auto-click Publish, solve CAPTCHA, or store portal credentials.
- **Proof-before-live everywhere.** `completeCopilotPost` (`distribution-actions.ts:559`) stays the **only** co-pilot Live-write path. Concierge/broker `validateListingPost` (`listing-distribution.ts:264-289`) stays the **only** concierge/broker Live-write path; it already host-guards `rentfaster` (`isRentFasterListingUrl`) and `realtor_ca` (`isRealtorCaListingUrl`).
- **Preserve the S482 `!item.copilotScript` guard** (S489 P1 fold): server side in `updateRunItem` (`actions.ts` ~L1435/L1455) and UI in `launch-run-panel.tsx:313,480`. A co-pilot channel can never be marked live via the generic status form.
- **Realtor.ca stays licensed-agent / MLS handoff only** (`distribution-channels.ts:158` `mode:"broker"`).

---

## PART 5 — Depth over breadth

Make the **main path** (Parts 1–2) and **RentFaster** (Part 3) excellent. Do **not** ship 10 shallow cards. Only apply the same pattern to another channel this slice if it is **trivial and low-risk** (e.g. a portal-URL/label correctness pass on an existing card) — otherwise leave other channels as-is. Two deep cards beat five bookmarks.

---

## PART 6 — Verification (run on the Mac; report results)

Run the distribution/listing tests (all six exist, confirmed):
```
npx tsx scripts/test-distribution-run.ts
npx tsx scripts/test-distribution-channels.ts
npx tsx scripts/test-distribution-publish.ts
npx tsx scripts/test-distribution-copilot.ts
npx tsx scripts/test-listing-fill-sheet.ts
npx tsx scripts/test-listing-guardrails.ts
```
Then:
```
./node_modules/.bin/tsc --noEmit
npm run lint
npm run build
```
**Add/extend test cases** for the behavior changes:
- `test-distribution-publish.ts`: `submitted` does **not** map to run-status `"done"`; submitted tone is not the live/positive tone; coverage/completion excludes submitted-not-proven.
- `test-distribution-channels.ts`: RentFaster `portalUrl` host is `rentfaster.ca` and path is `/admin/add-listing/` (not `/list-property/`).
- `test-distribution-run.ts`: "in active run" count is `runItems.length` with a run and `0` (or the `defaultSelected` value is a *separate* "selected" metric) with no run.
- `test-listing-fill-sheet.ts`: RentFaster province preset = Ontario; property-type is a "review" field (no bare "Apartment" preset); photos step is **after** payment; payment field carries package guidance, not a single hardcoded price.
- `test-listing-guardrails.ts`: RentFaster guardrails include province default, add-on removal, promotion-not-auto, photos-after-payment, proof capture; `isRentFasterListingUrl` still rejects `/list-property`, `/prices`, root, and non-digit-id paths and accepts a real `/rentals|listings/.../<id>` URL.
- Honesty: no "no posting needed" / guaranteed-aggregator copy remains in `marketing-kit-card.tsx`.

**Cowork will separately live-QA** (read-only) on 833 Pillette / 50 Glenrose after the diff is verified.

---

## Open questions for Codex

1. **Pre-reserved tracked link on a non-co-pilot card (§3d):** surfacing `buildTrackedLink(publicUrl, reservedListingPostId)` on the RentFaster card *before* a live post exists — confirm this does not violate the "tracked link only when live" expectation elsewhere. The reserved blank draft (mig 0144) is created for exactly this attribution; the link should carry `?p=` from the reserved `listing_post_id`. OK to surface pre-post?
2. **`submitted` run-status (§2b):** changing `submitted` out of the terminal `"done"` bucket — confirm nothing downstream (coverage %, completion gauges, "all done" states, analytics) depends on `submitted → "done"` in a way that regresses. Prefer a new `"submitted"`/`"pending_proof"` status over reusing `"done"`.
3. **Fill-sheet ordering (§3b):** move the photos field to after payment vs. keep position and annotate "after payment only" — your call; the hard requirement is that the sheet never instructs a pre-payment photo upload.

## Explicitly NOT in this slice
- No migration. No Realtor.ca referral network (stays dark). No new co-pilot transport. No 10-channel bulk add. No changes to `completeCopilotPost`/`validateListingPost` write-path contracts (only extend guardrail *content* + the RentFaster host URL). No billing/entitlement changes.

## Files expected to change (focused diff)
- `app/dashboard/dashboard-nav.tsx` (label)
- `app/dashboard/properties/page.tsx` (title/subtitle/empty copy + row Publish action)
- `app/dashboard/properties/[id]/page.tsx` (market-tab label + prioritize Distribute bridge)
- `app/dashboard/properties/[id]/distribute-tab.tsx` (in-active-run count; RentFaster operator tools + gotchas + tracked link + inline field sheet)
- `app/dashboard/properties/[id]/launch-run-panel.tsx` (CTA copy + scroll/feedback)
- `app/dashboard/properties/[id]/marketing-kit-card.tsx` (honest feed copy)
- `lib/distribution-publish.ts` (submitted ≠ done/positive)
- `lib/distribution-channels.ts` (RentFaster portalUrl)
- `lib/listing-fill-sheet.ts` (RentFaster fields: province, property-type review, photos-after-payment, payment guidance, downstream syndication, contact note)
- RentFaster guardrails source (wherever `hasGuardrails` content lives) + the two test scripts above.

**Before final, report:** what changed, what passed (test/tsc/lint/build), what was intentionally not changed, and what remains next strategically.
