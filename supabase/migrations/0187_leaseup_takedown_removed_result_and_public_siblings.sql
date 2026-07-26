-- ============================================================================
-- 0187_leaseup_takedown_removed_result_and_public_siblings
--
-- S575 lease-up ad lifecycle:
-- - let distribution_verifications record a proven removal (`result='removed'`);
-- - expose anon-safe compatible available sibling rentals for a leased /r page.
-- ============================================================================

alter table public.distribution_verifications
  drop constraint if exists distribution_verifications_result_check;

alter table public.distribution_verifications
  add constraint distribution_verifications_result_check
  check (result in (
    'verified_live',
    'verified_submitted',
    'stale',
    'not_found',
    'blocked',
    'needs_login',
    'needs_payment',
    'proof_unavailable',
    'failed',
    'removed'
  ));

create or replace function public.get_public_leaseup_siblings(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with source as (
    select id, organization_id, beds, unit_type
    from public.properties
    where id = p_property_id
      and status not in ('draft', 'off_market')
  ),
  siblings as (
    select
      p.id,
      p.address,
      p.rent_cents,
      p.beds,
      p.baths,
      p.available_date
    from public.properties p
    join source s on s.organization_id = p.organization_id
    where p.id <> s.id
      and p.status = 'available'
      and (s.beds is null or p.beds is null or p.beds = s.beds)
      and (s.unit_type is null or p.unit_type is null or p.unit_type = s.unit_type)
    order by p.available_date nulls last, p.address asc
    limit 6
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', siblings.id,
        'address', siblings.address,
        'rent_cents', siblings.rent_cents,
        'beds', siblings.beds,
        'baths', siblings.baths,
        'available_date', siblings.available_date
      )
      order by siblings.available_date nulls last, siblings.address asc
    ),
    '[]'::jsonb
  )
  from siblings;
$$;

grant execute on function public.get_public_leaseup_siblings(uuid) to anon, authenticated;
