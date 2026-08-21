# CODEX PROMPT - S660: two consecutive channel authorizations leave the rail AND the publish confirm stale

Repo: `vacantless-app`. Base: `main` at `3084501`.
Branch: `codex/s660-channel-mutation-stale-render`

> **AMENDED 2026-08-17 (S661) after re-deriving the whole thing from the code at `3084501`
> (HEAD confirmed, tree clean via `git --no-optional-locks`). Every claim below held. Four things
> changed, and one of them changes the SHAPE of the fix - read `## S661 amendments` before Change 1.**

## Why

`authorizeChannelAutomation` (`app/dashboard/properties/distribution-actions.ts:357-413`) writes
correctly every time. The distribute rail and, critically, the **publish confirm modal** can render
from a stale tree afterwards, so a channel the operator just authorized is silently absent from the
destination list and does not receive the post.

Reproduced on prod 2026-08-16 on Growth Test `8ea1da48`, property `5a1e0c7d`, and independently by
Noam clicking by hand:

| Time (UTC) | Action | DB | Rail after |
|---|---|---|---|
| 17:28:39 | Authorize `facebook_feed` | `automation_authorized=true` | correct, flips to Instant |
| 17:30:48 | Authorize `instagram`, no reload between | `automation_authorized=true` | **STALE**, still "Needs authorization" |
| - | Open "Publish everywhere" | - | modal listed **facebook_feed only** |
| - | Reload | - | both correct, modal lists all four |

Publishing at that moment would have posted to the Facebook Page and **not** to Instagram, on the
run whose entire purpose was to evidence `instagram_content_publish` for Meta App Review. The
failure direction is a silent under-publish, which is safe-ish, but the confirm modal is the Meta
App Review commitment surface (`publish-everywhere.tsx:27-32`, KI999) and it is currently capable
of naming a set of destinations that is not the set that will actually receive the post.

Compounding it: the listing is Live afterwards, and gate 2 means `publishProperty` no-ops on an
already-live listing, so the operator has **no clean retry**.

## Root cause - confirmed, do not re-derive it

`authorizeChannelAutomation` and `revokeChannelAutomation` (`:415-459`) are **symmetric**. Both call
`revalidatePath('/dashboard/properties/{id}')` and then `backTo(...)`. The asymmetry is in the
redirect TARGET.

`distribution-actions.ts:92-94`:

```ts
function backTo(propertyId: string, msg: string): never {
  redirect(`/dashboard/properties/${propertyId}?dist=${msg}#distribute`);
}
```

Authorize always targets `?dist=channel_auto_on`; revoke always targets `?dist=channel_auto_off`.
**Authorizing a second channel redirects to the URL the browser is already on.** Next.js App Router
treats a redirect to an identical URL as a no-op navigation, so no fresh RSC payload is fetched.
`revalidatePath` correctly invalidated the server cache; nothing ever asks for the new render.

This is NOT authorize-specific. Any two consecutive same-outcome channel mutations without a reload
go stale. Revoke only looked healthy because it was never run twice in a row. Predicted and
currently untested: revoke, revoke also goes stale. Please confirm that in a test rather than
assuming it.

## The no-regression baseline, from the code at `3084501`

State these from the file, do not infer them from this document.

- **`distribution-actions.ts:92-94`** - `backTo(propertyId, msg)`, two params, returns `never`,
  redirects to `/dashboard/properties/${propertyId}?dist=${msg}#distribute`. **Find every caller
  before changing the signature.** At minimum `channelAutomationBackTo` (`:257-260`) forwards to it.
- **`distribution-actions.ts:257-260`** - `channelAutomationBackTo` falls through to
  `/dashboard/settings?tab=distribution&dist=${msg}` when `propertyId` is empty. That settings
  fallback has the same collapse problem and must be fixed the same way.
