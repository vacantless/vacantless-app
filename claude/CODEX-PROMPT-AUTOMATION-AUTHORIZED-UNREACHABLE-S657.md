# CODEX PROMPT - `automation_authorized` can never be turned on (S657)

**Repo:** `vacantless-app`
**Base:** `main` at `eee04f9`
**Branch to create:** `codex/s657-authorize-channel-automation`
**Ship state:** commit on the branch. Do NOT push. Do NOT flip any env var.

---

## WHY (read this before touching code)

`distribution_channel_accounts.automation_authorized` is the per-channel operator consent gate
for every `api_automatic` channel. Today there are exactly two of those:

- `facebook_feed` (Facebook Page feed)
- `instagram`

**Nothing in the product can ever set that column to `true`.** It is read as a gate in at least
six places and written in four, and every single write sets it to `false`. There is no server
action, no form, no toggle, no settings control that turns it on.

Verified 2026-08-16 at `eee04f9`:

```
grep -rn "automation_authorized: true\|automationAuthorized: true" app/ lib/
  -> no matches
```

The four writes are all teardown, and all write `false`:

| Site | Context |
|---|---|
| `app/dashboard/properties/distribution-actions.ts:793-795` | `disconnectFacebookPage` |
| `app/dashboard/properties/distribution-actions.ts:816-818` | same handler, Instagram sibling row |
| `app/dashboard/properties/distribution-actions.ts:1023-1025` | Facebook publish failure teardown |
| `app/dashboard/properties/distribution-actions.ts:1370-1372` | Instagram publish failure teardown |

`authorizeAutopilotSubmit` (`distribution-actions.ts:260`) is **not** this. It approves a single
`concierge` run item by stamping `operator_submit_approved_at`. It never touches
`automation_authorized`. Do not conflate them.

### What this breaks

Because the flag is permanently `false` for every org:

1. `postInstagramNow` (`distribution-actions.ts:1236`) always bails to `ig_authorizefirst`.
2. `postFacebookPageNow` (`distribution-actions.ts:907`) always bails to `fb_authorizefirst`.
3. `selectChannelPublishAutofireItems` (`lib/channel-publish-autofire.ts`) requires
   `account.automationAuthorized === true`, so autofire never selects either channel.
4. The distribution worker (`app/api/cron/distribution-worker/route.ts:208`) filters on the same
   flag.
5. In the rail, `channelTileStatus(...)` is fed `automation_authorized`
   (`app/dashboard/properties/[id]/channel-publish-rail.tsx:114`), so `tile.state` never reaches
   `"linked"`, so `apiReady` is never true, so a fully connected Instagram or Facebook Page
   channel renders in the **gated** tier as "Connect once" forever - even immediately after a
   successful OAuth connect.

In other words the entire Graph-API publishing lane is unreachable by any customer, and the two
error strings `ig_authorizefirst` / `fb_authorizefirst` point at an authorization step that does
not exist in the product.

This was found in S657 while dogfooding the Instagram channel. The Growth Test org
`8ea1da48-0cd2-45a4-bfba-023b31a67884` had `account_status='connected'` for `instagram`
immediately after a clean OAuth connect, and the rail still showed "Connect once". The flag had
to be flipped by hand in SQL to proceed.

### Why this is urgent, not cosmetic

The Meta App Review screencast has to show the app publishing to a Page and to Instagram. A
reviewer following the documented flow hits the same dead end we did. Business verification is
done and Access Verification is In Review, so this is the remaining product-side blocker on the
whole Meta lane.

---

## WHAT TO BUILD

An explicit, operator-facing authorization step that sets `automation_authorized = true`, plus
the audit columns that already exist and are currently only ever nulled:
`automation_authorized_at` and `automation_authorized_by`.

### Required behaviour

