# Codex QA Handoff — S488 Distribute command center, Slice 1

**What:** the Slice 1 command-center fold from the ACCEPTED design
`codex-handoffs/COMMAND-CENTER-REDESIGN-DESIGN-S488.md`. UI-only. Review the diff of the
four files below for P1/P2/P3.

**Gates run (Cowork, on-device):** `npx tsc --noEmit` clean (exit 0); `git diff --check`
clean. `next build` + the tsx distribution test scripts + `npm run lint` have NOT run on the
bridge (they can't — KI746); Noam runs those on the Mac as the build gate before push.

## Files changed (4, UI only — `git diff --stat`)
- `app/dashboard/properties/[id]/copilot-panel.tsx` — helper window is now the primary CTA;
  "Open ‹Channel›" demoted to a secondary link inside the helper box; the copy grid + step
  list moved into a collapsed `<details>` "Show the copy and steps here" so the inline card is
  short; the extension button is **detected-only** (existing `extReady`) and relabelled
  **"Send to Chrome extension (beta)"**. The `completeCopilotPost` completion form (required
  `external_url`) is unchanged.
- `app/dashboard/properties/[id]/distribute-tab.tsx` — one command center: a prioritized
  **next-action banner** (pure `nextRunAction`, derived from run items' publish status) above
  the `LaunchRunPanel`; the old `ChannelCard` grid + "Other channels" tracker demoted into a
  collapsed **"Posted links & tools"** drawer; `ListingQualityPanel` + `AnalyticsPanel` into a
  collapsed **"Performance & setup"** drawer (Codex Q3 = two sections).
- `app/dashboard/properties/[id]/launch-run-panel.tsx` — one derived status chip via new pure
  `displayStatus(item)` (both Codex P3s: `liveWithoutUrl` → red **"Needs ad URL"**;
  `submitted` overridden from `positive` to amber **"Submitted to feed - not live yet"**;
  `staleRefresh` → amber **"Needs refresh"**). The two always-open `<details>` (Add-proof +
  Advanced-status) folded into ONE **"More actions"** `<details>`. Two optional fields added to
  `RunItemView` (`staleRefresh`, `liveWithoutUrl`).
- `app/dashboard/properties/[id]/page.tsx` (+13 lines) — pure data-shaping: a
  `channelStatusValueByKey` map from the already-built `distributeChannelCards`
  (`computeChannelStatus`), used to set `staleRefresh`/`liveWithoutUrl` on each run item. No
  schema change.

## Honesty invariants — verify these held (the review's priority)
1. **S482 P1 guard is structural, not just hidden.** The generic `updateRunItem` status form is
   still rendered ONLY under `{!item.copilotScript && ( … )}` (now inside "More actions"). A
   co-pilot item still has no generic status form → can only go live via `completeCopilotPost`.
   (grep confirms `!item.copilotScript` wraps `action={updateRunItem}`.)
2. **`completeCopilotPost` path untouched.** Same form, `external_url` still `required`; only
   surrounding layout (helper primary, copy/steps collapsed) changed.
3. **No server/lib/migration change.** `git status` shows no tracked changes under `lib/`,
   `actions.ts`, `distribution-actions.ts`, `concierge-actions.ts`, or `supabase/`.
   `canMarkCopilotLive` / S485 allowlist / S487 reservation are not in the diff.
4. **`submitted` never reads as Live** (P3): `displayStatus` forces it to amber + "not live
   yet", no live-ad actions. **`problem` never shows as Live** (P3): red "Needs ad URL".

## Deferred (call out if you disagree)
- **Compact lifecycle rail when Distribute is active (Codex #1 / design Q1 "if feasible").**
  Deferred to **Slice 1b**: the active tab is client state inside `TabbedSections`; the rail
  renders server-side outside it, so compacting it only on Distribute needs shared tab-state
  (an architectural change to the tab system). Held out of Slice 1 to keep the diff contained.
  The rail is already a compact horizontal strip.

## Ask
Review the 4-file diff. Confirm the four invariants above, the two P3 renderings, and the pure
`nextRunAction` / `displayStatus` helpers. Flag P1/P2/P3. If clean, ACCEPT and Noam runs the
build gate (tsc + next build + tsx tests + lint) and pushes.