- **`authorizeChannelAutomation` :406-412** - `revalidatePath(property)` then `backTo(propertyId,
  "channel_auto_on")`, then `revalidatePath("/dashboard/settings")` and a settings redirect.
- **`revokeChannelAutomation` :452-458** - identical shape with `"channel_auto_off"`.
- **The predicate is correct and SHARED. Do not touch it.**
  `authorizedInstantPublishDestinations` (`lib/auto-distribution.ts:82-113`) is consumed by BOTH
  `autoDistributionChannels` (`:115+`) and the UI (`page.tsx:1400`). The Instagram org-allowlist
  check at `:100-103` is deliberate. The defect is in what STATE the predicate is handed, not the
  predicate.
- Any `?dist=` value the UI already switches on for flash messages must keep working. Enumerate
  them before editing: grep `dist=` across `app/`.

## S661 amendments - read before Change 1

**1. The bug is NOT confined to channel mutations. `backTo` has ~60 call sites and most pass a
CONSTANT message.** Every one of them collapses on a repeat with the same outcome, by exactly the
same mechanism. Verified by `grep -n 'backTo(' app/dashboard/properties/distribution-actions.ts` at
`3084501`. Concretely reachable repeats include:

| Message | Lines | Repeats when |
|---|---|---|
| `channel_auto_on` / `channel_auto_off` | 409, 455 | the known bug |
| `account_saved` | 930 | operator saves two channel accounts in a row |
| `radar_auto_on` / `radar_auto_off` | 592 | two properties toggled the same direction |
| `fb_already` / `ig_already` | 1127, 1334 / 1456, 1681 | re-clicking publish on an already-posted channel |
| `copilot_already` | 1812, 1937 | same, co-pilot lane |
| `pubpage_${result}` / `feed_${result}` / `proof_${result}` | 694, 783, 861 | two consecutive runs share a result |
| every error message (`fb_reconnect`, `ig_config`, ...) | many | the operator retries and hits the same error twice, which is the NORMAL case |

That last row matters most: **a user retrying a failing action is the single most likely way to hit
this**, and today the second failure renders no change at all, which reads as "my click did
nothing".

**So do NOT implement Change 1 as an optional `channel` parameter threaded through two callers.**
That fixes the two call sites we happened to catch and leaves the other ~58. **Put the uniqueness
inside `backTo` itself**, so every caller is fixed at once and no future caller can reintroduce it:

