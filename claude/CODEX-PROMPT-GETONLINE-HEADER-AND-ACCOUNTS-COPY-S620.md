# CODEX BUILD — S620: Get-online shared-header shortcut cleanup + step-5 account copy

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** cosmetic/copy polish. Closes the two carried S618 Lane 2 loose ends (dead shared-header shortcut in Simple mode; step-5 "Connect accounts" copy contradicting the checklist's "Needs login").
**Migration:** NONE. **Flag:** NONE. **Risk:** very low — markup/copy only in ONE file; no logic, data, route, or readiness change.
**Design of record:** `claude/DESIGN-GETONLINE-HEADER-AND-ACCOUNTS-COPY-S620.md`. Build to it; do not re-derive.
**Blast radius:** ONE file — `app/dashboard/properties/[id]/distribute-tab.tsx`.
**Base:** prod tip `778833b` (S619). `distribute-tab.tsx` was last edited by S619 — edit the current tip, do not revert S619.

## Verified current-state (do NOT re-derive)
- `#distribute-header` (~line 472) is rendered by `DistributeTab` **above** `<GetOnlineView simple=… advanced=… />` (~line 545): it is **shared, shown in both modes**. `DistributeTab` is a server component and cannot read the client mode.
- Header shortcut links (~lines 497-510) target `#rental-details` (which **does not exist anywhere in the app**) and `#publish-action` (which exists only in `page.tsx` and is **not in the Simple-mode DOM**). Both are stale/mode-wrong. The status badges (readiness pill + "N sites posted" pill) directly above them are correct — keep those.
- Each mode already shows its own prominent next-step affordance: Simple = the "NEXT STEP" hero card in `SimpleGetOnline` (~line 1120, `firstOpen` href points at the correct `#simple-*` anchor) + the numbered steps; Advanced = the command center + page-top `#publish-action` Set Live.
- Step 5 = `SimpleStep id="get-online-accounts"` (~line 1322). Its `accountsReady` (green/done) branch currently reads: detail `"The selected sites do not need more account setup right now."` and body `"Continue to posting and paste each live ad link when it exists."` Guided-posting sites (Facebook, Kijiji) are `ready` in `channelAccountReadiness`, so they never enter `accountNeeds` — but the run checklist marks them "Needs login", contradicting this green copy.

## The job (ONE file: `distribute-tab.tsx`)

### Fix 1 — remove the stale shortcut links from the shared header
In the `#distribute-header` block, delete the two conditional shortcut `<a>` elements:
- the `{!readyToShare && setupOutstanding > 0 && ( <a href="#rental-details">Finish listing details →</a> )}` block, and
- the `{!readyToShare && setupOutstanding === 0 && !linkIsLive && ( <a href={canSetLive ? "#publish-action" : "#rental-details"}>…</a> )}` block.

Keep the readiness badges (the status pill using `readinessLabel` and the "N sites posted" pill). The header stays a pure one-line status signal. If removing the links leaves the wrapping flex `<div>` (the `flex flex-wrap items-center gap-2 text-xs` row) containing only the two badges, that is fine — leave the row; do not restructure. Remove any now-unused local vars ONLY if they become entirely unreferenced after the deletion and removing them keeps `tsc`/lint clean (e.g. check `canSetLive` is still used elsewhere in the file before touching it — it is used by the Simple set-live step and readiness, so it almost certainly stays; do NOT remove vars still referenced).

### Fix 2 — reword step-5's green/done copy (logic unchanged)
In `SimpleStep id="get-online-accounts"`, change ONLY the `accountsReady === true` copy. Keep `done={accountsReady}`, the amber `accountNeeds.map(...)` branch, and all logic exactly as-is.
- detail (the `accountsReady ? … : …` subtitle) → `"No accounts to connect here."`
- body (the `accountsReady ? ( <p>…</p> ) : ( <ul>…</ul> )` paragraph) → `"Sites like Facebook and Kijiji ask you to sign in while you post — that happens during guided posting, not here. Continue to posting and paste each live ad link when it exists."`

Wording is illustrative; preserve the meaning. Do NOT change the amber (`accountNeeds.length > 0`) branch or its `/dashboard/settings?tab=distribution` button.

## Scope guards
- ONE file. No migration, no flag. No change to `channelAccountReadiness`, `LaunchRunPanel`, `page.tsx`, `launch-run-panel.tsx`, the Settings route, or the Simple/Advanced tree structure.
- Do NOT make the header mode-aware or thread the client mode into `DistributeTab` (see design — rejected).
- Do NOT add the optional "only show the Facebook/Kijiji sentence when relevant" derived boolean unless trivially clean; default is the static sentence.
- Do NOT `git add -A` — stage the one touched file by name (untracked `claude/*.md`, `_to_delete/`, `_gitlock_quarantine/` must not be swept in).

## Gates (report each verbatim)
- `npx tsc --noEmit` → 0 errors
- `npm run lint` → clean (report any new warnings on the touched file)
- `npm run build` → succeeds
- `git diff --check` → clean
- `npm run test` → green (counts). No new pure helper expected for this lane.

## Dogfood checklist (Cowork re-verifies on North Star QA via Claude-in-Chrome)
- Simple mode: the dark header shows the status pill + "N sites posted" and **no** secondary shortcut link (no dead "Set Live →"/"Finish listing details →"). Each numbered step still renders; the "NEXT STEP" hero still links correctly.
- Advanced mode: header shows the same status badges, no shortcut link; the command-center Set Live (`#publish-action`) is still reachable via its own controls.
- Step 5 green state: select only guided-posting/Ready sites → step 5 reads the new non-contradictory copy; committing FB+Kijiji to a run (checklist shows "Needs login") no longer contradicts step 5's copy. (Cancel the run after to restore the fixture.)
- Amber path unchanged: if an org-account feed channel is ever selected, step 5 still shows the "Connect accounts → Settings" card.

## Commit (single, clean; the one touched file by name)
```
fix(properties): drop stale get-online header shortcuts + clarify step-5 account copy

Get-online's shared dark header rendered two shortcut links left over from the
pre-Simple single view: "Finish listing details →" / "Set Live →" targeting
#rental-details (nonexistent app-wide) and #publish-action (absent from the
Simple DOM), so they were dead/no-op in Simple mode. Remove them; the header
is now a pure readiness signal and each mode keeps its own next-step affordance.

Also reword step-5 ("Connect the accounts those sites need") green-state copy so
it no longer contradicts the run checklist marking guided-posting sites
(Facebook/Kijiji) "Needs login": those sign-ins happen during guided posting,
not as an account to connect here. Copy/markup only; no logic, route, migration,
or flag change. Closes the two carried S618 Lane 2 loose ends.
```
