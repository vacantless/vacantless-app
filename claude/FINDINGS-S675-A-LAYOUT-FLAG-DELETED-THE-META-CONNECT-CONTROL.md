# FINDINGS S675: a layout flag deleted the only route to connecting a Meta account

Date: 2026-09-02 (Session 675)
Baseline: PROD `82776e6`, app HEAD `82776e6` on `main`, schema `0223`.
Found while running pre-flight for the Meta App Review re-record.

## What is broken

`PUBLISH_SIMPLE_DEFAULT_ENABLED=true` removes the **Connect Facebook Page** and **Disconnect**
controls from the product entirely, on every property, in every org, with no way for an operator to
reach them.

`app/dashboard/properties/[id]/distribute-tab.tsx:1029` (before the fix):

```
{publishSimpleDefaultEnabled ? (
  publishEverywhereSurface
) : (
  <GetOnlineView
    simple={publishEverywhereEnabled ? publishEverywhereSurface : simpleGetOnlineSurface}
    advanced={advancedTools}
  />
)}
```

The true branch renders `publishEverywhereSurface` **bare**. Two things are lost with it:

1. **`advancedTools`** (`:785`), which contains the "Live ad links" disclosure, which renders
   `ChannelCard` (`:896`), which is the sole home of the Facebook Page and Instagram
   connect/disconnect block (`:3094-3160`).
2. **`GetOnlineView`** itself (`get-online-view.tsx`), which owns the simple/advanced toggle
   (`setAndStore("advanced")`). Without it there is no control anywhere that switches surfaces, so
   the advanced tools are not merely hidden - they are **unreachable**.

Net effect: the Get online tab keeps advertising "Facebook Page feed" and "Instagram" as channels,
and on an org that has never connected renders them under NEEDS SETUP as "Connect once", but there
is no control that starts the OAuth flow. The only working entry point is typing
`/api/integrations/facebook/connect?propertyId=<id>` into the address bar.

## How it was found, and the two wrong turns on the way

Pre-flight gate 0 for the screencast asks for an Instagram channel row on the Get online tab. **That
gate does not bite** - the Instagram row comes from the static `DISTRIBUTION_CHANNELS` catalog and
renders regardless of any flag; `page.tsx:1855-1872` only attaches `instagramAccount.enabled` as a
field on the card. Confirmed by observing the row on the Agile org, which memory says is not in the
allowlist.

Second wrong turn: `find` located a "Turn off auto-post" button on the Instagram row and it was read
as proof the gated block rendered. **It is not** - that control is
`publish-everywhere.tsx:221`, the `automation_authorized` toggle, a different thing entirely.

**The gate that actually bites** is to hit the connect endpoint and read the `scope` parameter off
the Facebook URL it generates. On 2026-09-02 for Growth Test that URL carried
`scope=pages_show_list,pages_read_engagement,pages_manage_posts,business_management,instagram_basic,instagram_content_publish`
- all six rejected scopes, proving `igChannelEnabledForOrg` is true on the live build and the
allowlist survived every rebuild since August. **Replace gate 0 in the screencast script with this.**

Third wrong turn, corrected before any code was written: the missing block was first read as
unreachable dead code. It is not. `ChannelCard` is rendered at `:896`, inside a collapsed
`<details>` labelled "Live ad links" / "Manage links", inside `advancedTools`. The block is fine.
Only the branch that renders `advancedTools` was missing.

## The fix

Route the simple-default branch through `GetOnlineView` as well, pinning simple as the **initial**
mode rather than the **only** mode:

```
{publishSimpleDefaultEnabled ? (
  <GetOnlineView
    orgDefaultMode="simple"
    linkIsLive={linkIsLive}
    simple={publishEverywhereSurface}
    advanced={advancedTools}
  />
) : ( ...unchanged... )}
```

Six lines added, one removed. `node node_modules/typescript/lib/tsc.js --noEmit -p tsconfig.json`
exits 0 across the project [run on the bridge VM, 2026-09-02].

**This is a deliberate behaviour change to the flag**, and it should be stated plainly rather than
described as a pure restoration: `PUBLISH_SIMPLE_DEFAULT_ENABLED` previously meant "simple only" and
now means "simple first, advanced still reachable". An operator whose `localStorage`
`vacantless.getonline.mode` is already `"advanced"` will now land on advanced. That is the correct
trade - a flag must not be able to delete the connect flow for a feature under App Review.

## Regression test

`scripts/test-getonline-advanced-reachable.ts`, source inspection in the style of
`scripts/test-leaseup-takedown.ts`. Positive markers only, never the absence of the old expression.

Proved to bite: run against `distribute-tab.tsx.bak-pre-s675` it fails exactly three assertions -
`advanced wirings == 2`, `GetOnlineView renders == 2`, `orgDefaultMode="simple"` - while the four
structural assertions (connect entry point, two disconnect forms, per-org gates, GetOnlineView's
advanced route) stay green, because those were never the defect.

**There is still no CI gate on push** - `.github/workflows/` holds only `reminders.yml`,
`on: schedule`. This test runs only from `COMMIT-S675-GETONLINE-ADVANCED-REACHABLE.sh`.

## Why this matters beyond the screencast

Meta rejected six permissions on 2026-08-26 for a screencast that did not show the consent flow. The
re-record was blocked today because **the product could not perform the consent flow through its own
UI**. Had the video been shot by pasting an API URL, an approved integration would have shipped to
operators who still could not reach it.

Open and NOT addressed here: whether `PUBLISH_SIMPLE_DEFAULT_ENABLED` is actually true in production
is **unverified** - Vercel env values are not readable via the MCP (`get_project` returns none). The
live behaviour (no connect control on either org) is consistent with it being true, and that is
inference, not proof. Confirm at the Vercel dashboard before drawing conclusions about other orgs.
