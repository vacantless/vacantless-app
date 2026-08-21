# CODEX PROMPT - S659: gate every publish path behind a destination confirm

Repo: `vacantless-app`. Base: `main` at `c8214ab`.
Branch: `codex/s659-gate-publish-paths-confirm`

## Why

`publishProperty` calls `publishAuthorizedInstantChannelsAfterPageLive`
(`app/dashboard/properties/actions.ts:1168`), which posts to the operator's own
Instagram Business account and Facebook Page for every channel with
`account_status='connected'` and `automation_authorized=true`
(`actions.ts:1044-1075`).

There are **three** form actions bound to `publishProperty`. Only one of them
asks the operator first.

| # | Location | Control | Confirm today |
|---|---|---|---|
| 1 | `app/dashboard/properties/[id]/publish-everywhere.tsx:1165` | "Publish everywhere" (Get online) | **Yes**, preflight modal |
| 2 | `app/dashboard/properties/[id]/page.tsx:2499` | "Set Live" (page header) | **No** |
| 3 | `app/dashboard/properties/[id]/distribute-tab.tsx:1410` | "Publish everywhere" (non-modal variant) | **No** |

`publish-everywhere.tsx` states the intended invariant in its own header comment
(lines 27-32): *"nothing posts before the confirm modal (KI999) ... (Meta App
Review commitment)"*. Paths 2 and 3 break it.

This is not cosmetic. The live privacy policy at `app/privacy/page.tsx:89-92`
tells the world:

> "A post is created only after you review the prepared listing and approve it
> (for example, by tapping 'Publish everywhere' and then 'Approve & publish')."

On paths 2 and 3 that sentence is false: the operator clicks one button and a
public Instagram post appears with no confirmation and no mention that anything
is going to Meta. The Meta App Review submission is imminent and a reviewer can
read that policy alongside it.

## Scope

One new component, two call sites rewired. Nothing else.

### The no-regression baseline, from the code at `c8214ab`

State these exactly; do not infer them from the description above.

- **`page.tsx:2499-2510`** - `<form action={publishProperty} id="publish-action">`
  with a hidden `id` input and a single submit button. Label is `"Set Live again"`
  when `normalizedStatus === "paused"`, otherwise `"Set Live"`. The whole block is
  rendered only when `!publicPageIsBookable && normalizedStatus !== "leased"`.
  Class `PRIMARY_ACTION_CLASS`, `style={{ backgroundColor: "var(--brand-color)" }}`.
  **The `id="publish-action"` must survive** - treat it as an anchor target and
  keep it on the outermost element of the replacement.
- **`distribute-tab.tsx:1410-1422`** - `<form action={publishProperty} className="mt-5">`,
  hidden `id`, submit button reading `"Publish everywhere"` with `Icons.bolt`,
  followed by `<p className="mt-2 text-xs text-gray-600">Publishes instantly where
  connected. Opens 1-tap finish for the rest.</p>`. Rendered in the `canSetLive`
  branch of that conditional chain.
- **`publish-everywhere.tsx:1165`** - already gated. **Do not touch this file.**

### Change 1 - a small reusable confirm component

New file: `app/dashboard/properties/[id]/confirm-publish-button.tsx`, `"use client"`.

```
type InstantDestination = { key: string; label: string };

props:
  propertyId: string
  label: string                       // the trigger button's text
  className?: string                  // trigger button classes
  style?: React.CSSProperties         // trigger button style
  children?: React.ReactNode          // optional icon rendered inside the trigger
  destinations: InstantDestination[]  // external accounts that will be posted to
  address: string
```

Behaviour:

- Renders the trigger button. Clicking it opens a modal; it does **not** submit.
- The modal states the address, then lists every entry in `destinations` by
  label, each marked `INSTANT`, under a heading that makes clear these are the
  operator's own connected accounts that will receive a post.
- Confirm button label: **"Approve & publish"** (this matches the privacy policy
  wording; see the note at the bottom). It sits inside
  `<form action={publishProperty}>` with the hidden `id` input, so the actual
  publish still goes through the existing server action unchanged.
- A "Cancel" button closes the modal and does nothing.
- **If `destinations` is empty, render the plain form exactly as today and skip
  the modal entirely.** Nothing is going to an external account, so the extra
  click is pure friction. This keeps the common free-tier path unchanged.

Do **not** import or reuse `publish-everywhere.tsx`'s modal. That component is a
large surface tied to the Get online tab, it is already proven, and it is not
worth destabilising while App Review is pending.

### Change 2 - resolve the destination list and rewire the two call sites

The destination set is the same one `publishAuthorizedInstantChannelsAfterPageLive`
will actually fire on. Derive it from the same inputs so the modal cannot lie:

