# CODEX PROMPT — S581: Stage-4 "After it's live" read-model (the differentiator)

Implement this end to end in `vacantless-app`, following every standing constraint
below. **Do not `git push`** — land natively; Noam pushes.

## Why

Stage 4 of the command center (design of record:
`claude/DESIGN-PRESENTATION-LAYER-COMMAND-CENTER-S577.md`) is what publish-only
tools cannot show: the leads coming BACK, and the ad's END OF LIFE (take-down on
lease-up, proven live s577). This slice builds the per-property read-model that
feeds that screen, driven by REAL object status (rule 16), ahead of the UI.

## Scope

1. First, verify the REAL sources (KI926/KI930 — do not guess columns):
   - Leads: the `leads` table. S577 added `leads.ingest_message_key`; portal leads
     are inserted in `lib/portal-lead-ingest-server.ts`. Read the real `leads`
     columns (organization_id, property linkage, source/portal, created_at,
     contact) before writing — do not assume column names.
   - Take-down status: `listing_posts` rows, where `status = 'removed'` marks a
     taken-down ad (see `lib/leaseup-takedown.ts` and the `listing-distribution`
     status helpers). Reuse the existing `ListingPostStatus` type, do not hardcode
     string literals where a helper exists.

2. Add a server read-model `propertyAfterLiveSummary(propertyId)` returning:

   `type AfterLiveSummary = {`
   `  leads: Array<{ id: string; channel: string | null; name: string | null; receivedOn: string | null }>;`
   `  channels: Array<{ channel: string; postStatus: ListingPostStatus; takenDown: boolean }>;`
   `  leasedUp: boolean; // true when the property's ads are in take-down/removed state`
   `}`

   - `leads` is the real leads for this property, newest first, channel taken from
     the real leads column (portal/source) — null when unknown, never fabricated.
   - `channels` is one row per `listing_posts` portal for this property with its
     real status; `takenDown = status === 'removed'` via the status helper.
   - `leasedUp` reflects the real take-down state, not a guess.

3. A tsx test (matching `scripts/test-distribution-channels.ts` style) with fixture
   `leads` + `listing_posts` rows asserting: leads map newest-first with real
   channel/date; a `removed` post yields `takenDown:true`; a `live` post yields
   `takenDown:false`; `leasedUp` is true only when the ads are in removed state.
   Keep it pure — pass fixtures in, do not hit Supabase.

## Standing constraints

- Land natively; **do not `git push`**.
- Purely additive, **no migration**, no change to lead ingest or take-down flow.
  Read-only model, safe to deploy dark.
- Reuse the REAL `leads` columns + `listing_posts` status helpers (KI926/KI930).
  Only the object's own status row proves state (rule 16) — `leasedUp`/`takenDown`
  must come from `listing_posts.status`, never inferred from a tenancy guess.
- tsc clean; run the tsx test natively.

## Definition of done

- `propertyAfterLiveSummary(propertyId)` returns real leads + per-channel take-down
  status + an honest `leasedUp`, all from object status.
- Test passes natively; tsc clean. No migration, no existing-flow change.
- Report back the file list + the confirmed real `leads` column names used, for
  warm-verify.
