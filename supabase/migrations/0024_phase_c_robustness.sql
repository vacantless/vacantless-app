-- 0024_phase_c_robustness.sql
-- Phase C QA fixes (Group C robustness, S202). Closes three audit items that
-- need DDL / RPC changes (VACANTLESS-PHASE-C-QA-AUDIT-2026-06-16.md):
--
--   C5  feedback has no unique(showing_id): submit_public_feedback dedups with a
--       non-atomic "if exists", so a double-submit race can insert two rows. Add
--       the constraint and treat unique_violation as "already submitted".
--   (memberships role model) Extend memberships.role to allow the forward-looking
--       'showing_helper' seat (the locked MVP seat model: owner_admin / operator
--       / showing_helper). No existing rows change (all members are owner_admin);
--       there is no invite flow yet, so this just lets the column hold the value
--       once helpers ship. The app-side capability matrix is lib/roles.ts.
--   C7  book_public_showing only advanced the lead from new/replied/contacted, so
--       a lead in another state that rebooks got a showing but its card may not
--       reflect "booked". Broaden the source states (without regressing a lead
--       that is already past booking in the funnel).
--
-- Additive + idempotent. Run once after 0023. No new GRANT (feedback + memberships
-- already granted in 0001; the RPCs keep their existing anon/authenticated grants).

-- ---------------------------------------------------------------------------
-- C5a) De-duplicate any existing feedback (keep the earliest row per showing)
--      before adding the unique constraint. A no-op on a clean DB; defensive so
--      the constraint can always be added.
-- ---------------------------------------------------------------------------
delete from public.feedback f
using public.feedback keep
where f.showing_id is not null
  and f.showing_id = keep.showing_id
  and (
    f.created_at > keep.created_at
    or (f.created_at = keep.created_at and f.id > keep.id)
  );

-- C5b) One feedback row per showing. showing_id is nullable (multiple NULLs stay
--      distinct in Postgres), which is fine: the public RPC always inserts a
--      non-null showing_id, so this prevents the real double-submit duplicate.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'feedback_showing_id_key'
  ) then
    alter table public.feedback
      add constraint feedback_showing_id_key unique (showing_id);
  end if;
end$$;

-- C5c) submit_public_feedback: keep the fast pre-check (friendly path) AND catch
--      unique_violation so a true double-submit race resolves to "already
--      submitted" instead of a 500. Body is the 0009 version with an added
--      exception handler; signature + return shape unchanged.
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
    -- Already have feedback for this showing: treat as a benign no-op so the
    -- renter sees the friendly "thanks" state, not an error.
    return jsonb_build_object('ok', true, 'org_name', v_org_name, 'already', true);
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
                 then ' - "' || btrim(p_comments) || '"'
                 else '' end);
  end if;

  return jsonb_build_object('ok', true, 'org_name', v_org_name);
exception
  -- Two submissions raced past the pre-check: the unique constraint caught the
  -- loser. Resolve it to the same benign "already submitted" state.
  when unique_violation then
    return jsonb_build_object('ok', true, 'org_name', v_org_name, 'already', true);
end;
$$;

grant execute on function public.submit_public_feedback(uuid, integer, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- memberships.role: allow the third seat 'showing_helper' (locked MVP seat
-- model). Default stays 'operator'; create_organization still makes the creator
-- 'owner_admin'. Existing rows are all owner_admin so the re-add validates.
-- ---------------------------------------------------------------------------
alter table public.memberships
  drop constraint if exists memberships_role_check;
alter table public.memberships
  add constraint memberships_role_check
  check (role in ('owner_admin', 'operator', 'showing_helper'));

-- ---------------------------------------------------------------------------
-- C7) book_public_showing: broaden the lead-status advance. Previously only
--     new/replied/contacted advanced to 'booked'; a lead that had been marked
--     'lost' and then rebooks (or any state at-or-before 'booked') now reflects
--     'booked'. We deliberately do NOT touch leads already past booking in the
--     funnel (showed/applied/leased), so a rebooking never regresses real
--     progress. Body is the 0023 version with that single WHERE change; the
--     unique_violation -> 'That time was just taken' handler is preserved (the
--     S202 booking-race UX depends on it). Signature + return shape unchanged.
-- ---------------------------------------------------------------------------
create or replace function public.book_public_showing(
  p_lead_id     uuid,
  p_property_id uuid,
  p_slot        timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org          uuid;
  v_show         uuid;
  v_addr         text;
  v_tz           text;
  v_org_name     text;
  v_brand        text;
  v_logo         text;
  v_reply_to     text;
  v_sms_enabled  boolean;
  v_renter_name  text;
  v_renter_email text;
  v_renter_phone text;
  v_sms_opt_out  boolean;
begin
  -- The unit must still be live (closes the lease-mid-inquiry edge case).
  if not exists (
    select 1 from public.properties
    where id = p_property_id and status = 'available'
  ) then
    raise exception 'Listing not available';
  end if;

  -- Lead must belong to the property's org and be freshly created.
  select l.organization_id, l.name, l.email, l.phone, l.sms_opt_out
    into v_org, v_renter_name, v_renter_email, v_renter_phone, v_sms_opt_out
  from public.leads l
  where l.id = p_lead_id
    and l.property_id = p_property_id
    and l.created_at > now() - interval '15 minutes';

  if v_org is null then
    raise exception 'Booking not allowed';
  end if;

  if p_slot <= now() then
    raise exception 'Slot is in the past';
  end if;

  insert into public.showings
    (organization_id, lead_id, property_id, scheduled_at, outcome)
  values
    (v_org, p_lead_id, p_property_id, p_slot, 'scheduled')
  returning id into v_show;

  -- Advance the lead to booked. Broadened (C7): any state at-or-before booking,
  -- plus a re-engaged 'lost' lead. Leaves showed/applied/leased untouched so a
  -- rebooking never regresses real funnel progress.
  update public.leads
     set status = 'booked'
   where id = p_lead_id
     and status in ('new', 'replied', 'contacted', 'booked', 'lost');

  insert into public.messages
    (organization_id, lead_id, channel, direction, body)
  values
    (v_org, p_lead_id, 'note', 'inbound',
     'Showing booked via the public listing page for '
       || to_char(p_slot at time zone 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC');

  select p.address, o.name, o.brand_color, o.logo_url, o.booking_timezone,
         o.reply_to_email, o.sms_enabled
    into v_addr, v_org_name, v_brand, v_logo, v_tz, v_reply_to, v_sms_enabled
  from public.properties p
  join public.organizations o on o.id = p.organization_id
  where p.id = p_property_id;

  return jsonb_build_object(
    'showing_id',       v_show,
    'scheduled_at',     p_slot,
    'timezone',         v_tz,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'logo_url',         v_logo,
    'reply_to_email',   v_reply_to,
    'sms_enabled',      coalesce(v_sms_enabled, false),
    'sms_opt_out',      coalesce(v_sms_opt_out, false),
    'property_address', v_addr,
    'renter_name',      v_renter_name,
    'renter_email',     v_renter_email,
    'renter_phone',     v_renter_phone
  );
exception
  when unique_violation then
    raise exception 'That time was just taken';
end;
$$;

grant execute on function public.book_public_showing(uuid, uuid, timestamptz)
  to anon, authenticated;
