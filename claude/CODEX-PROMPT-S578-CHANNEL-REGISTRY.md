# CODEX PROMPT — S578: canonical channel registry with honest integration status (backs the presentation-layer "Link Your Portals")

Implement this end to end in `vacantless-app`, following every standing constraint
below. **Do not `git push`** — land natively; Noam pushes.

## Why

The next big build is an accessible, single-column "Link Your Portals" screen
(design of record: `claude/DESIGN-PRESENTATION-LAYER-COMMAND-CENTER-S577.md`) that
lists ALL of Noam's target channels as large tiles with a plain-language status
banner per tile. Noam's directive: build the UI **ahead of** the backend so
adding a channel is a config flip, not a rebuild. The honesty rule from that
design: a tile must map to a REAL status or an explicit "not available yet" -
never a connect button that does nothing.

This slice builds the DATA layer that makes that possible: a single canonical
channel registry the UI (and anything else) reads, so tiles render truthfully and
a new channel is one registry entry.

## Scope

1. Extend `lib/distribution-channels.ts` (the existing home of `channelByKey`,
   `label`, etc. — verify its real exports first, KI926) with a canonical
   registry entry per channel carrying at least:
   - `key` (e.g. `facebook_feed`, `kijiji`, `rentals_ca`, `zumper`, `instagram`,
     `realtor_ca`, `rentfaster_ca`, `viewit_ca`, `linkedin`, `snapchat`,
     `whatsapp_business`),
   - `label` (human name), `category` ("portal" | "classifieds" | "social" |
     "chat"),
   - `integrationStatus`: `"live"` (real connect + post today) | `"planned"`
     (in Noam's spec, not integrated) | `"mls_gated"` (e.g. realtor.ca — cannot
     free-post),
   - `connectKind`: `"oauth"` | `"account_login"` | `"none"` — how a customer
     links it (drives which action the tile offers),
   - optional `notes` for the honest "why not yet" string.
   - Ground the `"live"` set against reality: Kijiji, Rentals.ca, Zumper,
     Facebook Page feed, Instagram are live today; realtor.ca is `mls_gated`; the
     rest are `planned`. Do NOT mark anything `live` that has no real
     connect/post path (that is the exact dishonesty the design forbids).

2. A pure helper `channelTileStatus(channelKey, account?)` that combines the
   registry entry with an optional `distribution_channel_accounts` row
   (`account_status`, `automation_authorized`) and returns a single presentation
   verdict the UI can render as a banner, e.g.
   `{ state: "linked" | "not_linked" | "not_available_yet" | "mls_only",
     headline: string, canConnect: boolean }`.
   Keep it PURE (no DB/network) so it is unit-testable and the UI stays thin.

3. A test (tsx, matching the existing style) asserting: every `"live"` channel
   with a connected+authorized account resolves to `"linked"`; a `"live"` channel
   with no account resolves to `"not_linked"` + `canConnect:true`; a `"planned"`
   channel resolves to `"not_available_yet"` + `canConnect:false`; `realtor_ca`
   resolves to `"mls_only"`; and the registry has no duplicate keys and every key
   the app already posts to (`listing_posts.portal` / tracker portals) exists in
   the registry.

## Standing constraints

- Land natively; **do not `git push`**.
- Purely additive, **no migration**, no behavior change to any existing flow -
  this is a registry + a pure helper the future UI reads. It must be safe to
  deploy dark (nothing renders it yet).
- Reuse the real `lib/distribution-channels.ts` shape and the real channel keys
  the worker/tracker already use (KI926) — do not invent keys that diverge from
  `listing_posts.portal`.
- Honesty over completeness: `integrationStatus` must reflect what actually
  works, so the UI can never show a dead connect button.
- tsc clean; run the tsx test natively.

## Definition of done

- Canonical registry covering all 12 channels with honest `integrationStatus` +
  `connectKind`, plus the pure `channelTileStatus` helper.
- Test passes natively; tsc clean. No migration, no existing-flow change.
- Report back the file list + the final `live` vs `planned` vs `mls_gated`
  split for warm-verify.
