# DESIGN — S620: Get-online shared-header shortcut cleanup + step-5 account copy

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** cosmetic/copy polish, single file-scoped lane. Closes the two carried S618 Lane 2 loose ends.
**Blast radius:** ONE file — `app/dashboard/properties/[id]/distribute-tab.tsx`. No migration, no flag, no server-action / data-model / readiness-logic change.
**Prod at authoring:** SHA `778833b` (S619). `distribute-tab.tsx` was last touched by S619 — build on the current tip.

## Why (verified this session, code + live dogfood on North Star QA)

Two carried loose ends from S618 Lane 2, both verified 2026-08-03 (code read at 778833b + Claude-in-Chrome dogfood on North Star QA property `b5d539f0` / 1420 Ouellette Unit 3, run committed then cancelled to restore the fixture):

### Loose end 1 — the shared dark header's secondary shortcut links mis-target in Simple mode
- The dark `#distribute-header` (distribute-tab.tsx ~line 472) is rendered by `DistributeTab` **above** `<GetOnlineView simple=… advanced=… />` (line 545), so it is **shared and always shown in BOTH modes**. `DistributeTab` is a server component and does not know the client-side mode.
- Inside that header (lines ~497-510) are two conditional shortcut `<a>` links:
  - "Finish listing details →" → `href="#rental-details"`
  - "Set Live →" / "Review listing status →" → `href={canSetLive ? "#publish-action" : "#rental-details"}`
- **Verified anchor inventory:**
  - `#rental-details` **does not exist anywhere in the app** (grep of `app/` + `components/` = empty). So the "Finish listing details →" link and the `!canSetLive` "Review listing status →" fallback are **dead in every mode.**
  - `#publish-action` exists only in `page.tsx` (~line 2240, the page-top `publishProperty` form) — it is **not in the Simple-mode DOM** (empirically confirmed via Claude-in-Chrome `find`: "element with id publish-action does not exist"). So the "Set Live →" link **no-ops in Simple mode.**
  - The Simple tree has its own anchors (`#simple-basics`, `#simple-set-live`, …) and its own prominent **"NEXT STEP"** hero card whose `firstOpen` href already points at the correct `#simple-*` step. The Advanced command center has its own Set Live (`#publish-action`).
- **Conclusion:** these header shortcuts are leftovers from the pre-Simple single-view world. Each mode already surfaces its own next-step affordance prominently, so the shared-header shortcuts are redundant **and** stale.

### Loose end 2 — step-5 "Connect accounts" copy contradicts the checklist's "Needs login"
- Verified: Facebook Marketplace and Kijiji are **guided-posting (browser-copilot)** channels. In `channelAccountReadiness` they resolve to `ready` (login happens live during guided posting, not as a pre-connect gate), so they are **never** in step-5's `accountNeeds`. The step-5 amber "Connect accounts → Settings" card only fires for org-account feed partners (`needsOrgAccount:true` → Zumper / Instagram / FB-page feed / private partner feed).
- Live on North Star QA, the Simple picker offers only `Ready` sites (Vacantless public page, Listing feed, Facebook Marketplace, Kijiji, LinkedIn). **No `needsOrgAccount` channel is selectable in Simple mode on that org**, so step-5's amber card is effectively **dormant** there.
- **The real UX finding:** with FB + Kijiji committed to a run, step 4's checklist showed both as **"Needs login" (amber)** while step 5 simultaneously showed **green** — *"The selected sites do not need more account setup right now."* Two different readiness notions on one screen read as a contradiction. A self-managing landlord could take step 5's copy to mean "nothing to sign into," then be surprised when guided posting asks them to log in.
- The connect path itself is **code-correct**: where the amber card does render, its button and the panel-level "Connect accounts" / "Guided setup" buttons all target `/dashboard/settings?tab=distribution`, which `resolveTab` handles and which hosts the real per-channel connect UI (`updateDistributionChannelAccount`); the return-to-green is deterministic. Nothing is broken or unsafe — this is a copy/semantics mismatch only.

## The fix (both copy/markup-only, one file)

### Fix 1 — remove the stale shortcut links from the shared header
Delete the two conditional shortcut `<a>` blocks (the "Finish listing details →" block and the "Set Live →/Review listing status →" block) from `#distribute-header`, keeping the readiness badges (the status pill + "N sites posted" pill). This matches the header's own stated purpose ("Header — what this tab is + a one-line readiness signal") and removes every stale/mode-wrong anchor with **zero** mode logic. Each mode keeps its own prominent next-step affordance (Simple: the NEXT STEP hero + numbered steps; Advanced: the command center + page-top Set Live).

*Rejected alternative:* make the links mode-aware. The header is server-rendered and shared, so it would need the client mode threaded down (context/prop) plus per-mode target maps — real complexity for a cosmetic shortcut that duplicates affordances each mode already shows. Not worth it.

### Fix 2 — reword step-5's green/done copy so it doesn't contradict "Needs login"
Keep step 5's logic and its done/green state exactly (it is genuinely non-blocking for guided-posting sites). Only change the `accountsReady` **copy** so it distinguishes "an org account to connect in Settings" from "you sign in while you post":
- detail (subtitle) → e.g. **"No accounts to connect here."**
- body → e.g. **"Sites like Facebook and Kijiji ask you to sign in while you post — that happens during guided posting, not here. Continue to posting and paste each live ad link when it exists."**

Leave the `accountNeeds.length > 0` amber branch (the org-account feed-partner → Settings path) untouched.

*Optional (not required for MVP):* only show the "sites like Facebook and Kijiji" sentence when a selected channel is actually a guided-posting/needs-login site, so the note is suppressed for a Vacantless-only selection. Adds a small derived boolean; defer unless Noam wants it.

## Scope guards
- ONE file: `distribute-tab.tsx`. No migration, no flag, no change to readiness logic, server actions, the Settings route, or the Simple/Advanced trees' structure.
- Do NOT touch `#publish-action`/`page.tsx`, `launch-run-panel.tsx`, or `lib/distribution-capabilities.ts`.
- Copy is illustrative — Noam may tweak wording; keep meaning (Fix 2 must not imply "nothing to sign into anywhere").
