-- 0098_record_showing_outcome_from_token.sql
-- S392, Slice 2: the one-tap surface RPC for the post-showing outcome nudge.
--
-- Slice 1 (0097) added showings.outcome_token + outcome_nudge_sent_at. The nudge
-- email (Slice 3 cron) links the operator to /app/showing/[token], an
-- UNAUTHENTICATED page whose only handle is the token. This RPC is how that page
-- records the outcome: SECURITY DEFINER, keyed on the token, re-derives the
-- showing + org SERVER-SIDE and replays the EXACT post-logic of the authenticated
-- updateShowingOutcome (app/dashboard/showings/actions.ts):
--   - set showings.outcome
--   - on 'attended', advance the lead to 'showed' (only from new/replied/contacted/booked)
--   - log a 'Viewing marked X.' note to the lead timeline
-- It is idempotent (a second tap just overwrites the outcome — harmless) and
-- accepts ONLY the three real outcomes the page offers (attended / no_show /
-- cancelled) — never the 'scheduled' placeholder. Granted to anon (the page has no
-- session); the token is the credential and a wrong token reveals nothing.
-- Mirrors the 0056/0066 SECURITY DEFINER anon-RPC precedent
-- (feedback_anon_rpc_revalidate_server_side). No RLS change. Reversible.

create or replace function public.record_showing_outcome_from_token(
  p_token   uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_showing public.showings%rowtype;
  v_label   text;
begin
  -- Only the three real outcomes the one-tap page offers. 'scheduled' is the
  -- not-recorded placeholder and is never a valid record-from-token value.
  if p_outcome is null or p_outcome not in ('attended','no_show','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'bad_outcome');
  end if;

  select * into v_showing
  from public.showings
  where outcome_token = p_token
  for update;
  if v_showing.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.showings
     set outcome = p_outcome
   where id = v_showing.id;

  -- Replay updateShowingOutcome's lead-side effects (only when the showing is
  -- tied to a lead; ad-hoc showings just set the outcome).
  if v_showing.lead_id is not null then
    -- attended advances the lead to 'showed' from the allowed prior stages only.
    if p_outcome = 'attended' then
      update public.leads
         set status = 'showed'
       where id = v_showing.lead_id
         and status in ('new','replied','contacted','booked');
    end if;

    v_label := case p_outcome
      when 'attended'  then 'Attended'
      when 'no_show'   then 'No-show'
      when 'cancelled' then 'Cancelled'
      else p_outcome
    end;

    insert into public.messages (organization_id, lead_id, channel, direction, body)
    values (v_showing.organization_id, v_showing.lead_id, 'note', 'outbound',
            'Viewing marked ' || v_label || '.');
  end if;

  return jsonb_build_object('ok', true, 'outcome', p_outcome);
end;
$$;

grant execute on function public.record_showing_outcome_from_token(uuid, text)
  to anon, authenticated;
