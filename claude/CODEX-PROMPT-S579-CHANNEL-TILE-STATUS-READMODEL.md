# CODEX PROMPT — S579: Stage-1 channel tile-status read-model (honest "Link Your Portals" data feed)

Implement this end to end in `vacantless-app`, following every standing constraint
below. **Do not `git push`** — land natively; Noam pushes.

## Why

S578 shipped the canonical channel registry (`CANONICAL_CHANNEL_REGISTRY`) and the
pure `channelTileStatus(channelKey, account?)` helper in
`lib/distribution-channels.ts`. The accessible "Link Your Portals" screen (design
of record: `claude/DESIGN-PRESENTATION-LAYER-COMMAND-CENTER-S577.md`, Stage 1)
needs ONE server call that returns every channel's honest tile verdict for an org,
so the UI stays thin and never re-derives status. Build the UI's data feed ahead
of the UI (Noam's directive).

This is purely a read-model over data that ALREADY EXISTS — no new tables, no new
integrations.

## Scope

1. Add a server helper (co-locate with the existing distribution reads; the same
   pattern already lives in `app/dashboard/properties/actions.ts`, which builds an
   `accountStatusByChannel` Map from `distribution_channel_accounts` — reuse that
   shape, do NOT invent a new query pattern, KI926):

   `listChannelTileStatuses(orgId): Promise<Array<{ channel: string } & ChannelTileStatus>>`

   - Read `distribution_channel_accounts` for the org, selecting exactly the real
     columns `channel, account_status, automation_authorized` (verify these column
     names against the migrations before writing — 0141 defines `account_status`,
     0177 adds `automation_authorized`; KI930, do not guess columns).
   - Map each entry in `CANONICAL_CHANNEL_REGISTRY` through the pure
     `channelTileStatus(channel.key, accountRow ?? null)` where `accountRow` is the
     matching `distribution_channel_accounts` row (or null when the org has none).
   - Return one row per registry channel, in registry order. FB Page feed and
     Instagram connection state also lands in `distribution_channel_accounts`
     (see `lib/facebook-page-oauth.ts` upserts), so those resolve through the same
     path — do NOT special-case them.

2. Add a small presentation helper `channelTileLine(channelKey, tileState)` (pure)
   that returns the operator-facing one-line status sentence for the tile, derived
   from the tile `state` — NOT from the legacy `blurb` field. The S578 `blurb`
   fields are carried over from the older S412 framing and now contradict the
   `live` status for rentals_ca / zumper (they say "not a live integration"); the
   Stage-1 UI must NOT render those legacy blurbs. This helper is the honest
   replacement line.

3. A test (tsx, matching `scripts/test-distribution-channels.ts` style) asserting:
   `listChannelTileStatuses` returns exactly one row per registry channel; a
   `connected + automation_authorized` account row yields `linked`; a missing
   account yields `not_linked` + `canConnect:true`; `planned` channels yield
   `not_available_yet` regardless of any account row; `realtor_ca` yields
   `mls_only`; and `channelTileLine` never returns a legacy blurb string for a live
   channel. Mock the DB read (pass rows in) so the test stays pure — do not hit a
   real Supabase.

## Standing constraints

- Land natively; **do not `git push`**.
- Purely additive, **no migration**, no behavior change to any existing flow. Safe
  to deploy dark (nothing renders it yet).
- Reuse the REAL `channelTileStatus` + `CANONICAL_CHANNEL_REGISTRY` from S578 and
  the REAL `distribution_channel_accounts` columns (KI926/KI930). Verify the actual
  Supabase client pattern used by the neighbouring reads before writing the query.
- tsc clean; run the tsx test natively (tsx does not run over the bridge).

## Definition of done

- `listChannelTileStatuses(orgId)` returns the honest per-channel verdict list;
  `channelTileLine` gives a status-derived line that never contradicts the tile.
- Test passes natively; tsc clean. No migration, no existing-flow change.
- Report back the file list + the exact `distribution_channel_accounts` column
  names you selected, for warm-verify.
