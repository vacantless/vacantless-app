-- ============================================================================
-- Vacantless — M5: automated post-showing feedback collection
-- ============================================================================
-- The first M5 differentiator. After a showing is marked Attended, a branded
-- email invites the renter to rate the visit (1–5) and leave a comment; they
-- submit on a public, login-free page. The feedback feeds the lead timeline and
-- the owner reporting dashboard (and, later, the price-drop / owner-signal loop).
--
-- Schema added here:
--   * showings.feedback_request_sent_at  — NEW nullable timestamptz. Stamped by
--     the feedback cron sweep so a request is sent at most once per showing.
--   * organizations.feedback_enabled     — NEW bool (default true). Per-org
--     master switch for the feature.
--   * organizations.feedback_delay_hours — NEW int (default 2). How long after
--     the showing's scheduled time to wait before sending the request.
--
-- Two anon-callable SECURITY DEFINER RPCs (same pattern as the M2/M3 public
-- RPCs — the renter never reads or targets another tenant's data):
--   * get_public_feedback_context(uuid) — branding + property + an
--     already_submitted flag, to render the public feedback page.
--   * submit_public_feedback(uuid, int, text) — inserts one feedback row
--     (resolving the org from the showing), logs the lead timeline, guards
--     against a duplicate submission and an out-of-range rating.
--
-- The feedback cron sweep reads showings across all orgs via the service-role
-- client (app/api/cron/feedback), so it needs no RPC — just the new columns to
-- select. The feedback table already has RLS (feedback_all) + an authenticated
-- grant from 0001, so operators can already read their own rows.
--
-- Additive + idempotent. Run once after 0008. M1 base-table RLS untouched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------------------
alter table public.showings
  add column if not exists feedback_request_sent_at timestamptz;

alter table public.organizations
  add column if not exists feedback_enabled boolean not null default true;

alter table public.organizations
  add column if not exists feedback_delay_hours integer not null default 2;

-- Sweep target: attended showings whose feedback request hasn't gone out yet.
create index if not exists idx_showings_feedback_pending
  on public.showings (scheduled_at)
  where outcome = 'attended' and feedback_request_sent_at is null;

-- ---------------------------------------------------------------------------
-- get_public_feedback_context: branding + property + already_submitted, used
-- to render the public /f/[showingId] page. Returns NULL when the showing
-- doesn't exist (the page 404s). Safe to call by anyone holding the link (the
-- showing id is an unguessable uuid); reveals only public-safe fields.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_feedback_context(
  p_showing_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_name   text;
  v_brand      text;
  v_logo       text;
  v_addr       text;
  v_renter     text;
  v_outcome    text;
  v_done       boolean;
begin
  select o.name, o.brand_color, o.logo_url, p.address, l.name, s.outcome
    into v_org_name, v_brand, v_logo, v_addr, v_renter, v_outcome
  from public.showings s
  join public.organizations o on o.id = s.organization_id
  left join public.properties p on p.id = s.property_id
  left join public.leads l on l.id = s.lead_id
  where s.id = p_showing_id;

  if v_org_name is null then
    return null;
  end if;

  select exists (
    select 1 from public.feedback f where f.showing_id = p_showing_id
  ) into v_done;

  return jsonb_build_object(
    'showing_id',       p_showing_id,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'logo_url',         v_logo,
    'property_address', v_addr,
    'renter_name',      v_renter,
    'already_submitted', v_done
  );
end;
$$;

grant execute on function public.get_public_feedback_context(uuid)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- submit_public_feedback: insert one feedback row for a showing. Resolves the
-- org server-side, rejects an out-of-range rating, and rejects a second
-- submission for the same showing. Logs an inbound timeline note on the lead.
-- ---------------------------------------------------------------------------
create or replace function public.submit_public_feedback(
  p_showing_id uuid,
  p_rating     integer,
  p_comments   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org      uuid;
  v_lead     uuid;
  v_org_name text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  select s.organization_id, s.lead_id, o.name
    into v_org, v_lead, v_org_name
  from public.showings s
  join public.organizations o on o.id = s.organization_id
  where s.id = p_showing_id;

  if v_org is null then
    raise exception 'Showing not found';
  end if;

  if exists (select 1 from public.feedback f where f.showing_id = p_showing_id) then
    raise exception 'Feedback already submitted';
  end if;

  insert into public.feedback (organization_id, showing_id, rating, comments)
  values (v_org, p_showing_id, p_rating, nullif(btrim(p_comments), ''));

  -- Lead timeline note (only when the showing is tied to a lead).
  if v_lead is not null then
    insert into public.messages
      (organization_id, lead_id, channel, direction, body)
    values
      (v_org, v_lead, 'note', 'inbound',
       'Renter left post-showing feedback: ' || p_rating || '/5'
         || case when nullif(btrim(p_comments), '') is not null
                 then ' — "' || btrim(p_comments) || '"'
                 else '' end);
  end if;

  return jsonb_build_object('ok', true, 'org_name', v_org_name);
end;
$$;

grant execute on function public.submit_public_feedback(uuid, integer, text)
  to anon, authenticated;