```ts
function backTo(propertyId: string, msg: string): never {
  // Next 14 App Router no-ops a redirect to the URL already loaded, so a repeated
  // outcome would leave the client tree - and the publish confirm modal - stale.
  // A per-mutation token guarantees a real navigation. See FINDINGS-AUTHORIZE-RAIL-STALE-RENDER-S660.
  redirect(`/dashboard/properties/${propertyId}?dist=${msg}&m=${Date.now().toString(36)}#distribute`);
}
```

Apply the identical treatment to both settings-surface redirects, which the property-scoped helper
never touches: `channelAutomationBackTo`'s fallback (`:258-259`) and the two literal tail redirects
inside the actions themselves (`authorizeChannelAutomation:412`, `revokeChannelAutomation:458`,
both `redirect("/dashboard/settings?tab=distribution&dist=channel_auto_*")`). **The optional-param
version of the fix would have missed all three of these.**

If you prefer carrying the channel for a nicer flash message, do that IN ADDITION, not instead.

**2. The framework version is `next@14.2.35`** (`package.json:20`). The "identical URL is a no-op
navigation" behaviour is version-specific. Pin that in the PR description so a future Next upgrade
that changes it does not silently make this fix look unnecessary.

**3. There is already a working precedent for forcing a re-render in this codebase.**
`photo-manager.tsx` calls `router.refresh()` after each mutation (`:282`, `:311`, `:337`, `:366`).
If the token-in-URL approach is rejected in review, a client-side `router.refresh()` on the rail's
mutation forms is the in-house alternative. Mention which you chose and why.

**4. The revoke-twice confirmation CANNOT be run right now, and you must not force it.** The only
org with any connected channel is Growth Test `8ea1da48`, and `facebook_feed` + `instagram` are both
`connected` + `automation_authorized=true` there [verified 2026-08-17 via Supabase]. That org is the
**Meta App Review reviewer's login and the submission is frozen and un-editable**. Revoking there
disturbs reviewer state and writes consent-attempt rows. Either stand up a fresh QA sandbox org with
two connected channels first, or leave revoke-twice as a code-level claim and say so plainly in the
PR. Do not "just quickly" revoke on Growth Test.

## The exact stale path, file:line (added S661, so you do not have to trace it)

`channelCards` prop -> `PublishEverywhere({...channelCards})` (`publish-everywhere.tsx:263-290`) ->
`byBucket("instant")` (`:316`) -> `instantRows` passed to the confirm (`:674`) -> consumed by the
confirm component (`:1027`, `:1035`, `:1042`, `:1085`). **Every one of those is client-side state
captured at page render.** Nothing in that chain re-reads the server, which is why a no-op
navigation produces a confirm modal that names the wrong destinations.

`searchParams.dist` is declared at `app/dashboard/properties/[id]/page.tsx:455` and read by name, so
adding an extra query param does not disturb the flash-message consumer.

## Scope

Two changes. No schema change, no env change, no flag.

### Change 1 - guarantee a navigation on every mutation

See amendment 1 above for the shape. **Put the uniqueness inside `backTo`**, and fix the three
settings-surface redirects it does not cover.

**Do NOT fix this by dropping the redirect and relying on `revalidatePath` alone.** That is exactly
the combination that is broken today.

If two authorizations of the *same* channel in a row still collapse, that is acceptable: the second
is a no-op write and the rendered state is already correct.

### Change 2 - make the confirm modal read fresh, so a stale rail is cosmetic

A URL-uniqueness trick is a sharp edge that a future cleanup will file off. Add a second line of
defence: have the publish confirm derive its destination list from a server read at the moment it
opens, rather than from props captured at page render.

Keep the same shared predicate. Only change where its input rows come from. If that is a larger
refactor than it looks, say so and ship Change 1 alone rather than half-doing this.

## Tests

- **Two `backTo` calls with the SAME message produce DIFFERENT URLs.** This is the test that
  actually encodes the bug. A test that only checks the URL shape would pass on the broken code.
- Authorize channel A then channel B without an intervening reload: both rows read authorized and
  the destination list contains both. This is the regression test for the actual bug.
- **A repeated ERROR outcome also produces a fresh navigation** (e.g. `fb_reconnect` twice). This is
  the most likely real-world trigger and the optional-param fix would not have covered it.
- Revoke twice in a row: confirm whether it collapses today, and that it does not after the fix.
  **Not on Growth Test** - see amendment 4.
- Authorize then revoke then authorize the same channel: still correct.
- An org with no Meta channel connected: unchanged, empty destination list, plain form.
- Instagram authorized but org NOT in `IG_CHANNEL_ORG_ALLOWLIST`: still excluded. Do not regress
  the allowlist scoping.

## Verify before opening the PR

- `git grep "?dist="` and confirm every flash-message consumer still matches.
- Build gate: explicit `git add` of only the touched files, then a clean build.
- Manual: on a QA sandbox org (never Agile), connect two Meta channels, authorize both without
  reloading, open the confirm, and confirm both are listed.

## Related

- `claude/FINDINGS-AUTHORIZE-RAIL-STALE-RENDER-S660.md` - the full finding with DB evidence.
- `claude/FINDINGS-APP-REVIEW-FLOW-MISMATCH-S659.md` and commit `b64eb36` - the confirm gate this
  bug undermines.
- Gate 2 - `publishProperty` no-ops on an already-live listing, which removes the retry path.
