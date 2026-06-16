-- ============================================================================
-- Vacantless — Showing clustering ("Hero blocks")
-- ============================================================================
-- Goal: cluster individual showings into building-level anchor windows so the
-- first booking on a building effectively sets the schedule everyone else
-- hooks onto — minimizing operator/agent travel and keeping showings grouped
-- per building per day.
--
-- ADAPTATION (vs the source spec's buildings/listings/showing_blocks tables):
--   * No new tables. Vacantless already models one unit = one row in
--     `properties` (free-text `address`); multiple units share a building
--     address. The "anchor block" for a building+day is IMPLICIT — it is just
--     the set of existing scheduled `showings` for that building on that day.
--     The first booking creates the anchor (a showing); later bookings derive
--     their offered slots from it. So there is NOTHING to write on the booking
--     path and NO showing_blocks / appointments tables — the clustering is
--     computed read-side in lib/booking.ts (pure + tested).
--   * Building identity is a normalized key off `properties.address`, computed
--     in tested TS (buildingKey()) as the single source of truth. This RPC
--     returns the raw same-org future scheduled showings (address + time) for
--     CURRENTLY-LISTED properties only; the TS filters them to the same
--     building as the requested listing.
--   * Opt-in per org: clustering_enabled defaults false, so existing orgs (incl.
--     the live house org) behave EXACTLY as before until they switch it on.
--
-- Adds:
--   * organizations.clustering_enabled        bool, default false (the toggle)
--   * organizations.clustering_buffer_minutes int,  default 60    (how far
--       adjacent slots may extend an anchor window, each side)
--   * organizations.showing_block_capacity    int,  default 6     (max showings
--       to cluster into one building+day before that day stops offering slots)
--   * get_public_availability(uuid) REPLACED to also return the 3 config values
--       + cluster_candidates = future scheduled showings (address + scheduled_at)
--       for the org's currently-listed properties. Anon-safe (SECURITY DEFINER).
--
-- No new GRANT (M1 table grants extend to new columns; the RPC is the only
-- anon path and it is SECURITY DEFINER). No write-path change. Run once after
-- 0015.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-org clustering configuration.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists clustering_enabled        boolean not null default false,
  add column if not exists clustering_buffer_minutes integer not null default 60
    check (clustering_buffer_minutes between 0 and 480),
  add column if not exists showing_block_capacity    integer not null default 6
    check (showing_block_capacity between 1 and 50);

-- ---------------------------------------------------------------------------
-- Public read: a listing's booking config + availability + booked slots, now
-- also carrying the clustering config + the org's currently-listed future
-- scheduled showings so the TS can derive same-building anchor windows.
-- Anon-safe. Returns NULL when the property is missing or off market.
-- (Adds keys to the 0004 shape; existing consumers read by key so this is
-- backward-compatible.)
-- ---------------------------------------------------------------------------
create or replace function public.get_public_availability(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'timezone',     o.booking_timezone,
    'slot_minutes', o.booking_slot_minutes,
    'lead_hours',   o.booking_lead_hours,
    'horizon_days', o.booking_horizon_days,
    -- clustering config
    'clustering_enabled',        o.clustering_enabled,
    'clustering_buffer_minutes', o.clustering_buffer_minutes,
    'showing_block_capacity',    o.showing_block_capacity,
    'rules', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday',      a.weekday,
               'start_minute', a.start_minute,
               'end_minute',   a.end_minute)
             order by a.weekday, a.start_minute)
      from public.availability_rules a
      where a.organization_id = o.id
    ), '[]'::jsonb),
    'booked', coalesce((
      select jsonb_agg(s.scheduled_at)
      from public.showings s
      where s.organization_id = o.id
        and s.outcome = 'scheduled'
        and s.scheduled_at >= now()
    ), '[]'::jsonb),
    -- Future scheduled showings (address + time) for the org's currently-listed
    -- properties only. The TS filters these to the same building as p_property_id
    -- to derive that building's implicit anchor window(s). Off-market property
    -- addresses are never returned. Only meaningful when clustering is enabled,
    -- but always returned (cheap) so the page logic stays simple.
    'cluster_candidates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'address',      cp.address,
               'scheduled_at', s.scheduled_at)
             order by s.scheduled_at)
      from public.showings s
      join public.properties cp on cp.id = s.property_id
      where s.organization_id = o.id
        and s.outcome = 'scheduled'
        and s.scheduled_at >= now()
        and cp.status <> 'off_market'
    ), '[]'::jsonb)
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status <> 'off_market';
$$;

grant execute on function public.get_public_availability(uuid) to anon, authenticated;
