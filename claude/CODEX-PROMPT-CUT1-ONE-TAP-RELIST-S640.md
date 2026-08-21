# CODEX PROMPT — CUT 1: One-tap relist entry (S640, paste-ready)

> Trimmed from `claude/CODEX-PROMPT-FLOW-FRICTION-CUTS-S638.md` (CUT 1 only). Design of record: `claude/DESIGN-GET-IT-LIVE-FLOW-FRICTION-S638.md` + curtain principle in `claude/DESIGN-PUBLISH-GET-IT-LIVE-CURTAIN-S636.md`. Noam approved this cut (S638).
>
> **Why CUT1 only:** CUT2 (extension-first) is deferred; CUT3 is SUPERSEDED — PR #13 already removed the "Advanced / More options" dropdown from the simple default path on purpose, so CUT3's "hide mechanism behind Advanced" premise no longer holds. Do NOT restore the Advanced dropdown. Ship CUT1 as a standalone PR.

## Base
Branch from `main` @ **`fe8d301`** (verify `git rev-parse --short HEAD` after checking out main; current prod is a redeploy of fe8d301). Do NOT branch from any parked `codex/*` branch — their work is merged. All line numbers below were verified against current main on 2026-08-10 — treat as anchors, re-verify before editing.

## Honesty rule (do not violate)
The person is ever asked for exactly TWO things — **sign-in** and **pay** — nothing else. Nothing posts before the preflight confirm (KI999). The extension/app never posts, signs in, pays, OR marks a channel live for the landlord. This cut only adds a shortcut INTO the existing guided-post surface; it introduces no new posting path and no new consent surface.

## Problem
Re-posting an already-live listing costs ~10 taps + ~4 scrolls (Rentals → open unit → Get online → scroll → … → Details → Start guided posting). For a relist the person should not touch any intermediate surface.

## Goal
From the property header AND from the listing-freshness email nudge, ONE tap drops the person directly onto the guided post for the stale channel: the `#publish-checklist` section scrolled into view, and — when a channel is known — the `#for-you-{key}` row for that channel focused. No new posting path; reuse existing plumbing.

## Scope — build exactly this

### 1. FLAG
Add `RELIST_ONE_TAP_ENABLED` (default OFF, same env-flag pattern as `PUBLISH_SIMPLE_DEFAULT_ENABLED` / `STEP_CLARITY_LIVE_ENABLED`). Flag OFF ⇒ renders byte-identical to today. Noam flips in Vercel after review.

### 2. HEADER CTA
In `app/dashboard/properties/[id]/page.tsx`, near the existing **"Duplicate this property"** button (**L2287**), add a primary **"Relist / refresh this ad"** CTA, shown only when the listing is Live and the flag is on.
- HONOR the existing S447 relist guard for leased units — do NOT bypass it. The guard is already wired here: `relistLeasedProperty` action (imported L33), the `searchParams.relist === "confirm"` confirmation block (**L2097**), the **"Relist anyway"** button (**L2110**), and the `relisted` success banner (**L2123**). For a Live (non-leased) unit the CTA links straight to the checklist; for a leased unit it must route through the existing confirm flow first, unchanged.
- Link target: `#publish-checklist` (see step 3). If a single stale/for-you channel is the obvious target, prefer `#for-you-{key}` (see step 4).

### 3. DEEP-LINK REUSE (land on the checklist)
Use the EXISTING deep-link machinery — `app/dashboard/properties/[id]/section-deeplink-opener.tsx` and/or `tabbed-sections.tsx` (both resolve `window.location.hash` → `scrollIntoView` + auto-open). The `#publish-checklist` anchor already exists (`launch-run-panel.tsx:378` and `:450`; also referenced throughout `distribute-tab.tsx`). Ensure the Distribute tab is selected before the hash resolves (the header link may need `?tab=distribute#publish-checklist` so `tabbed-sections.tsx` switches tab then the opener scrolls). Do NOT hand-roll a new scroll/anchor system.

### 4. CHANNEL FOCUS — reuse the anchors PR #14 already shipped
PR #14 (step-clarity) already renders per-channel anchors: `publish-everywhere.tsx:728` emits `id={\`for-you-${row.key}\`}`, and `:321` already links to `#for-you-${firstOutstandingForYou.key}` from the "Your next step" card. So for per-channel focus, point the relist link at `#for-you-{key}` for the target channel — do NOT invent a new `channel` query param or a new expand mechanism. If no single channel is obviously the target, fall back to `#publish-checklist`.

### 5. FRESHNESS NUDGE
The daily 10am ET listing-health digest (`app/api/cron/distribution-freshness/route.ts`) builds its per-property link via `distributeUrl()` in **`lib/listing-health.ts:179`**, currently returning `${appUrl}/dashboard/properties/{id}?tab=distribute`. Append the relist anchor so the digest CTA lands on the checklist: `…?tab=distribute#publish-checklist`. This flows through `firstDistributeUrl` + `detailsText` (route.ts L306/L311) automatically — change only `distributeUrl`. Gate the anchor append behind the same flag if `lib/listing-health.ts` can read it; if the lib is flag-agnostic, appending `#publish-checklist` unconditionally is acceptable (it's inert when the checklist renders normally) — state which you did in the PR. Do NOT change the cron schedule or the digest's selection logic.

## Out of scope
No change to `publishProperty` (`actions.ts`) semantics, `completeCopilotPost`, `resolvePublishMode`, `derivePublishPreflight`, the S447 relist-guard behavior, or any honesty invariant. No migration. No new server action. Do NOT restore the Advanced dropdown (removed in #13 on purpose).

## Gate
- `npx tsc --noEmit` clean (this is the only build check that runs in the on-device Linux VM — KI1030).
- Flag OFF ⇒ byte-identical to today.
- Flag ON ⇒ header "Relist / refresh this ad" appears on a Live unit; leased unit still routes through the S447 confirm; the link lands on `#publish-checklist` (and `#for-you-{key}` when a channel is targeted); the freshness digest link carries `#publish-checklist`.
- `git diff --check` clean.
- `next lint` / `next build` are run by Noam natively or verified by the Vercel preview build (they do NOT run on-device — KI1030).

## Deliver
Branch + PR (merge via the GitHub web button — `gh` is not installed on the Mac). In the PR report: flag name, files touched, whether per-channel `#for-you-{key}` focus shipped or fell back to `#publish-checklist`, and the gate output.
