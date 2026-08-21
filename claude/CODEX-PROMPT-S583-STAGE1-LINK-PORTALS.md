# CODEX PROMPT — S583: Stage 1 "Link your portals" screen (first real presentation-layer screen)

Written 2026-07-26. Prod running sha 337cc43 (S582 next-intl cookie-locale
foundation, READY, dark). This is build-order step #3 from
`claude/BUILD-PLAN-PRESENTATION-LAYER-UI-S578.md`: i18n is done (S582), so now
wire the first real command-center screen to the already-landed Stage-1 read
model. Design-of-record for the look is the interactive prototype (artifact
"vacantless-link-your-portals-wireframe"); accessibility spec is
`claude/DESIGN-DECISIONS-PRESENTATION-LAYER-S578.md`.

Build the CHANNEL UI ahead of the backend. Everything ships DARK: a new route
that is NOT linked from any nav, changing zero existing behavior.

DEPENDS ON: **S583a — the shared presentation kit** (tokens + accessible
primitives extracted into `components/ui.tsx` + `tailwind.config.ts`, per
`claude/DESIGN-PRESENTATION-DESIGN-SYSTEM-AND-ROLLOUT-S583.md`). Build this screen
using those kit primitives (PageShell/StageShell, Card/Tile, StatusBanner,
Button, Field, LanguageDropdown, BackNext) at "Guided" density — do NOT hand-roll
one-off styling. If S583a has not landed yet, build the primitives you need
inside the kit (not inline) so this screen is the kit's first consumer, not a
throwaway.

## GOAL
A single-column, accessible "Link your portals" screen that renders one big tile
per channel from the real `listChannelTileStatuses` server action, grouped by
state, with an honest connect control that only appears when the channel can
actually be connected today. All operator-facing strings come from the next-intl
catalog (EN + FR), never English literals.

## USE THESE REAL SIGNATURES VERBATIM (do not reshape; warm-verified against the substrate)
Server action (already exists) — `app/dashboard/properties/actions.ts`:
```ts
export async function listChannelTileStatuses(
  orgId: string,
): Promise<ChannelTileStatusRow[]>
```
`ChannelTileStatusRow` (from `lib/distribution-channel-tile-statuses.ts`):
```ts
type ChannelTileStatusRow = { channel: string } & ChannelTileStatus;
```
`ChannelTileStatus` + state union (from `lib/distribution-channels.ts`):
```ts
type ChannelTileState = "linked" | "not_linked" | "not_available_yet" | "mls_only";
type ChannelTileStatus = { state: ChannelTileState; headline: string; canConnect: boolean };
```
Registry lookups (from `lib/distribution-channels.ts`) — use for label / connect
kind / portal URL. DO NOT hardcode a channel list; iterate the rows the action
returns and look each up:
```ts
channelByKey(channelKey): DistributionChannel | undefined
// DistributionChannel fields you need: key, label, category,
//   integrationStatus ("live" | "planned" | "mls_gated"),
//   connectKind ("oauth" | "account_login" | "none"), portalUrl
```
Notes on the substrate (do not re-derive, do not guess columns — KI930):
- `headline` on the status row is an ENGLISH literal (dev/fallback only). The UI
  must NOT render it. Pick copy from the catalog keyed off `state` (below).
- `canConnect` is true ONLY for `state === "not_linked"`. Never render a working
  connect button for any other state.
- The action already resolves the account rows from `distribution_channel_accounts`
  server-side; the screen just calls it with the current org id.

## i18n — USE THE EXISTING KEYS (already in messages/en.json + messages/fr.json, S582)
next-intl v4, cookie locale, Next 14 (cookies() is sync — matches repo). Use
`useTranslations` in client components / `getTranslations` in server components.
The Stage-1 keys already exist; map state -> key, do not invent copy:
```
common.brand / common.language / common.back / common.next
stages.s1 (screen title chip)
stage1.title, stage1.sub
stage1.groupReady, stage1.groupComing, stage1.groupAgent
stage1.kindLogin, stage1.kindOauth, stage1.kindNone
stage1.status.linked      + stage1.status.linkedSub
stage1.status.notLinked   + stage1.status.notLinkedSub
stage1.status.notAvailable+ stage1.status.notAvailableSub
stage1.status.mlsOnly     + stage1.status.mlsOnlySub
stage1.buttons.login  ("... WITH YOUR {name} PASSWORD")   // interpolate {name}=channel label
stage1.buttons.connect ("... CONNECT YOUR {name}")         // interpolate {name}=channel label
stage1.igNote
```
State -> status copy mapping (exact):
- `linked` -> status.linked / status.linkedSub
- `not_linked` -> status.notLinked / status.notLinkedSub
- `not_available_yet` -> status.notAvailable / status.notAvailableSub
- `mls_only` -> status.mlsOnly / status.mlsOnlySub

If any NEW string is genuinely needed, add it as a key to BOTH en.json and
fr.json (keep top-level key parity — the S582 test asserts it). Never ship a bare
literal.

