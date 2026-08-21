# DESIGN — Presentation-layer command center (accessible 1-click multi-channel distribution)

Status: **CAPTURED FOR LATER — TOP PRIORITY** (Noam, s577, 2026-07-26). Not built.
This is the design-of-record for the presentation layer / command center. Goal
Noam set: our presentation must be **as good as or better than** the researched
reference below, especially for **account connections** (Stage 1). Reference
mockup: SyndicatePro screenshot (2026-07-24, in the project uploads).

Two inputs feed this doc: (1) Noam's accessibility spec for aged + ESL operators
(verbatim below), and (2) how it maps onto what Vacantless already has, so the
build is a presentation layer over real capability, not a rebuild.

---

## PART A — Noam's spec (captured verbatim)

### 1. Guiding design system for aged and ESL operators
- **Eliminate cognitive overload:** strict single-column vertical layout. No
  crowded grids or side-by-side dashboard components.
- **Eradicate technical jargon:** replace "API Sync," "OAuth Link," "Data
  Ingestion" with literal everyday action verbs.
- **Macro visual indicators:** never rely on tiny dots or colour alone. Oversized,
  high-contrast banners and explicit status sentences.
- **Fixed layout anchors:** "Back" and "Next Step" in the exact same corners on
  every page, so users never feel layout anxiety.
- **Universal language flag:** a permanent language dropdown pinned top-right on
  every screen for instant interface translation.

### 2. Stage 1 — LINK YOUR PORTALS (connect once)
- Step-by-step setup where the user connects their **12 target channels one time**:
  Canadian rental portals (realtor.ca, rentals.ca, rentfaster.ca, viewit.ca),
  classifieds (Kijiji), social (Facebook Marketplace, Instagram, LinkedIn,
  Snapchat), chat apps (WhatsApp Business).
- Layout: clean vertical list of large full-width blocks per platform, with highly
  visible brand logos for instant recognition.
- Status in plain capitals inside giant colour-coded panels, e.g.
  "🟢 ALREADY LINKED (Ready to automatically send listings)" or "🔴 NOT LINKED YET".
- Buttons use direct instructions, not tech words:
  "[🔑 CLICK HERE TO LOG IN WITH YOUR KIJIJI PASSWORD]".

### 3. Stage 2 — ADD PROPERTY DETAILS (intake once)
- Captures all property details from a **single action**, bypassing dozens of data
  boxes per site.
- Layout: top has three giant clear card options for feeding data in; bottom shows
  a live preview of the extracted results.
- Three intake methods: (1) copy a unique platform email address and forward any
  draft notes/description to it; (2) a giant drag-and-drop well for any old paper
  lease, PDF brochure, or MLS sheet; (3) a big button to a basic manual form.
- Automated feedback: background OCR + parsing, shown under
  "WHAT THE COMPUTER HAS READ SO FAR" with green checks, e.g.
  "Rent: $2,850/month ✅ Found automatically", "Bedrooms: 2 ✅ Found automatically",
  plus an AI-polished public description block.

### 4. Stage 3 — CHOOSE & BLAST LIVE (the 1-click launch)
- Final confirmation: review the unified package, choose active destinations,
  trigger concurrent multi-portal distribution with continuous visual assurance.
- Layout: split interface. Top = large photo + address specs. Middle = the main
  trigger. Bottom = live upload loops.
- The 1-click action: one oversized glowing green button spanning the viewport:
  "[⚡ CLICK HERE TO SEND LISTING TO ALL PORTALS NOW]".
- Live progress monitoring: on click, lock the button and show linear progress rows
  per channel with plain-text backend micro-steps so older operators don't close
  the screen in panic, e.g.
  "realtor.ca: [██████████] 100% LIVE!",
  "Facebook Marketplace: [███████...] 70% ⏳ Uploading Photos...",
  "Kijiji: [███.......] 33% ⏳ Formatting Text...".