1. **A new server action**, in `app/dashboard/properties/distribution-actions.ts`, alongside the
   existing channel actions. Suggested name `authorizeChannelAutomation`. It must:
   - `await requireCapability("manage_properties", FORBIDDEN)` - same guard as its neighbours.
   - Resolve the org via `getCurrentOrg()`; never trust an org id from the form.
   - Accept a `channel` and validate it is one whose `mode` is `api_automatic`. Reject anything
     else. Do not let this action authorize `kijiji`, `facebook` (Marketplace), or any
     `assisted_manual` / `feed_or_assisted` channel.
   - Require the row to already be `account_status = 'connected'`. Authorizing a
     `needs_setup` row must be refused - consent to automate an account that is not connected is
     meaningless and would let the flag survive a later connect.
   - Set `automation_authorized = true`, `automation_authorized_at = now()`,
     `automation_authorized_by = <auth uid>`.
   - Be scoped by `.eq("organization_id", org.id)` on the update, not just filtered in a prior
     select.
   - Record a `distribution_publish_attempts` audit row if that is the established pattern for
     consent events in this file - follow whatever `authorizeAutopilotSubmit` does, do not
     invent a different audit shape.

2. **A matching de-authorize action** (suggested `revokeChannelAutomation`) that sets the flag
   back to `false` and nulls the two audit columns. An operator who can switch autoposting on
   must be able to switch it off without disconnecting the account entirely. Today the only way
   to get to `false` is a full disconnect.

3. **UI to reach both.** Put it where the operator already looks at this channel. Two candidate
   homes exist; pick ONE and say which in the PR body:
   - the channel card on `Company settings -> Rental site accounts`
     (`/dashboard/settings?tab=distribution`), which is where `upsertChannelAccount`
     (`distribution-actions.ts:668`) already saves per-channel state; or
   - the channel rail on the property page (`channel-publish-rail.tsx`), next to the existing
     connect affordance.

   The control must state plainly what is being authorized: that Vacantless will publish this
   listing to that account automatically, without a further per-post click. This is consent
   copy, not a settings label. Do not word it as "enable channel".

4. **The rail must stop lying.** Once a channel is `connected` but not yet authorized, it should
   read as needing authorization, not as needing a connection. "Connect once" on an account that
   is already connected is the specific thing that wasted an hour in S657.

### Explicitly out of scope

- Do not change what the gate does. Every existing read stays exactly as it is; a channel that
  is not authorized must still fail closed everywhere it does today.
- Do not default the flag to `true` on connect. `saveFacebookPageConnection` must keep leaving it
  `false`. The whole point is that publishing on someone's behalf is a separate, deliberate,
  recorded consent.
- Do not touch `IG_CHANNEL_ENABLED` or `IG_CHANNEL_ORG_ALLOWLIST`.
- No migration. `automation_authorized`, `automation_authorized_at` and
  `automation_authorized_by` all already exist.

---

## ACCEPTANCE CRITERIA

Report the ACTUAL result of each. Do not reshape code to match a predicted shape; if a criterion
turns out to be wrong, say so in the PR body.

1. `grep -rn "automation_authorized: true" app/ lib/` returns at least one match, and every match
   is inside the new authorize action.
2. Connecting a Facebook Page via OAuth still leaves `automation_authorized = false`. Unchanged.
3. With a `connected` + unauthorized `instagram` row, the property rail does NOT render
   "Connect once"; it renders an authorization affordance.
4. After authorizing, `apiReady` becomes true for that channel and it moves into the `instant`
   tier.
5. After authorizing, `postInstagramNow` no longer bails at `ig_authorizefirst`.
6. Revoking sets the flag to `false` and nulls both audit columns, and the channel returns to the
   gated tier without disconnecting the OAuth account.
7. The authorize action refuses: a channel that is not `api_automatic`; a row that is not
   `connected`; an org other than the caller's.
8. `npm run build` passes.

## PROVE THE COMMIT

Report `git diff main...codex/s657-authorize-channel-automation --stat` verbatim in the PR body.
A `git status` or plain `git diff` is not acceptable evidence - S655 reported "committed" for
loose working-tree state that turned out to be an empty three-dot diff.