## GROUPING (three sections, in this order)
- "Ready to connect now" (`stage1.groupReady`): rows with state `linked` or `not_linked`.
- "Coming soon" (`stage1.groupComing`): rows with state `not_available_yet`.
- "Agent / MLS only" (`stage1.groupAgent`): rows with state `mls_only`.
Omit a group header if it has zero rows. Preserve the registry order within each group.

## TILE ANATOMY (one full-width tile per row)
- Channel label (`channelByKey(row.channel)?.label`) as the tile heading.
- A macro, high-contrast STATUS BANNER with the status SENTENCE from the catalog
  (state -> status key). Status must be conveyed IN WORDS, never colour/dot alone.
- The connect-kind line (`stage1.kindLogin` for account_login, `stage1.kindOauth`
  for oauth, `stage1.kindNone` for none) — from `channelByKey(row.channel).connectKind`.
- Connect control, ONLY when `row.canConnect === true`:
  - connectKind `account_login` -> button label `stage1.buttons.login` with {name}=label.
  - connectKind `oauth` -> button label `stage1.buttons.connect` with {name}=label.
  - connectKind `none` -> no button (and canConnect will be false anyway).
- For `channel === "instagram"`, show `stage1.igNote` under the control.
- Never render a connect button for `not_available_yet` / `mls_only`.

## CONNECT WIRING — REUSE EXISTING PATHS, BUILD NO NEW AUTH (this is the main risk; warm-verify)
Do NOT build any new authentication in this slice. Wire the button to the
channel's EXISTING connect entry point:
- `oauth` (facebook_feed / instagram): the existing FB/IG connect flow at
  `app/dashboard/facebook-connect` — reuse whatever that page/route uses to start
  the connect.
- `account_login` (kijiji / rentals_ca / zumper): route to the existing
  partner-account connect path (look for the current UI that calls
  `upsertPartnerAccount` / manages `distribution_channel_accounts`). LOCATE the
  real path and use it — do not invent one.
- If a `not_linked` channel has NO existing self-serve connect screen, render the
  button but point it at the closest existing entry (or a clearly-marked no-op)
  and CALL IT OUT in your handback so Noam/QA can decide. Do not fabricate a flow
  or claim it works.

## SCREEN CHROME (accessibility IS the product — from the decisions doc)
- Strict single column, max content width ~640px, centered.
- Title = `stage1.title`, sub = `stage1.sub`, an h1 for the stage.
- Pinned, FUNCTIONAL language dropdown (EN + FR) that sets the locale via the
  S582 `setLocale` server action (`app/i18n/actions.ts`) — not decorative.
- Fixed anchors: Back (bottom-left, `common.back`) + Next (bottom-right,
  `common.next`), identical placement to the other stages (Next can be a no-op /
  route stub for now — Stage 2 is not built).
- Targets >= 48-60px tall; body >= 19px; smallest chip >= 15px.
- Focus-visible outline on every interactive element; logical heading order.
- Honour `prefers-reduced-motion`.

## DARK / PLACEMENT
- New route, e.g. `app/dashboard/link-portals/page.tsx` (server component that
  calls `listChannelTileStatuses(currentOrgId)` and renders a client tile list).
  Confirm the real way this codebase resolves the current org id (reuse the same
  helper other dashboard actions/pages use — do not guess).
- Do NOT add it to any nav / menu. Reachable by URL only, for review. Zero change
  to any existing screen or behavior.

## TESTS
- A pure unit test (tsx, `scripts/test-...`) over the grouping + state->copy-key
  mapping using synthetic `ChannelTileStatusRow[]` (no network): asserts each
  state lands in the right group and maps to the right status key, and that
  `canConnect` gates the button. Keep it lib-pure so it runs without a browser.
- `npx tsc --noEmit`, `npm run build`, `npm run lint` clean (lint is not a build
  gate here but should pass). Keep en/fr top-level key parity (S582 test).

## OUT OF SCOPE (do not touch)
- Stages 2/3/4, real posting, the run-item state machine, take-down.
- Any NEW auth/connect flow, any migration, any DB write.
- Nav integration, marketing pages, existing dashboard screens.
- Do not modify the read-models (S578-S582) — consume them as-is.

## HANDBACK / WARM-VERIFY CRITERIA (what Noam's session will check before push)
Report: files added/changed, the exact route, which existing connect path each
connectKind was wired to (and any channel you could NOT wire cleanly), the test
result, tsc/build/lint results. Warm-verify will confirm: (1) the screen calls
the REAL `listChannelTileStatuses` signature; (2) no English literal is rendered
for any status/label/button (all via catalog keys, EN+FR); (3) `canConnect` truly
gates the button and no working connect appears on planned/mls rows; (4) render
is byte-neutral to every existing page (dark); (5) en/fr key parity holds. Push
is Noam's; land natively on the Mac.