---

## PART B — How this maps onto Vacantless today (grounding for the build)

The reference is presentation over plumbing Vacantless largely already has. The
build is a new accessible UI skin + a few gaps, not new backend.

### Stage 1 (Link portals) — the account-connection piece Noam most wants to match
- EXISTS: OAuth/connect callbacks for `facebook_feed` (Graph) and Instagram; the
  encrypted session store (`distribution_channel_sessions`); connect/disconnect on
  the Distribute tab; `distribution_channel_accounts` with `account_status`
  (connected / needs_login / needs_payment) + `automation_authorized`.
- CHANNEL REALITY CHECK (do not overpromise the 12): today's real posting channels
  are Kijiji, Rentals.ca, Zumper (rides to PadMapper), Facebook Page feed,
  Instagram. realtor.ca is MLS-gated (not a free direct post); rentfaster.ca /
  viewit.ca / LinkedIn / Snapchat / WhatsApp Business are NOT integrated. The UI
  can LIST all twelve as "coming" but must not show a connect button that does
  nothing (that breaks the "explicit status sentence" principle). Map each tile to
  a real `account_status` or an honest "NOT AVAILABLE YET".
- GAP: the accessible single-column wizard, giant colour-coded LINKED / NOT LINKED
  banners, plain-language buttons, the pinned language dropdown (i18n).

### Stage 2 (Intake once) — three methods already have rails
- EXISTS: `mls-pdf-import` + the AI listing import (S428/S430) + OCR intake +
  chunked intake = method 2 (drop a lease/PDF/MLS). The per-org ingest email
  address (`org_ingest_addresses`, `u-<token>@in.vacantless.com`) = method 1
  (forward to an address). The property edit form = method 3 (manual).
- EXISTS: the "WHAT THE COMPUTER HAS READ SO FAR" confirmation maps to the parser's
  structured output + confidence (the same exact/partial confidence the portal-lead
  parser reports).
- GAP: the three-giant-cards presentation + the live green-check extraction preview
  as one accessible screen.

### Stage 3 (Choose & blast) — 1-click already proven
- EXISTS: the done-for-you worker + 1-click autopilot (proven live s571); per-item
  status is a real state machine (`distribution_run_items.publish_status`:
  queued / needs_operator / submitting / live) with `distribution_verifications`
  (`verified_live`) as object-status proof — so genuine per-channel LIVE! states,
  not fake progress bars.
- GAP: the big glowing single button + the live per-channel progress rows with
  plain-language micro-steps. The micro-steps should be driven by the REAL item
  status transitions (rule 16: only the object's own status proves LIVE), not a
  cosmetic timer — that is what makes ours honest and better than the mockup.

### Where OURS is inherently better than the reference
The reference is publish-only. Vacantless owns the whole loop, so the command
center can show what a syndication-only tool cannot: the lead coming BACK (capture
/ ingest) and the ad's END OF LIFE (take-down on lease-up, proven live s577). A
fourth stage — "AFTER IT'S LIVE" (leads landing + auto take-down when leased) — is
the differentiator no SyndicatePro-class mockup can match.

### Build constraints to carry in
- Accessibility is the product here: WCAG-large targets, high contrast, real i18n
  (the language dropdown is not decorative), plain language, fixed anchors.
- Honesty over polish: every status sentence must reflect a real object status
  (rule 16); never a channel tile or progress bar that implies a capability we do
  not have.
- Likely a design pass from us first (wireframe the 3–4 stages), then Codex slices
  per stage.

---

## Open questions for the design pass (ask Noam when we start)
- Which of the 12 channels are v1 (real connect) vs "coming soon" tiles?
- Languages for the dropdown at launch (EN + FR at minimum for Canada / Aaliyah?).
- Is this operator-facing only, or also a landlord/self-serve surface?
- Does Stage 4 (post-live leads + take-down) belong in the same wizard or the
  existing property view?
