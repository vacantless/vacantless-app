# CODEX PROMPT — "Get it live" Slice 2: kill paste-back (extension auto-captures the live URL) — S638

> Mirror of the on-disk handoff at `vacantless-app/claude/CODEX-PROMPT-GET-IT-LIVE-SLICE2-S638.md` (rule 36). Design of record: `claude/DESIGN-PUBLISH-GET-IT-LIVE-CURTAIN-S636.md` (Slice 2). Predecessor shipped: `CODEX-PROMPT-GET-IT-LIVE-SLICE1-S636` (PublishEverywhere is now the default Distribute view, live in prod).

Grounded on `vacantless-app` main @ `c1e5a51` (verify `git rev-parse --short HEAD`) and `vacantless-extension` v0.2.0. Both repos are subfolders of the connected project folder.

WORKING-TREE NOTE: the app tree may be parked on branch `codex/s629-inquiry-phone-settings-toggle` (@ decb0d1) with empty staged/tracked diffs — that work is ALREADY MERGED to main (PR #12). Branch this slice from `main` (`git checkout main && git pull`), not from that stale branch.

## Goal
Remove the single fiddliest step from every relist: making the landlord copy the live ad URL out of the portal tab and paste it back into Vacantless. When the person posts an ad on a co-pilot channel (Kijiji / Facebook Marketplace), the extension reads the resulting live ad URL off the portal page and delivers it back to the open Vacantless tab, which **pre-fills** the existing "Live ad URL" field. The person then taps the existing mark-live button once. **No new server surface, no migration, no auto-post, no auto-mark-live.**

## Decision already made (do NOT re-open)
**Auto-fill + one-tap confirm.** The extension pre-fills the URL; the person still taps "mark live" and the Vacantless server still re-validates (`completeCopilotPost`). We do NOT auto-submit / auto-mark-live in this slice. Rationale: the Meta App Review commitment is that the extension never posts, signs in, pays, OR marks live for the landlord; keeping one explicit human tap on the marking-live step preserves that. (The "always auto-complete this channel" hands-off preference is a deliberate later fast-follow — see Out of scope.)

## Persona / rule (do not violate)
Anyone (elderly / ESL / busy) gets a listing live without seeing mechanism. The person is ever asked for exactly TWO things — sign-in and pay — and nothing else. Killing the paste-back removes a THIRD ask (the manual copy/paste chore) that was never sign-in and never pay. The curtain hides mechanism, never consent.

## The good news: most of this existed once — re-land it, don't reinvent
This exact capability shipped as S483 Lane A ("pure courier") and was then **archived** — not for a defect, but because the extension was rewritten from a copy-buttons+capture generation into the current auto-**fill** generation (`fill-page.js`), and the capture leg simply wasn't carried forward. Two consequences you can exploit:

1. **The app RECEIVER is still live and unchanged.** `app/dashboard/properties/[id]/copilot-panel.tsx` (and its sidecar twin `app/dashboard/properties/[id]/copilot/[itemId]/sidecar-copilot.tsx`) already listen for a nonce-gated `captured_url` postMessage and pre-fill the controlled `external_url` field on receipt. The message contract the app expects:
   - `event.source === window`, `event.origin === window.location.origin`
   - `data.source === "vacantless-extension"` (EXT_SRC)
   - `data.type === "captured_url"`
   - `data.itemId === <this item>`, `data.channel === <this script.channel>`, `data.nonce === <the nonce the app last minted>`, `data.url === <live url string>`
   The app mints a nonce when the operator clicks its "send to extension" gesture; a captured URL is accepted ONLY if it echoes that exact nonce. Read this file first and treat its contract as fixed — your job is to make the extension satisfy it again, not to change the app receiver (beyond re-confirming the "send to extension" handshake still fires; see step 3).

2. **The reference implementation is on disk** under `vacantless-extension/_archive-courier-s483/`: `portal.js` (reads `location.href`, `urlIssue()` validation that warns on create/login/search pages, sends `{type:"captured_url", itemId, channel, nonce, url}` via `chrome.runtime.sendMessage`), `background.js` (relays to the app tab, host-allowlisted, S483 P2 hardening), `bridge.js` (on the app origin, forwards the runtime message to the page as the postMessage above). Reuse the URL-validation and the message/relay hardening verbatim where possible; adapt the delivery mechanism to the current side-panel generation (below).

## Scope — build exactly this
1. **RE-LAND THE CAPTURE LEG into the v0.2.0 generation.** The current extension fills the portal via `chrome.scripting` injection from the side panel (`fill-page.js`, `sidepanel.js`, `background.js`), and only declares one content script (`app-bridge.js`, app-origin, read-only). Add a capture path that, after the operator has posted, reads the active portal tab's live ad URL and routes it back to the app tab. Choose the cleanest fit for the side-panel architecture; the two honest shapes are:
   - a side-panel "Grab the live URL" action that reads the active portal tab's `location.href` via `chrome.scripting`/`activeTab` (no new persistent content script), OR
   - a lightweight portal content script (re-land `portal.js`'s capture section only, not the whole copy-button panel) that offers the same one gesture on the portal page.
   Either way: validate with the archived `urlIssue()` (warn + "capture anyway" on create/login/search pages), then send `{type:"captured_url", itemId, channel, nonce, url}` through `background.js` to the app tab, where the existing app-origin relay posts it to the page for the receiver in step (1) above. Bump manifest `version` to `0.3.0`.
2. **RE-ESTABLISH THE JOB HANDSHAKE (itemId / channel / nonce → extension).** The capture message must echo the nonce the app minted, so the extension needs the current job's `itemId`, `channel`, and `nonce`. In S483 the extension pulled this via a `get_job` request to the app tab. Confirm how the current generation carries job context (it tracks the viewed property id via `app-bridge.js`, but likely NOT the item/channel/nonce), and re-establish the minimal handshake so a captured URL can be attributed to the right run item and pass the nonce gate. If the app's "send to extension" gesture no longer renders in the current copilot UI, re-wire that one button (it already existed for S483) — but add NO new server action.
3. **CHANNELS.** Support the co-pilot channels the current generation already has host permission for: **Kijiji** (`*.kijiji.ca`) and **Facebook Marketplace** (`*.facebook.com`, `m.facebook.com`). Viewit is NOT in the current `host_permissions` (the fill generation dropped it); adding a Viewit host permission triggers a re-permission prompt on every installed extension, so leave Viewit to a follow-on and note it. Do not silently skip it — surface "Viewit capture: not in this slice" in the handoff report.
4. **HONESTY.** The extension reads ONLY the URL of the ad the operator already posted themselves; it never posts, submits, signs in, pays, or marks the channel live. The app server (`completeCopilotPost`) re-validates the URL as it does today. Preserve every S483 guard: nonce match, app-origin/`event.source===window` checks, host allow-listing in the background relay, and the create/login/search-page warning.

## Out of scope — later slices / fast-follows
- **Worker headless URL write-back** (autofire channels write `external_url` themselves via the concierge completion path) — a separate lane that only matters once auto-fire actually fires; defer.
- **"Always auto-complete this channel" hands-off preference** (one-tap first time, silent thereafter) — the option-3 hybrid; needs a per-org/channel preference store, so it's a follow-on, not this slice.
- **Viewit capture** — pending the fill generation re-adding Viewit.
- Per-channel session-freshness (Slice 3); background/notification (Slice 4); dashboard "Relist" on stale (Slice 5); take-down mirror (Slice 6).
- No change to `resolvePublishMode` semantics, the honesty invariants, `completeCopilotPost`, or any posting mechanics.

## Honesty invariants (must hold)
Nothing posts before the preflight confirm (KI999). The extension/desk never posts, signs in, pays, OR marks a channel live for the landlord. "We post for you" only for copilot-capable channels. The captured URL is a courier payload, re-validated server-side; a bad/absent URL still cannot mark a channel live (`completeCopilotPost` refuses). Reach "included" = instant + for-you, never raw channel count.

## Gate
Extension: `npm test` (Playwright — `tests/extension-qa.spec.js` + `tests/mapping-validation.spec.js`) green; ADD a capture test covering (a) a valid live URL relays and pre-fills, (b) nonce mismatch is rejected, (c) a create/login/search URL warns then "capture anyway" works. App: `npx tsc --noEmit` clean · `npm run lint` (only the known `app/job/[token]/page.tsx` `<img>` warning) · `npm run build` green · `git diff --check` clean. NOTE: `next lint`/`next build` cannot run in the on-device Linux VM (native binaries) — run app lint/build in the NATIVE mac terminal or let the Vercel deploy build verify; on-device only `npx tsc --noEmit` works. Manual live QA: on a real Kijiji or Facebook post, confirm the captured URL pre-fills the field and the person completes with one tap; confirm nothing marks live without that tap.

## Deliver
Branch + PR for `vacantless-extension` (and `vacantless-app` only if the "send to extension" handshake button needs re-wiring). Report: extension version, files touched in each repo, the job-handshake mechanism you chose, channels covered (and Viewit deferred), and gate output. Do NOT publish the extension or flip anything in prod — Noam reviews, runs the native app gate, and ships.
