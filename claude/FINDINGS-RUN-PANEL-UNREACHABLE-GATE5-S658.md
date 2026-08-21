# FINDINGS - S658: gate 1 is closed through the product; a FIFTH gate hides the run panel

Date: 2026-08-16. Base: `main` `e173679`, deployment
`dpl_GsEgxfHkvZs9mXim8mXeHyLzfhMj` READY at **01:57:13 UTC** (the zero-hour,
rule 65).

## 1. Gate 1 is dead, and the product killed it

S657 found that `automation_authorized` could never be set true by any code
path: `grep -rn "automation_authorized: true" app/ lib/` returned nothing at
`eee04f9`, and all four writes were teardown setting `false`.

S658 merged `bed6786` + `c8f5564` as `e173679`, and on the property page for
Growth Test `5a1e0c7d`, the Instagram row rendered the new chip **"Needs
authorization"** with an amber **"Authorize auto-post"** button. One click:

| column | before (S657, by SQL) | after (S658, by the product) |
|---|---|---|
| `automation_authorized` | `true` | `true` |
| `automation_authorized_at` | `null` | `2026-08-16 01:58:49.072+00` |
| `automation_authorized_by` | `null` | `967c8db1-e159-49d9-95b1-c4804f7b56ba` |

**The null pair is the proof.** S657's hand edit could not populate those two
columns; only `authorizeChannelAutomation` at `distribution-actions.ts:385`
does. The rail then moved Instagram from "Needs setup / Needs authorization" to
"Connected now / Instant" with a "Turn off auto-post" control, and the URL
carried `?dist=channel_auto_on`.

`facebook_feed` correctly stayed `automation_authorized=false` - the control is
per channel and org scoped, as designed.

## 2. GATE 5 (new): the run panel is not rendered in production at all

S657 recorded gate 4 as "a default, not a wall", on the basis that
`launch-run-panel.tsx` splits `defaultSelected` (:361) from `!defaultSelected`
(:364) and therefore offers Instagram unticked, gated only on
`distribution_view_mode='advanced'` and no active run. **That is true of the
component and false of production.**

- `page.tsx:2178` - `publishSimpleDefaultEnabled = process.env.PUBLISH_SIMPLE_DEFAULT_ENABLED === "true"`.
- `distribute-tab.tsx:814` - when true, renders `publishEverywhereSurface` **only**. `GetOnlineView` never mounts.
- `get-online-view.tsx:38-55` - the Simple/Advanced toggle button is rendered **unconditionally** inside `GetOnlineView`.
- The toggle is absent from the live page (checked against the accessibility tree, not a screenshot). Therefore the env var is `"true"` in production.
- `LaunchRunPanel` only ever renders inside `advancedTools`, so it is unreachable.

Two consequences:

1. **S657's `distribution_view_mode='advanced'` edit on Growth Test did
   nothing.** That column only seeds `useState` at `get-online-view.tsx:22`,
   and `localStorage` overrides it at `:26-28`. It is not the gate.
2. **There is no operator path to an explicit channel pick.** `startDistributionRun`
   has exactly one caller, `launch-run-panel.tsx:482`. `postInstagramNow` has
   exactly one, the autofire at `actions.ts:1071`. Only two code paths create a
   `distribution_runs` row at all: `stageDistributionRunForProperty` (auto, via
   `maybePrepareAvailableListing`) and `lib/leaseup-takedown.ts:197` (a takedown
   run, irrelevant here).

So "open the run panel and tick Instagram" - step 4 of the S658 plan - is not
executable. This is not a UI-discovery miss; the pane was opened and read
before the conclusion was drawn (rule 69).

## 3. What that means for the remaining gates

| gate | status after S658 |
|---|---|
| 1. `automation_authorized` unreachable | **CLOSED**, proven through the product |
| 2. `publishProperty` no-ops on a live listing | open; worked around by draft -> Set Live |
| 3. `AUTO_DISTRIBUTION_ENABLED` unset | open, and global if simply turned on |
| 4. auto-staged set excludes `api_automatic` | open |
| 5. run panel not rendered (**new**) | open |

Because gate 5 removes the manual path, gates 3 and 4 are no longer optional -
they are the *only* route to an Instagram post, and they are also the route the
Meta App Review screencast has to show: connect, authorize, set live, it posts.

## 4. The fix that follows

`claude/CODEX-PROMPT-AUTO-DISTRIBUTION-ORG-ALLOWLIST-AND-AUTHORIZED-INSTANT-S658.md`.
Two changes, both on the S650/S656 org-allowlist pattern:

1. `autoDistributionEnabledForOrg(orgId)` replacing the bare
   `AUTO_DISTRIBUTION_ENABLED` read, with `AUTO_DISTRIBUTION_ORG_ALLOWLIST`.
2. `autoDistributionChannels()` unions in `api_automatic` channels that are
   `connected` **and** `automation_authorized`, without touching
   `defaultSelected` (which the run panel also reads).

Verified in advance so Codex does not have to re-derive it: once `instagram` is
in the staged channel list, `contextForChannel` supplies
`channelAccountStatus='connected'` (`actions.ts:2100`), so the plan is
`needs_operator` (`distribution-publish.ts:507`), which is **not** in
`NON_AUTOFIRE_STATUSES` (`channel-publish-autofire.ts:25`), and the mode is
`"automatic"` (`distribution-publish.ts:632`). Every autofire guard passes.

## 5. Trap for whoever implements it

Growth Test currently has `rentals_ca`, `rentfaster`, `viewit` and `zumper` at
`automation_authorized=true` with `account_status='needs_setup'`. A naive
"authorized" filter sweeps all four into the staged run. The `api_automatic`
mode check is what excludes them, and it is acceptance criterion 10.
