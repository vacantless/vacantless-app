# CODEX BUILD — S618 Lane 2: Get-online **Simple mode** (default) + Advanced toggle

**Owner:** Noam · **Author:** Cowork · **Date:** 2026-08-03
**Type:** headline UX rethink of the property-detail **Get online** tab. Adds a persona mode split: a simple, linear, inline default for ESL / self-managing landlords, with the existing command center preserved one click away as "Advanced."
**Migration:** NONE (MVP). **Flag:** NONE. **Risk:** medium — reorganizes a freshly-shipped tab (S617). **Do NOT rebuild the distribution engine; reorganize presentation + add a mode wrapper + one compact inline basics editor.** Blast radius = `app/dashboard/properties/[id]/distribute-tab.tsx` (+ small wiring in `[id]/page.tsx`; possibly a new client component file).
**Design of record:** `claude/DESIGN-ESL-SIMPLE-MODE-AND-DELETE-S618.md` (§5 Lane 2 + "Connect-accounts" subsection). Build to it; do not re-derive strategy.

## Why
Noam: the Get-online page "looks nice but it's very confusing. I still don't really understand what I'm supposed to do." Root cause (verified): the good 5-step "Simple posting plan" is rendered **on top of** ~6 dense power panels (`DistributionBasicsPanel`, `PostingModePanel`, next-action banner, `DistributionHealthPanel`, `AutomationStatusPanel`, `AnalyticsPanel`, channel cards, launch-run internals), and its step buttons **jump to anchors on other tabs** (e.g. `#rental-details` → the 830-line Edit form; `#property-photos` → Photos tab). Two users are crammed onto one screen. Fix = **default Simple, Advanced on demand, steps resolve inline.**

## Verified current-state (do NOT re-derive)
- `DistributeTab({...})` in `distribute-tab.tsx` renders, in order: header (`#distribute-header`), `SimplePostingPlan` (5 steps), `DistributionBasicsPanel`, `PostingModePanel` (concierge), next-action banner, then health/automation/analytics panels + channel cards + launch-run panel. Props already include everything Simple mode needs: `linkIsLive, setupOutstanding, hasPhotos, canSetLive, launchRun (with startChannels[].readinessTone), selectedChannelCount`, etc.
- `SimplePostingPlan` (fn ~800) already computes the 5 steps + done-states from those props; its step `href`s point at `#rental-details / #property-photos / #publish-action / #share / #publish-checklist`.
- **Tabs** (`tabbed-sections.tsx`): client `TabbedSections` keeps every panel **mounted** (`hidden` when inactive) and its `reveal()` switches to the tab containing an anchor then scrolls — so cross-tab deep-links already work; the problem is that hopping tabs is disorienting for ESL, not that links are broken.
- **Connect accounts** is NOT a tab. It surfaces as (a) the "Account access" card in `DistributionBasicsPanel` → links out to `/dashboard/settings?tab=distribution`, and (b) inline "Connect accounts" prompts in `launch-run-panel.tsx` (~lines 398, 462). Inspect the launch-run inline affordance and reuse it.
- **Set Live** = `publishProperty(formData)` server action (exists). No mode-persistence mechanism exists anywhere yet.

## The job

### A. Mode split (default Simple)
- Introduce a client-side mode: `"simple" | "advanced"`, **default `"simple"`**, persisted in `localStorage` (key `vacantless.getonline.mode`). SSR-render Simple to avoid hydration flash; read localStorage in `useEffect` and switch if the user previously chose Advanced.
- A small toggle in the tab header: **"Advanced tools ▸"** (in Simple) / **"◂ Simple view"** (in Advanced). Persist the choice on toggle.
- **Advanced view = today's exact command center, unchanged** (all existing panels/components, same order). Do not delete or refactor them — just render them only in Advanced. The power operator (Agile, Noam) flips once and it sticks.
- New client wrapper (new file, e.g. `[id]/get-online-view.tsx`, `"use client"`) that receives the same data `DistributeTab` has and renders either `<SimpleGetOnline .../>` or the existing panel stack. Keep `DistributeTab` as the data/prop boundary; move the render branch inside it or into the wrapper — your call, minimal churn.

