-- 0109_showing_cancel_terminal_guard.sql
-- S419 - fix the S418 public cancel RPC (Codex P2 on cdc1c9e).
--
-- Problem: cancel_showing_from_token only treated outcome='cancelled' as the
-- idempotent case. ANY other current outcome fell into the else branch and was
-- OVERWRITTEN to 'cancelled'. So a renter who taps a STALE "Cancel this viewing"
-- link AFTER an operator has already recorded 'attended' or 'no_show' would:
--   (1) corrupt the showing history (attended/no_show -> cancelled),
--   (2) log a spurious "cancelled by the renter" note, and
--   (3) fire a fresh leasing.showing_cancelled operator notification.
--
-- Fix: only a still-open showing (outcome null or 'scheduled') is cancellable.
-- Terminal outcomes ('attended','no_show') are left UNTOUCHED and reported back
-- with state='closed' so the confirm page renders a non-cancellable state and the
-- server action does NOT notify. An already-'cancelled' showing stays the
-- idempotent no-op (state='already_cancelled'). Only a fresh cancellation
-- (state='cancelled_now') mutates the row, logs the note, and is allowed to fire
-- the operator notification.
--
-- Backward-compatible return shape (so applying this migration BEFORE the code
-- deploy can never corrupt data): `ok` + `already` are still returned with their
-- old meaning, and a new `state` field carries the precise case. Under the OLD
-- deployed action a 'closed' result comes back ok=false, so it redirects to a
-- generic error and does NOT overwrite or notify - safe, just cosmetically wrong
-- until the S419 code ships. The row is SELECT ... FOR UPDATE locked, so the
-- branch and the guarded UPDATE cannot race.
--
-- Only cancel_showing_from_token changes here; book_public_showing (0108) and the
-- cancel_token column are untouched. Reversible (re-run 0108's definition to roll
-- back).

create or replace function public.cancel_showing_from_token(
  p_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_showing public.showings%rowtype;
  v_org_name  text;
  v_addr      text;
  v_tz        text;
  v_lead_name text;
  v_state     text;
  v_ok        boolean := true;
  v_already   boolean := false;
begin
  select * into v_showing
  from public.showings
  where cancel_token = p_token
  for update;
  if v_showing.id is null then
    return jsonb_build_object('ok', false, 'state', 'not_found', 'reason', 'not_found');
  end if;

  if v_showing.outcome = 'cancelled' then
    -- Already cancelled -> idempotent no-op. Flag it so the caller does not fire
    -- a second operator notification for the same cancellation.
    v_state   := 'already_cancelled';
    v_already := true;
  elsif v_showing.outcome in ('attended', 'no_show') then
    -- Terminal, operator-recorded outcome. Do NOT overwrite it. Report closed so
    -- the page shows a non-cancellable state and the caller stays silent. ok is
    -- false so the OLD deployed action also declines (no notify), never corrupts.
    v_state := 'closed';
    v_ok    := false;
  else
    -- Open showing (outcome null or 'scheduled') -> the only cancellable case.
    -- Guard the UPDATE to the open state too (belt and suspenders under the lock).
    update public.showings
       set outcome = 'cancelled'
     where id = v_showing.id
       and (outcome is null or outcome = 'scheduled');

    if v_showing.lead_id is not null then
      insert into public.messages (organization_id, lead_id, channel, direction, body)
      values (v_showing.organization_id, v_showing.lead_id, 'note', 'inbound',
              'Viewing cancelled by the renter via the confirmation email link.');
    end if;

    v_state := 'cancelled_now';
  end if;

  -- Context for the confirm page + the operator notification.
  select o.name, o.booking_timezone, p.address
    into v_org_name, v_tz, v_addr
  from public.organizations o
  left join public.properties p on p.id = v_showing.property_id
  where o.id = v_showing.organization_id;

  if v_showing.lead_id is not null then
    select l.name into v_lead_name from public.leads l where l.id = v_showing.lead_id;
  end if;

  return jsonb_build_object(
    'ok',               v_ok,
    'state',            v_state,
    'already',          v_already,
    'organization_id',  v_showing.organization_id,
    'lead_id',          v_showing.lead_id,
    'property_id',      v_showing.property_id,
    'lead_name',        v_lead_name,
    'org_name',         v_org_name,
    'property_address', v_addr,
    'scheduled_at',     v_showing.scheduled_at,
    'timezone',         v_tz
  );
end;
$$;

grant execute on function public.cancel_showing_from_token(uuid)
  to anon, authenticated;
