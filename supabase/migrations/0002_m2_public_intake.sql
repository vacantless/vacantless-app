-- ============================================================================
-- Vacantless — M2: public branded intake + lead CRM support
-- ============================================================================
-- Adds:
--   * leads.move_in  (desired move-in date captured on the public form)
--   * get_public_listing(uuid)   — SECURITY DEFINER, readable by anon, returns
--     only public-safe property fields + the org's branding. Lets an
--     unauthenticated renter render a branded listing page WITHOUT any
--     table-level read grant to anon (RLS still protects every base table).
--   * submit_public_lead(...)    — SECURITY DEFINER, callable by anon. Inserts
--     a lead scoped to the property's org and logs an inbound activity row.
--     A renter can create a lead but can never read or target another tenant.
-- Run this whole file once in the Supabase SQL editor (after 0001_init.sql).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Schema: desired move-in date on leads.
-- ---------------------------------------------------------------------------
alter table public.leads add column if not exists move_in date;

-- ---------------------------------------------------------------------------
-- Public read: one listing + its org branding, anon-safe.
-- Returns NULL when the property doesn't exist or is off market.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_listing(p_property_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',          p.id,
    'address',     p.address,
    'rent_cents',  p.rent_cents,
    'beds',        p.beds,
    'baths',       p.baths,
    'parking',     p.parking,
    'description', p.description,
    'status',      p.status,
    'org_name',    o.name,
    'brand_color', o.brand_color,
    'logo_url',    o.logo_url
  )
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id
    and p.status <> 'off_market';
$$;

-- ---------------------------------------------------------------------------
-- Public write: create a lead for a listing, anon-safe.
-- Resolves the org from the property server-side so the caller can't forge it.
-- Also logs an inbound activity message for the lead timeline.
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_lead(
  p_property_id uuid,
  p_name        text,
  p_email       text,
  p_phone       text,
  p_move_in     date,
  p_notes       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org  uuid;
  v_lead uuid;
begin
  select organization_id into v_org
  from public.properties
  where id = p_property_id and status <> 'off_market';

  if v_org is null then
    raise exception 'Listing not available';
  end if;

  insert into public.leads
    (organization_id, property_id, name, email, phone, move_in, source, status, notes)
  values
    (v_org, p_property_id,
     nullif(btrim(p_name), ''),
     nullif(btrim(p_email), ''),
     nullif(btrim(p_phone), ''),
     p_move_in,
     'website', 'new',
     nullif(btrim(p_notes), ''))
  returning id into v_lead;

  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, v_lead, 'note', 'inbound',
     'New inquiry via the public listing page'
       || case when p_move_in is not null
               then '. Desired move-in: ' || to_char(p_move_in, 'YYYY-MM-DD')
               else '' end);

  return v_lead;
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants. The functions are SECURITY DEFINER so they run as the owner and
-- bypass RLS internally; anon only ever gets exactly what these return.
-- ---------------------------------------------------------------------------
grant execute on function public.get_public_listing(uuid) to anon, authenticated;
grant execute on function public.submit_public_lead(uuid, text, text, text, date, text) to anon, authenticated;