a channel key belongs in `destinations` when

- its `DISTRIBUTION_CHANNELS` entry has `mode === "api_automatic"`, **and**
- the org's `distribution_channel_accounts` row has `account_status === "connected"`, **and**
- that row has `automation_authorized === true`, **and**
- for `instagram` only, `igChannelEnabledForOrg(org.id)` is true.

That is the same predicate `autoDistributionChannels` uses after S658 - factor it
into one exported helper rather than writing it twice, and have both the staging
path and this UI path call it. If the cleanest place for that helper is the
existing auto-distribution module, put it there.

Use the channel's existing display label from `DISTRIBUTION_CHANNELS`; do not
hardcode "Instagram" / "Facebook Page feed" strings.

Then:

- **`page.tsx:2499`** - replace the bare form with `ConfirmPublishButton`,
  passing the same label logic (`"Set Live again"` when paused, else `"Set Live"`),
  `PRIMARY_ACTION_CLASS`, the brand background style, `id="publish-action"`
  preserved, and the resolved `destinations`. `page.tsx` is a server component and
  already loads org context; fetch the account rows there if they are not already
  in scope, and do it in the existing parallel-fetch block rather than adding a
  serial round trip.
- **`distribute-tab.tsx:1410`** - same swap, label `"Publish everywhere"`, keep
  `Icons.bolt` inside the trigger and keep the `<p>` subtext underneath unchanged.

Do not change `publishProperty`, `publishAuthorizedInstantChannelsAfterPageLive`,
`selectChannelPublishAutofireItems`, `postInstagramNow`, `postFacebookPageNow`,
`autoDistributionChannels`' staging behaviour, `defaultSelected` in
`lib/distribution-publish.ts`, or anything under `PUBLISH_SIMPLE_DEFAULT_ENABLED`.

## Acceptance criteria

Add `scripts/test-publish-destinations.ts` in the style of the existing
`scripts/test-*.ts` files, covering the shared predicate:

1. No connected accounts -> `destinations` is empty.
2. `instagram` connected + `automation_authorized=true` + `igChannelEnabledForOrg`
   true -> present.
3. `instagram` connected + `automation_authorized=false` -> **absent**.
4. `instagram` connected + authorized but `igChannelEnabledForOrg` false -> **absent**.
5. `facebook_feed` connected + authorized -> present (no IG gate applies).
6. `facebook_feed` connected + `automation_authorized=false` -> **absent**.
7. A channel that is authorized but `account_status='needs_setup'` -> **absent**.
8. A non-`api_automatic` channel that is connected and authorized -> **absent**.

Criterion 7 and 8 are the ones that bite. Growth Test
`8ea1da48-0cd2-45a4-bfba-023b31a67884` currently has `rentals_ca`, `rentfaster`,
`viewit` and `zumper` sitting at `automation_authorized=true` with
`account_status='needs_setup'` [verified 2026-08-16 via SQL]. A naive "authorized"
check sweeps all four into the modal and the modal starts lying in the other
direction.

9. Assert the shared predicate returns the **same set** the staging path uses, so
   the modal and the autofire cannot drift apart.

Report verbatim: `npx tsc --noEmit`, `npm run lint`, `npm run build`,
`npm run test` (with counts), `git diff --check`, and
`git diff --stat main...HEAD`.

## Do NOT

- Do NOT touch `publish-everywhere.tsx`.
- Do NOT change any server action's behaviour. This is a UI gate only.
- Do NOT `git add -A` - commit touched files by name; untracked `claude/*.md`
  must not be swept in.
- Do NOT edit `app/privacy/page.tsx` in this branch. The policy becomes true once
  this ships; changing both at once makes the diff harder to reason about.
- Do NOT push. Author the branch; Cowork verifies and Noam file-scoped pushes.

## Commit

```
fix(publish): confirm external destinations before any publish path posts

Set Live (page header) and the non-modal Publish everywhere button submitted
publishProperty directly, so a listing with an authorized Instagram or Facebook
Page channel posted publicly with no confirmation - breaking the KI999 invariant
that publish-everywhere.tsx already upholds, and contradicting the published
privacy policy. Both now route through a shared confirm that names every
connected account the post will reach, derived from the same predicate the
autofire uses so the two cannot drift.
```

## Note for Noam, not for Codex

The new modal's confirm button is **"Approve & publish"**, matching
`app/privacy/page.tsx:91`. The existing modal in `publish-everywhere.tsx` labels
its confirm **"Publish everywhere"**, and the S628 App Review package calls it
**"Review & post"** - three names for one action, only one of which a user can
find. Worth settling on one word across the product, the policy and the
submission, but not in this branch while App Review is pending.