### B. Simple mode = the 6-step spine, resolved INLINE (the core fix)
Render one calm, generously-spaced, numbered column (big numerals, one accent-green "done" state, no metric grids in view). Reuse existing sub-components rendered **inline within the Simple view** — do NOT tab-hop. Steps (drive done-state from existing props):
1. **Finish the listing details** → expand an **inline compact basics editor** (rent, beds, baths; address read-only is fine) posting to the existing `updateProperty` action with only those fields. This is the one net-new small piece. Do NOT open the 830-line Edit tab. If a field genuinely can't be edited without the full form, link to it as a last resort — but basics must be inline.
2. **Add photos** → inline uploader reused from the photo manager (or a compact drop) — not a Photos-tab hop.
3. **Set Live** → the `publishProperty` button inline, with any readiness blockers shown inline.
4. **Choose rental sites** → the site checklist inline (reuse launch-run start-channels selection).
5. **Connect the accounts those sites need** → render **only for selected sites whose `readinessTone !== "positive"`**; reuse the launch-run inline "Connect accounts" affordance. If connect truly must happen in Settings, use a **labelled round-trip**: link to `/dashboard/settings?tab=distribution` and give this step a return anchor (`#get-online-accounts`) so the user lands back here — never dead-end an ESL user on Settings. Auto-mark done when all selected sites are ready.
6. **Post, then paste the live ad link** → per-site paste inline (reuse the existing paste UI).
- One **hero primary button** above/within the spine = "the next thing to do" (reuse the already-computed `nextAction` if present, else derive from the first not-done step).
- **"You're live" state:** when the listing is live and ≥1 site has a saved live link, collapse the spine into a calm done card = public link + inquiry count. No panels.

### C. What moves to Advanced (unchanged, just gated)
`DistributionHealthPanel`, `AutomationStatusPanel`, `AnalyticsPanel`, `PostingModePanel`/concierge, the "Account access"/basics 4-card tile, raw channel cards, launch-run internals. Simple mode owns the explicit account step instead of the tile.

## Scope guards
- **Reuse, don't rebuild.** The only net-new logic is the mode wrapper + the compact inline basics editor + arranging existing components inline. No change to distribution data flow, server actions (other than calling existing `updateProperty`/`publishProperty`), migrations, or the launch-run engine.
- Keep all existing anchors resolvable (Advanced still contains them; `TabbedSections.reveal` unaffected).
- MVP persistence = localStorage only. **Do NOT** build an org-level default this lane (that's a noted fast-follow — a power org auto-landing in Advanced).

## Gates (report each verbatim)
- `npx tsc --noEmit` → 0 errors
- `npm run lint` → clean (report new warnings on touched files)
- `npm run build` → succeeds
- `git diff --check` → clean
- `npm run test` → green (counts). If you extract any pure helper (e.g. step-derivation), add a small pure test in the existing `scripts/test-*.ts` style; don't add heavy infra.

## Dogfood checklist (by hand — Cowork re-verifies on North Star QA via Claude-in-Chrome)
- A **not-yet-live** listing opens the Get-online tab in **Simple mode**: 6 calm steps, correct done/undone, one hero next-action.
- **Each step resolves inline with ZERO tab navigation** — especially step 1 (basics editor inline, NOT the 830-line form) and step 2 (photos inline). Editing basics inline actually saves via `updateProperty`.
- **Set Live** works inline. **Connect accounts** appears only for sites needing credentials and either connects inline or round-trips and returns to `#get-online-accounts`.
- **Advanced toggle** reveals the full existing command center exactly as it renders today, and the choice **persists across reload**.
- A **live + posted** listing shows the calm "You're live" state (link + inquiries), not the step list.
- Power-user paths in Advanced (health/automation/analytics/concierge/launch-run) behave exactly as before.

## Do NOT
- Do NOT rebuild or alter the distribution engine, launch-run logic, or any server action beyond calling existing `updateProperty`/`publishProperty`.
- Do NOT delete the existing panels — they ARE the Advanced view.
- Do NOT add a flag or migration. Do NOT `git add -A` — commit touched/new files by name (untracked `claude/*.md` + `_to_delete/` must not be swept in).
- Do NOT touch the rentals list (Lane 1) or `/properties/new` (Lane 3).
- Do NOT make Simple mode a forced Next/Next wizard — it's a single scannable column the user can work in any order; "next action" is a highlight, not a lock.

## Commit (single, clean; touched/new files by name)
```
feat(properties): simple-mode default for the Get online tab (advanced on demand)

Persona split on the property Get-online tab: a calm 6-step spine (finish basics,
photos, set live, choose sites, connect accounts, post + paste link) that resolves
inline instead of tab-hopping, with the existing command center preserved behind an
Advanced toggle (localStorage-remembered). Reorganization + one inline basics editor;
no engine, migration, or flag change.
```
Reply with branch/SHA/diffstat + every gate result. **Do NOT push.** No migration.
