-- ============================================================================
-- Vacantless — Listing distribution / source tracking
-- ============================================================================
-- A property is advertised on many portals (Kijiji, Facebook Marketplace,
-- Rentals.ca, Zumper, Viewit, Realtor.ca, ...). Until now every public-page
-- inquiry was hardcoded source = 'website', so an operator could not tell which
-- channel actually produced a renter. That is the broken-source-attribution
-- finding from the 2026-06-09 Learning Audit (FB was the real #1 channel but
-- was mislabeled).
--
-- This migration adds:
--   * public.listing_posts  — one row per (property, portal) ad. The operator
--     records where the unit is posted, the live ad URL, and its status.
--   * leads.listing_post_id — which post a renter came through (set when the
--     renter inquires via a per-post tracked link /r/<property>?p=<postId>).
--   * submit_public_lead(... p_listing_post_id) — the SECURITY DEFINER public
--     intake RPC now accepts an optional post id, validates it belongs to the
--     property, and stamps the lead with the real portal name (source) + the ad
--     URL (source_detail) + the FK. No tracked param => unchanged 'website'.
--
-- RLS + grants follow the existing per-org table pattern (user_org_ids()). The
-- public RPC is SECURITY DEFINER (runs as owner) so anon never needs any grant
-- on listing_posts directly.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Table: listing_posts (one property -> many portal posts)
-- ---------------------------------------------------------------------------
create table if not exists public.listing_posts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id     uuid not null references public.properties(id) on delete cascade,
  portal          text not null
                    check (portal in (
                      'kijiji', 'facebook', 'rentals_ca', 'zumper',
                      'viewit', 'realtor_ca', 'other'
                    )),
  label           text,                       -- free label (esp. for 'other')
  url             text,                        -- the live ad URL (may be blank)
  status          text not null default 'live'
                    check (status in ('draft', 'live', 'expired', 'removed')),
  posted_on       date,                        -- when the ad went up
  notes           text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_listing_posts_property
  on public.listing_posts(property_id);
create index if not exists idx_listing_posts_org
  on public.listing_posts(organization_id);

-- ---------------------------------------------------------------------------
-- leads.listing_post_id — which post the renter came through (nullable; older
-- and untracked leads keep NULL). ON DELETE SET NULL so removing a post never
-- destroys the lead — the lead keeps its captured source text either way.
-- ---------------------------------------------------------------------------
alter table public.leads
  add column if not exists listing_post_id uuid
    references public.listing_posts(id) on delete set null;

create index if not exists idx_leads_listing_post
  on public.leads(listing_post_id);

-- ---------------------------------------------------------------------------
-- RLS + grants — same per-org shape as every other tenant table.
-- ---------------------------------------------------------------------------
alter table public.listing_posts enable row level security;

drop policy if exists listing_posts_all on public.listing_posts;
create policy listing_posts_all on public.listing_posts
  for all to authenticated
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.listing_posts to authenticated;

-- ---------------------------------------------------------------------------
-- submit_public_lead: add an optional p_listing_post_id. Drop the old 6-arg
-- signature first (the argument list grows). The new arg has a DEFAULT so any
-- caller that omits it still resolves to this one function.
-- ---------------------------------------------------------------------------
drop function if exists public.submit_public_lead(uuid, text, text, text, date, text);

create or replace function public.submit_public_lead(
  p_property_id     uuid,
  p_name            text,
  p_email           text,
  p_phone           text,
  p_move_in         date,
  p_notes           text,
  p_listing_post_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org        uuid;
  v_lead       uuid;
  v_addr       text;
  v_rent       integer;
  v_org_name   text;
  v_brand      text;
  v_logo       text;
  v_reply_to   text;
  v_tpl_subj   text;
  v_tpl_body   text;
  v_portal     text;
  v_label      text;
  v_url        text;
  v_post       uuid := null;
  v_source     text := 'website';
  v_source_det text := null;
begin
  select p.organization_id, p.address, p.rent_cents,
         o.name, o.brand_color, o.logo_url, o.reply_to_email
    into v_org, v_addr, v_rent, v_org_name, v_brand, v_logo, v_reply_to
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id and p.status <> 'off_market';

  if v_org is null then
    raise exception 'Listing not available';
  end if;

  -- Resolve the tracked post, but only if it genuinely belongs to THIS
  -- property (and therefore this org). A bad/foreign id silently falls back to
  -- the plain 'website' source — it can never attach a lead to another unit.
  if p_listing_post_id is not null then
    select lp.id, lp.portal, lp.label, lp.url
      into v_post, v_portal, v_label, v_url
    from public.listing_posts lp
    where lp.id = p_listing_post_id
      and lp.property_id = p_property_id;

    if v_post is not null then
      v_source := case v_portal
        when 'kijiji'     then 'Kijiji'
        when 'facebook'   then 'Facebook Marketplace'
        when 'rentals_ca' then 'Rentals.ca'
        when 'zumper'     then 'Zumper'
        when 'viewit'     then 'Viewit.ca'
        when 'realtor_ca' then 'Realtor.ca'
        else coalesce(nullif(btrim(v_label), ''), 'Other portal')
      end;
      v_source_det := nullif(btrim(v_url), '');
    end if;
  end if;

  insert into public.leads
    (organization_id, property_id, name, email, phone, move_in,
     source, source_detail, listing_post_id, status, notes)
  values
    (v_org, p_property_id,
     nullif(btrim(p_name), ''),
     nullif(btrim(p_email), ''),
     nullif(btrim(p_phone), ''),
     p_move_in,
     v_source, v_source_det, v_post, 'new',
     nullif(btrim(p_notes), ''))
  returning id into v_lead;

  -- Inbound activity note for the timeline. Mentions the channel when known.
  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, v_lead, 'note', 'inbound',
     'New inquiry via '
       || case when v_post is not null then v_source else 'the public listing page' end
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
    'reply_to_email',   v_reply_to,
    'property_address', v_addr,
    'rent_cents',       v_rent,
    'template_subject', v_tpl_subj,
    'template_body',    v_tpl_body
  );
end;
$$;

grant execute on function
  public.submit_public_lead(uuid, text, text, text, date, text, uuid)
  to anon, authenticated;
