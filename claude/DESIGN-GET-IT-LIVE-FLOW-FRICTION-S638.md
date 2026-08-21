# DESIGN — "Get it live" flow friction: high value, low friction (S638)

**Status:** design captured S638 (2026-08-10) from a LIVE walk-through. Trigger: Noam asked me to drive the Slice-2 capture proof on 50 Glenrose Ave Unit 4 (relist for Abbas, Abbas Husain org). I navigated the real production flow end to end, hit the friction firsthand, and Noam's directive became: **"ensure the flow is high value, low friction."** This doc records the measured friction, corrects what we thought about the co-pilot surfaces, and specs the three highest-leverage cuts as Codex-ready slices. Design of record it extends: `claude/DESIGN-PUBLISH-GET-IT-LIVE-CURTAIN-S636` (the curtain principle) and the Slice roadmap therein.

## The principle (unchanged, from S636)
> An elderly / ESL / busy landlord gets a listing live **without knowing what is happening**. The person is ever asked for exactly TWO things — **sign-in** and **pay** — and nothing else. Everything else is behind a curtain until live output. The flow ends on **live links**, not a dashboard.

## The measured friction (real click-path, S638 live walk)
To reach the point of (re)posting ONE channel (Kijiji) for a listing that is **already Live on 4 channels**, the actual production path was:

1. Rentals list (org: Abbas Husain)
2. Open the unit → "Get this listing online"
3. Property page → **Get online** tab
4. Scroll down to the distribution surface
5. Scroll past "We post these for you"
6. **Advanced / More options** → Open
7. Scroll to the "Channel reach — Publish to all channels" rail (2/14)
8. **Open 1-tap queue**
9. Guided-posting checklist → Kijiji **Details**
10. **Start guided posting** → the no-install sidecar window

That is ~10 taps and ~4 scrolls to reach the post action for a single channel. Before getting anything live, the person sees channel counts, "2/14", instant/for-you/after-setup buckets, rails, and status chips. **That is the gap against the curtain principle** — the low-friction machinery exists but is buried, and the pre-live surface is dense with mechanism.

## Corrected understanding of the co-pilot surfaces (learned on the live walk — supersedes the S638 memory note that lumped the sidecar in with the receiver)
Two distinct co-pilot surfaces exist, and they are NOT interchangeable:

- **`copilot-panel.tsx`** — the INLINE "Guided posting - {channel}" block rendered in the checklist (the block with the "Open {channel}" link + `GuidedPostingPromise` three-column layout + honesty bullets). It carries the FULL extension integration: the `sendToExtension` gesture that mints a nonce and posts `copilot_job`, the ping/pong detection (`extReady`), the `captured_url` listener, and the `completeCopilotPost` form with the `external_url` field. **The "Send to Chrome extension (beta)" button is wrapped in `{extReady && (…)}`** — it only renders once the extension answers the app's ping with a pong. Its primary "Start guided posting" button calls `openSidecar` (opens the window below).
- **`sidecar-copilot.tsx`** — the standalone `/dashboard/properties/[id]/copilot/[itemId]` window, titled "GUIDED POSTING — NO INSTALL NEEDED". Copy buttons + the 7 manual steps + a manual "Live ad URL (required)" paste field feeding the mark-live action. **It has NO extension gesture and NO `captured_url` receiver — by design** (it is the no-install fallback).

**Consequence for Slice-2:** the capture gesture IS on the live path (the `copilot-panel.tsx` checklist block), correctly gated on the extension being installed + detected. On the live walk the button was absent only because the v0.3.0 extension was not loaded/detected in that Chrome. So Slice-2 needs NO app-side "surface it on the sidecar" fix (the earlier Slice-2b idea is DROPPED). The remaining Slice-2 open item is purely: load/detect the extension, then live-prove. If the extension IS loaded and `extReady` never turns true, THAT is a real detection bug (app-bridge ping/pong on `app.vacantless.com`) — debug that, don't rebuild.

## The three cuts, ranked (each ships flag-gated dark; Noam flips after review)

