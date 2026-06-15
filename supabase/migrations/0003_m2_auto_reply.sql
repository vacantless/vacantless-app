-- ============================================================================
-- Vacantless — M2: instant auto-reply support
-- ============================================================================
-- Adds the server-side pieces the app needs to send a branded auto-reply email
-- (via Brevo, from the Vercel server action) the moment a public inquiry lands:
--
--   * submit_public_lead(...)  — REPLACED. Same args, but now RETURNS jsonb:
--     the new lead id PLUS everything the app needs to render + send the email
--     (renter name/email, org branding, property address/rent, and the org's
--     auto_reply template override if one exists). The renter still only ever
--     gets back data about the listing they just inquired on — never another
--     tenant's rows. RLS on the base tables is untouched.
--
--   * record_auto_reply(...)   — NEW, SECURITY DEFINER, anon-callable. After the
--     app actually sends the email it logs an OUTBOUND message to the lead's
--     activity timeline. Guarded so anon can only log against a *recent* lead
--     (<15 min old) that has no prior outbound email — bounding any abuse to the
--     legitimate just-submitted window.
--
-- Run this whole file once in the Supabase SQL editor (after 0002).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Public write (v2): create a lead AND return the auto-reply payload.
-- Return type changes (uuid -> jsonb) so we must drop + recreate, then re-grant.
-- ---------------------------------------------------------------------------
drop function if exists public.submit_public_lead(uuid, text, text, text, date, text);

create or replace function public.submit_public_lead(
  p_property_id uuid,
  p_name        text,
  p_email       text,
  p_phone       text,
  p_move_in     date,
  p_notes       text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_lead     uuid;
  v_addr     text;
  v_rent     integer;
  v_org_name text;
  v_brand    text;
  v_logo     text;
  v_tpl_subj text;
  v_tpl_body text;
begin
  select p.organization_id, p.address, p.rent_cents,
         o.name, o.brand_color, o.logo_url
    into v_org, v_addr, v_rent, v_org_name, v_brand, v_logo
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id and p.status <> 'off_market';

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

  -- Inbound activity note for the timeline (unchanged behaviour).
  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, v_lead, 'note', 'inbound',
     'New inquiry via the public listing page'
       || case when p_move_in is not null
               then '. Desired move-in: ' || to_char(p_move_in, 'YYYY-MM-DD')
               else '' end);

  -- Most-recent auto_reply template for this org, if the operator made one.
  select t.subject, t.body
    into v_tpl_subj, v_tpl_body
  from public.templates t
  where t.organization_id = v_org and t.kind = 'auto_reply'
  order by t.created_at desc
  limit 1;

  return jsonb_build_object(
    'lead_id',          v_lead,
    'org_id',           v_org,
    'renter_name',      nullif(btrim(p_name), ''),
    'renter_email',     nullif(btrim(p_email), ''),
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'logo_url',         v_logo,
    'property_address', v_addr,
    'rent_cents',       v_rent,
    'template_subject', v_tpl_subj,
    'template_body',    v_tpl_body
  );
end;
$$;

grant execute on function public.submit_public_lead(uuid, text, text, text, date, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Log a sent auto-reply to the lead timeline (anon-safe, tightly scoped).
-- ---------------------------------------------------------------------------
create or replace function public.record_auto_reply(
  p_lead_id uuid,
  p_subject text,
  p_to      text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- Only a recently-created lead with no prior outbound email qualifies.
  select organization_id into v_org
  from public.leads
  where id = p_lead_id
    and created_at > now() - interval '15 minutes'
    and not exists (
      select 1 from public.messages m
      where m.lead_id = p_lead_id
        and m.channel = 'email'
        and m.direction = 'outbound'
    );

  if v_org is null then
    return;  -- silently no-op: stale, missing, or already logged
  end if;

  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, p_lead_id, 'email', 'outbound',
     'Auto-reply sent'
       || case when p_to is not null then ' to ' || p_to else '' end
       || case when p_subject is not null then ' — "' || p_subject || '"' else '' end);
end;
$$;

grant execute on function public.record_auto_reply(uuid, text, text)
  to anon, authenticated;
