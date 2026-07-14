# Codex QA Handoff — S483 Distribution Chrome Extension v0 (Lane A)

> **S483b fold (2026-07-13) — extension v0.1.1.** Codex code review returned
> CHANGES-REQUIRED with 2 P3s (no P1/P2; S482b confirmed closed; app diff clean).
> Both folded, extension-only, no app-side change:
> - **P3 suffix-loose host allowlist:** `portal.js` now uses `hostMatches(h, base)`
>   = `h === base || h.endsWith("." + base)` for both `channelForHost` and the
>   captured-URL host check, so `notkijiji.ca` no longer matches `kijiji.ca`.
> - **P3 missing sender-origin checks:** `background.js` now authorizes every
>   message by the sender's REAL origin — `copilot_job` requires the app origin
>   (`isAppSender`); `get_job` / `captured_url` derive the channel from the
>   sender's real portal host (`senderPortalChannel`, not the client-claimed
>   `msg.channel`); a captured URL is delivered only to a tab still on the app
>   origin (re-checked via `chrome.tabs.get(...).url`).
>
> Gates re-run: `node --check` OK on all three scripts; manifest valid (0.1.1).
> App file `copilot-panel.tsx` UNCHANGED by this fold (still tsc-clean). Ready for
> a quick re-review or deploy.

---


**Code review** of the built extension + the one app-side change. The **design**
was already reviewed (EXTENSION-V0-DESIGN-S483-2026-07-13.md); you returned
ACCEPT on §4 and CHANGES-REQUIRED on §2/§3 with P1/P2/P3 folds. This build folds
all of them — verify they're correctly implemented and check for new issues.

## What to review

**App diff (ships via Vercel):**
- `vacantless-app/app/dashboard/properties/[id]/copilot-panel.tsx` — the only
  changed app file. Adds: controlled `external_url`, a per-item extension bridge
  (`useEffect` message listener + `sendToExtension` with a minted nonce), and a
  "Send copy to the Vacantless extension" button gated on a presence pong.

**Extension (NOT deployed — loaded unpacked; sibling folder, outside the repo):**
- `vacantless-extension/manifest.json` — MV3; host perms for app origin +
  kijiji/facebook/viewit; `storage` only.
- `vacantless-extension/background.js` — courier service worker. Holds the active
  job (itemId, channel, nonce, appTabId, sanitized fields) in
  `storage.session`; routes `captured_url` to the originating tab ONLY.
- `vacantless-extension/bridge.js` — **relay-only** content script on the app
  origin.
- `vacantless-extension/portal.js` — portal content script: floating panel, copy
  buttons, capture + client-side URL checks.
- `vacantless-extension/portal.css`, `README.md`, `icons/`.

## How each Codex finding was folded

- **P1 (relay-only bridge / "cannot submit" overclaim):** `bridge.js` does
  nothing but move tagged messages — it never reads/mutates the app DOM, never
  fills or submits a form, never fetches. The captured URL enters React via
  `postMessage`; `copilot-panel.tsx` owns `setExternalUrl`; the operator submits
  `completeCopilotPost`. Language corrected in code comments + README to "must
  not submit, and is constrained/tested not to."
- **P2 (per-job nonce):** `sendToExtension` mints `crypto.randomUUID()` into
  `nonceRef`, sends it in `copilot_job`; `background.js` stores it with
  `appTabId`/`itemId`/`channel`; `captured_url` echoes it; the panel accepts only
  `d.itemId === itemId && d.channel === script.channel && d.nonce === nonceRef.current`.
- **P2 (exact-tab routing):** `background.js` routes a captured URL only to the
  stored `appTabId` (`chrome.tabs.get` liveness check → `chrome.tabs.sendMessage`);
  NO fallback tab query. If the tab is gone, `portal.js` shows a manual-paste box.
- **P3 (client-side URL checks):** `portal.js` `urlIssue()` requires the captured
  URL to be on the channel's own host (allowlist) and warns (capture-anyway) on
  obvious create/login/search paths before it's ever sent. Server
  `canMarkCopilotLive` remains the source of truth.

## Invariants to confirm (should all still hold)

1. A co-pilot item can go live ONLY via `completeCopilotPost` (proof-gated,
   S482b-hardened). The bridge cannot invoke it; it only pre-fills the field.
2. The generic `updateRunItem` status form stays hidden for co-pilot items
   (launch-run-panel.tsx `!item.copilotScript`) and `updateRunItem` still
   server-refuses a co-pilot live flip (actions.ts). **This change touches
   neither** — confirm no regression.
3. No new server surface, no migration, no credential storage anywhere.
4. Message hygiene: app page and bridge both check `event.source === window` and
   `event.origin`; the bridge relays only the two known shapes; background
   re-sanitizes/clamps all job fields.

## Adversarial angles worth probing

- Can a same-origin script (there shouldn't be a hostile one — it's our app)
  spoof a `captured_url` into the field? It would need the live nonce (minted
  client-side per click, not exposed) AND the operator still visually reviews +
  clicks, AND the server re-validates. Confirm the nonce is never leaked back to
  the page in a guessable way.
- Double-capture / stale job: sending a new job mints a new nonce, so an old
  portal tab's capture (old nonce) is ignored by the panel. Confirm.
- Multi-tab: two app tabs each send their own job (each overwrites `activeJob`);
  a capture routes to whichever tab's job is current (last send wins) via its
  stored `appTabId`. Acceptable for v0? Flag if you want per-tab job isolation.

## Gates run

- `tsc --noEmit` on the app: **clean (0 errors)**.
- esbuild parse of copilot-panel.tsx: OK.
- `node --check` on background.js / bridge.js / portal.js: OK. manifest.json:
  valid JSON.
- `npm run build` (authoritative) + live North Star QA: to run on deploy.

## Range
App diff is the single file above. Deploy = `DEPLOY-S483-EXTENSION-V0.sh`.
Extension folder = `vacantless-extension/` (load unpacked; not in git).
