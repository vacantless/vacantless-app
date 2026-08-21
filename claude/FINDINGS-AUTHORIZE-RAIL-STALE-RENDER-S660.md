# The distribute rail renders stale after a second mutation, and the confirm modal reads the same stale state (S660, 2026-08-16)

**STATUS: OPEN. Real, reproducible, and it silently narrows what gets published.**
Found while recording the Meta App Review screencast. Confirmed independently by Noam clicking the
same control by hand.

> **S661 (2026-08-17): every claim in this document was re-derived from the code at `3084501` and
> HELD.** Two things are now known to be understated, and one blocker was found:
> 1. **The scope is much wider than "channel mutations".** `backTo` has ~60 call sites and most pass
>    a constant message, so `account_saved`, `radar_auto_*`, `fb_already`, `ig_already`,
>    `copilot_already`, the `pubpage_/feed_/proof_` result messages and **every error message** all
>    collapse the same way on a repeat. A user RETRYING A FAILING ACTION is the most likely way to
>    meet this bug, not two authorizations.
> 2. **The fix therefore belongs inside `backTo`**, not threaded as an optional `channel` param
>    through two callers. It also has to cover three settings-surface redirects that a
>    property-scoped helper never touches (`:258-259`, `:412`, `:458`).
> 3. **Revoke-twice still cannot be tested.** The only org with connected channels is Growth Test
>    `8ea1da48`, which is the Meta App Review reviewer's frozen login. A QA sandbox org with two
>    connected channels has to be stood up first.
>
> Also confirmed: `next@14.2.35`; the stale chain is `channelCards` prop ->
> `publish-everywhere.tsx:263-290` -> `byBucket("instant"):316` -> `instantRows:674` -> confirm at
> `:1027-1085`, all client state captured at page render; and `photo-manager.tsx:282,311,337,366`
> already uses `router.refresh()` as an in-house precedent for forcing a re-render.

---

## What happens

`authorizeChannelAutomation` **writes correctly every time.** The distribute rail does not always
re-render, and **the publish confirm modal reads the same stale state**, so a channel the operator
just authorized can be silently absent from the destination list.

Observed sequence on Growth Test `8ea1da48`, property `5a1e0c7d` (833 Pillette Rd Unit 3):

| Time (UTC) | Action | DB result | Rail after |
|---|---|---|---|
| 17:28:39 | Authorize `facebook_feed` (1st mutation this render) | `automation_authorized=true` | **correct** - flips to Instant |
| 17:30:48 | Authorize `instagram` (2nd mutation, same render) | `automation_authorized=true` | **STALE** - still "Needs authorization" |
| - | Open "Publish everywhere" confirm | - | modal listed Vacantless page, Email alerts, **facebook_feed only** |
| - | Full page reload | - | both rows correct, modal lists all four |

DB proof at the stale moment:

```
instagram | connected | automation_authorized=true
          | automation_authorized_at=2026-08-16 17:30:48.542+00
          | automation_authorized_by=967c8db1-e159-49d9-95b1-c4804f7b56ba
          | external_account_label=@getvacantless
```

## Why it matters

**This is not cosmetic.** The confirm modal is the Meta App Review commitment surface
(`publish-everywhere.tsx:27-32`, KI999). If it renders from stale state:

1. The operator authorizes a channel, sees "Needs authorization", clicks again, nothing appears to
   happen. Both clicks succeeded. The UI is lying.
2. They publish anyway. **The post goes only to the channels the stale render knew about.** Here
   that would have meant a Facebook Page post and no Instagram post, on the exact run intended to
   evidence `instagram_content_publish`.
3. The listing is now Live, so re-publishing hits **gate 2** (`publishProperty` no-ops on an
   already-live listing) - the operator has no clean retry.

Failure mode is a silent under-publish, which is the safe direction for Meta, but it is a
correctness bug and it makes the confirm modal untrustworthy as a statement of what will happen.

## What is NOT the bug

- Not a write failure. Every authorize wrote, with `_at` and `_by` populated.
- Not Instagram-specific. `facebook_feed` was the one that worked here purely because it went first.
- Not the revoke path. `revokeChannelAutomation` revalidated correctly every time it was observed,
  including as a 1st mutation after reload.