### CUT 1 (highest leverage) — One-tap relist entry. [= curtain Slice 5, pulled forward]
**Problem:** re-posting an already-live listing costs the ~10-step dig above. For a relist, the person shouldn't touch Advanced → 1-tap queue → Details → Start at all.
**Target:** from the listing (property header) AND from a "this ad needs a refresh" nudge, ONE tap drops the person directly onto the guided post for the stale channel(s) — the checklist's `copilot-panel.tsx` block for that channel, scrolled into view and started — skipping every intermediate surface. The relist reuses the existing `publishProperty` / "Sync updates / re-publish" path (actions.ts) plus a deep-link to the co-pilot item; no new posting path.
**Build direction:** add a "Relist / refresh this ad" primary CTA on the property header (and wire the freshness-cron nudge — `app/api/cron/distribution-freshness`, the daily 10am ET listing-health digest — to deep-link here). The deep-link opens `#publish-checklist` with the target channel's `copilot-panel` block auto-expanded + "Start guided posting" reachable in one tap. Anchors: property header (`page.tsx`), `distribute-tab.tsx` (`DistributeTab`), the checklist/`ForYouHandoff`, `copilot-panel.tsx`, `publishProperty` (actions.ts:1098), freshness cron.
**Honesty:** nothing posts before the person acts on the portal; relist still ends on the person's sign-in + post + one-tap mark-live.

### CUT 2 — Extension-first default path.
**Problem:** when the extension IS present, its auto-fill + auto-capture path is a small, easy-to-miss "Send to Chrome extension (beta)" button BELOW the big "Start guided posting" (which opens the manual no-install sidecar). So even extension users get funneled to the high-friction manual path. When the extension is ABSENT, nothing frames installing it as the one-time unlock that makes every future relist near-instant.
**Target:** in `copilot-panel.tsx`, when `extReady` is true, make the extension path the PRIMARY CTA ("Fill it on {channel} + bring the URL back") and demote "Start guided posting" (manual) to the secondary link. When `extReady` is false, show a calm one-time "Install the helper once — then relists are near-instant" nudge (honest, dismissible, not nagging), with the no-install sidecar still one tap away as the fallback. Drop "(beta)".
**Build direction:** reorder/relabel the CTAs in `copilot-panel.tsx` on the `extReady` branch; add the install nudge on the `!extReady` branch. No change to `sendToExtension`, the `captured_url` contract, or `completeCopilotPost`. Anchors: `copilot-panel.tsx` (the `{extReady && …}` block, `openSidecar`, `sendToExtension`).
**Honesty:** the extension still never posts / signs in / pays / marks live; auto-fill + auto-capture + ONE-TAP confirm stands (Slice-2 decision). Install framing must not imply Vacantless posts for them.

### CUT 3 — Trim the pre-live surface (curtain the mechanism).
**Problem:** before anything is live the person sees channel counts, "2/14", instant/for-you/after-setup buckets, rails, and status chips — mechanism the curtain is supposed to hide.
**Target:** the default (flag `PUBLISH_SIMPLE_DEFAULT_ENABLED`, already GLOBAL) view shows only: the listing, one "Get this listing live" action, and — after the run — "you're live" + the links. Counts / "X/14" / rails / buckets move entirely behind "Advanced / More options" (Slice-1 started this; finish it so NONE of the numeric mechanism shows by default). The only things that ever surface pre-live are the two allowed asks: sign-in and pay.
**Build direction:** in `distribute-tab.tsx` + `publish-everywhere.tsx`, audit what renders above "Advanced" and push remaining mechanism (reach counts, the 2/14 ring, the three-bucket rail preview) below it; keep the front-loaded preflight (`ConfirmModal`, Slice-1) as the only gate. Anchors: `distribute-tab.tsx` (`DistributeTab` L384), `publish-everywhere.tsx` (`PublishEverywhere`, `ConfirmModal`), `lib/publish-everywhere.ts` (`summarizeReach`, buckets).
**Honesty:** reach "included" = instant + for-you, never the raw channel count; the curtain hides mechanism, never consent (KI999 — nothing posts before the preflight confirm).

## How this maps to the existing Slice roadmap (S636 curtain design)
- CUT 1 = Slice 5 (one-tap Relist on stale), pulled to the FRONT as the biggest single friction cut.
- CUT 2 = extends Slice 2/3 (the extension path becomes the default when present; install framed as the one-time unlock).
- CUT 3 = completes Slice 1's intent (make the calm view truly calm; move ALL numeric mechanism behind Advanced).
- Slice 2 (kill paste-back) is BUILT + unit-green in the extension (v0.3.0); its only open item is the live proof once the extension is loaded/detected — NOT an app change.

## Dispatch note
Each cut is a self-contained, additive, flag-gated slice with no migration. Recommend dispatch order: CUT 1 → CUT 2 → CUT 3. On request I will expand any of the three into a full `CODEX-PROMPT-…-S638` handoff grounded on `vacantless-app` main @ c1e5a51 (branch from `main`, not the parked `codex/s629` branch).
