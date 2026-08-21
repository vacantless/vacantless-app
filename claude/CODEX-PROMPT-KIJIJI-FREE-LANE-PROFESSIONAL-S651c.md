# CODEX PROMPT — Kijiji FREE lane: support Professional accounts (1-free-slot rule) — S651c

**Repo:** `vacantless-worker`, continue on branch `codex/s651-kijiji-paid-lane` (stack on the same branch; the paid lane stays built-but-dark and untouched).
**Standing rules:** no em dashes. Free lane only here - this must NEVER select a paid card. The only thing that ever gets clicked is a strictly-$0 plan card; anything else fail-safes to needs_payment at $0.

## What live recon proved (2026-08-13, Agile prod, $0)
Agile's Kijiji is a Professional account, but it is NOT a no-free-plan account. The plan wall carries this rule (read off the live screenshot):
> "There is a limit of 1 free listings at a time in this category ... when you have 1 free listing posted in this category, each additional listing posted will not be free and will be subject to a fee."

So a Professional account gets ONE free Kijiji listing at a time. The paid wall (Lite $29.95 / Standard $53.79 / Plus $95.13 / Premium $254.25) appeared only because Agile's free slot is currently occupied by its live Windsor ad (unit 20). When the slot is FREE, a $0 option should be available on the wall.

The current FREE lane cannot reach that wall on a Professional account: `freeLanePreflight` -> `ensureOwnerEligible` hard-fails with `professional_account_no_free` (no Owner "for rent by" radio) BEFORE Post is ever clicked, so it never gets to the plan wall to check for a $0 card.

## The fix (scope: FREE-lane path in `src/phase-b-submit.ts`)
Let the free lane PROCEED to the plan wall on a Professional account, and let the existing strictly-$0-card detection be the only free/no-free authority.

1. **Eligibility (generalize `ensureOwnerEligible` / the pre-post gate):**
   - Owner radio present -> select Owner as today, proceed.
   - Owner absent + Professional present -> reuse the S651b `ensureProfessionalEligible` best-effort selection (label click -> force check -> DOM set+dispatch) to make Professional the active "for rent by", then PROCEED to Post. Do NOT return `professional_account_no_free` here anymore.
   - Neither present -> `owner_option_missing` (unchanged).
   Keep `professional_account_no_free` as a possible FINAL outcome only if you still want it for logging, but it must no longer BLOCK the pre-post step for a Professional account.

2. **Free-slot banner (`readFreeSlot` / `freeLanePreflight`):** the "You have N free ad remaining" banner may not render on a Professional account. Make its absence NON-fatal on the Professional path: if the banner is missing, do not bail at preflight - proceed to the plan wall and let the $0-card check decide. Keep the banner as a positive signal when present (Owner accounts unchanged).

3. **Plan wall (unchanged): `attemptFreePlan` / `prepareFreePlanForPost`** already scrape the plan cards, pick the strictly-$0 card via `isFreePlan` (price === 0), assert $0 + no paid button, and only then click Post. Leave this as the real gate:
   - Free slot available -> a $0 card exists -> select it -> post free -> capture URL. (Headless, $0.)
   - Free slot occupied / no $0 card -> fail-safe to `needs_payment` at $0. Never touch a paid card.

4. **Do NOT auto-take-down any other ad to free the slot.** Freeing the slot (removing the existing Windsor ad) is a separate, human-gated decision. This build only makes the free lane WORK when a slot is already free; it never deletes a different unit's live ad on its own.

Reuse the messy-scrape learnings from the paid recon: the plan cards are Lite/Standard/Plus/Premium with their own "Select" buttons and per-card prices; the `featurePackage` value is shared across cards (all read as PKG_2), so identify the $0 card by PRICE (=== 0), never by packageCode. If the current `scrapePlans` over-matches (it returned 6 nodes for 4 cards and grabbed page-heading text as titles), tighten `planCardSelector` to the actual plan-card container so each card maps 1:1 to its price + Select control - but keep price-zero as the only free signal.

## Tests
- Existing free-lane + Owner-account tests stay green (test org path unchanged).
- `npm run test:paid-plan` still 29/0, `typecheck` clean, `git diff --check` clean.
- If practical, add a unit asserting: Owner-absent + Professional-present -> eligible/proceed (not a hard fail).

## Proof plan (after this lands) - two stages, both $0 until a real free post
- **Stage A (slot occupied, safe):** run `submit:b:live:free` on an approved Agile item as-is. Expected: eligibility now passes, it reaches the plan wall, finds NO $0 card (slot held by the Windsor ad), and fail-safes to `needs_payment` at $0. This alone confirms the eligibility + wall-reach fix without posting or freeing anything.
- **Stage B (slot free, the real headless $0 proof) - HUMAN-GATED:** with Noam's go, first free the slot (take the existing Agile Windsor Kijiji ad, unit 20 / ad 1739552585, down), then run `submit:b:live:free` on the approved Agile item. Expected: plan wall now shows a $0 card, the lane selects it, posts free, captures the live URL. If NO $0 card appears even with the slot free, that disproves the 1-free-slot assumption - STOP and report, do not pay.

Report back: the diff, test results, and confirm the paid lane + all paid guards are untouched.
