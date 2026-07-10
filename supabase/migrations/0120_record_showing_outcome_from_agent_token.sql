-- ============================================================================
-- 0120_record_showing_outcome_from_agent_token — agent one-tap outcome, S445.
--
-- The /agent/[token] shared-calendar page (0117 agent_token) is the covering
-- agent's only handle — no login. 0118 let them CONFIRM a viewing before it
-- happens; this RPC lets them record what actually HAPPENED after it, in one tap:
-- "Renter showed" (attended) or "No-show". Capturing the outcome at the agent who
-- was on-site closes the loop the operator-targeted nudge (S392) couldn't — the
-- operator often doesn't know whether the renter showed; the agent does.
--
-- SECURITY DEFINER, keyed on BOTH the agent's token AND the specific showing id,
-- re-deriving the agent + org server-side and recording ONLY a showing actually
-- assigned to THAT agent. Replays the lead-side effects of the authenticated
-- updateShowingOutcome / record_showing_outcome_from_token (0098):
--   - set showings.outcome
--   - on 'attended', advance the lead to 'showed' (from new/replied/contacted/booked)
--   - log a 'Viewing marked X by <agent>.' note to the lead timeline
-- Guards:
--   - token must resolve to a live (non-archived) agent          → not_found
--   - showing must be assigned to that agent, same org           → not_found
--   - outcome must be one the agent can report on-site           → bad_outcome
--     (attended / no_show only; a cancellation is an operator/renter action
--      BEFORE the viewing, never an on-site report)
--   - the viewing must still be OPEN (null / 'scheduled')        → already
--     (a second tap, or a viewing already closed by the operator, is a no-op
--      success so a double-tap never surprises or flip-flops the record)
--   - the viewing time must have passed (scheduled_at <= now)    → too_early
--     (defense in depth; the page hides these buttons until then)
-- Granted to anon (the page has no session); the token is the credential and a
-- wrong token records nothing. Mirrors 0118 + 0098 and the 0056/0066 anon
-- SECURITY DEFINER precedent (feedback_anon_rpc_revalidate_server_side). No RLS
-- change. Reversible (drop function).
-- ============================================================================

create or replace function public.record_showing_outcome_from_agent_token(
  p_agent_token uuid,
  p_showing_id  uuid,
  p_outcome     text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent   public.showing_agents%rowtype;
  v_showing public.showings%rowtype;
  v_label   text;
begin
  if p_agent_token is null or p_showing_id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  -- The agent reports one of the two on-site realities. A cancellation is a
  -- pre-viewing operator/renter action, never something the covering agent files
  -- from the doorstep, so it is intentionally NOT accepted here.
  if p_outcome is null or p_outcome not in ('attended','no_show') then
    return jsonb_build_object('ok', false, 'reason', 'bad_outcome');
  end if;

  -- Resolve the agent from the token; an archived agent's link is revoked.
  select * into v_agent
  from public.showing_agents
  where agent_token = p_agent_token
    and archived = false;
  if v_agent.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Load the showing ONLY if it is assigned to this agent, in this agent's org.
  select * into v_showing
  from public.showings
  where id = p_showing_id
    and assigned_agent_id = v_agent.id
    and organization_id = v_agent.organization_id
  for update;
  if v_showing.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Only an OPEN viewing can be recorded. A viewing already closed (by a prior tap,
  -- by the operator's own outcome entry, or by a cancellation) is a no-op success
  -- so a double-tap never overwrites or flip-flops a recorded result.
  if v_showing.outcome is not null and v_showing.outcome <> 'scheduled' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  -- Defense in depth (Codex S445 P2): an outcome can only be recorded once the
  -- viewing time has passed. The page hides these buttons until scheduled_at <= now,
  -- but the token RPC is the source of truth, so a hand-posted request for a future
  -- (or unscheduled) viewing must be rejected here too.
  if v_showing.scheduled_at is null or v_showing.scheduled_at > now() then
    return jsonb_build_object('ok', false, 'reason', 'too_early');
  end if;

  update public.showings
     set outcome = p_outcome
   where id = v_showing.id;

  if v_showing.lead_id is not null then
    -- attended advances the lead to 'showed' from the allowed prior stages only;
    -- a no-show never advances the lead.
    if p_outcome = 'attended' then
      update public.leads
         set status = 'showed'
       where id = v_showing.lead_id
         and status in ('new','replied','contacted','booked');
    end if;

    v_label := case p_outcome when 'attended' then 'Attended' else 'No-show' end;

    insert into public.messages (organization_id, lead_id, channel, direction, body)
    values (v_showing.organization_id, v_showing.lead_id, 'note', 'outbound',
            'Viewing marked ' || v_label || ' by ' || v_agent.name || '.');
  end if;

  return jsonb_build_object('ok', true, 'outcome', p_outcome);
end;
$$;

grant execute on function public.record_showing_outcome_from_agent_token(uuid, uuid, text)
  to anon, authenticated;