## ROOT CAUSE - confirmed from the code, not a theory

> An earlier version of this doc guessed "only the first mutation in a render cycle revalidates".
> That was wrong. `authorizeChannelAutomation` (`distribution-actions.ts:357-413`) and
> `revokeChannelAutomation` (`:415-459`) are **symmetric** - both call
> `revalidatePath('/dashboard/properties/{id}')` and then `backTo(...)`. The asymmetry is in the
> redirect TARGET, not the revalidation.

`backTo` (`distribution-actions.ts:92-94`):

```ts
function backTo(propertyId: string, msg: string): never {
  redirect(`/dashboard/properties/${propertyId}?dist=${msg}#distribute`);
}
```

Authorize always redirects to `?dist=channel_auto_on`. Revoke always redirects to
`?dist=channel_auto_off`.

**Authorizing a second channel redirects to the URL the browser is already on.** Next.js App Router
treats a redirect to the identical URL as a no-op navigation, so no fresh RSC payload is fetched.
`revalidatePath` did its job and invalidated the server cache, but nothing ever asks for the new
render, so the client keeps the tree it already had - including the props the confirm modal reads
its destination list from.

This predicts, and matches, everything observed:

| Sequence | URL transition | Result |
|---|---|---|
| 1st authorize (from a clean load) | `(none)` or `?dist=channel_auto_off` -> `?dist=channel_auto_on` | navigates, **fresh** |
| 2nd authorize, no reload between | `?dist=channel_auto_on` -> `?dist=channel_auto_on` | no navigation, **STALE** |
| revoke after an authorize | `?dist=channel_auto_on` -> `?dist=channel_auto_off` | navigates, **fresh** |
| revoke twice in a row | `?dist=channel_auto_off` -> `?dist=channel_auto_off` | predicted **STALE** (untestable today, see S661 note) |
| any action repeated with the same outcome | `?dist=X` -> `?dist=X` | **STALE** (S661: this is the general case) |

So it is not authorize-specific, and it is not even channel-mutation-specific. **Any two consecutive
same-outcome actions that route through `backTo` without a reload leave the rail and the confirm
modal stale.** Revoke only looked healthy because it was never run twice in a row.

## Reproduce

1. Growth Test, a property with both `facebook_feed` and `instagram` connected and unauthorized.
2. Load the distribute surface once. Do not reload again.
3. Click "Authorize auto-post" on Facebook Page feed. It flips to Instant.
4. Click "Authorize auto-post" on Instagram. **It stays "Needs authorization".**
5. Open "Publish everywhere". Instagram is missing from the destination list.
6. Reload. Both are correct.

## Workaround until fixed

Authorize one channel, reload, authorize the next. Or reload before opening the confirm modal.
**Never trust the rail without a reload** when more than one channel was touched.

## Suggested fix direction

The predicate itself (`authorizedInstantPublishDestinations`, `lib/auto-distribution.ts:82`) is
shared and correct. The defect is purely that the client is never asked to re-render, so the fix is
to guarantee a navigation (or a refresh) on every mutation.

Preferred: make the redirect target unique per mutation so two consecutive authorizations can never
collapse to the same URL. Carrying the channel is enough and is also better UX, since the flash
message can then name the channel:

```ts
function backTo(propertyId: string, msg: string, channel?: string): never {
  const ch = channel ? `&ch=${encodeURIComponent(channel)}` : "";
  redirect(`/dashboard/properties/${propertyId}?dist=${msg}${ch}#distribute`);
}
```

Belt and braces, because a URL-uniqueness trick is a sharp edge someone will later "clean up":
have the confirm modal derive its destinations from a server read at open time rather than from
props captured at page render. Then a stale rail is cosmetic instead of a wrong publish.

Do NOT fix this by removing the redirect and relying on `revalidatePath` alone. That is the
combination that is already broken.

## Related

- KI999 / `publish-everywhere.tsx:27-32` - "nothing posts before the confirm modal" invariant.
- S659 gate work (`b64eb36`, `3084501`) - the confirm modal this bug undermines.
- Gate 2 - `publishProperty` no-ops on an already-live listing, which removes the retry path.
