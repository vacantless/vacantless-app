-- ============================================================================
-- 0118_confirm_showing_from_token — agent self-confirm RPC, Slice 3 (S440).
--
-- The /agent/[token] shared-calendar page (0117 agent_token) is UNAUTHENTICATED:
-- the covering agent has no login, the token is the only handle. This RPC is how
-- a Confirm tap on that page records the confirmation. SECURITY DEFINER, keyed on
-- BOTH the agent's token AND the specific showing id, re-deriving the agent + org
-- server-side and confirming ONLY a showing that is actually assigned to THAT
-- agent. It replays the effect of the authenticated setShowingConfirmed
-- (app/dashboard/showings/actions.ts) for the 'agent' path reserved in 0115:
--   - set confirmed_at = now(), confirmed_by = 'agent'
--   - log a 'Viewing confirmed with the renter by <agent> (self-confirmed).' note
-- Guards, mirroring the pure canConfirmShowing / deriveCoordinationStatus state:
--   - token must resolve to a live (non-archived) agent          → not_found
--   - showing must be assigned to that agent, same org           → not_found
--   - outcome must be open (null / 'scheduled')                  → closed
--   - already confirmed                                          → ok (idempotent)
-- Granted to anon (the page has no session); a wrong/garbage token confirms
-- nothing. Mirrors record_showing_outcome_from_token (0098) and the 0056/0066
-- anon SECURITY DEFINER precedent (feedback_anon_rpc_revalidate_server_side).
-- No RLS change. Reversible.
-- ============================================================================

create or replace function public.confirm_showing_from_token(
  p_agent_token uuid,
  p_showing_id  uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent   public.showing_agents%rowtype;
  v_showing public.showings%rowtype;
begin
  if p_agent_token is null or p_showing_id is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  -- Resolve the agent from the token. Archived agents can't act (their link is
  -- effectively revoked once you archive them).
  select * into v_agent
  from public.showing_agents
  where agent_token = p_agent_token
    and archived = false;
  if v_agent.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Load the showing ONLY if it is assigned to this agent, in this agent's org.
  -- An agent can never confirm a viewing that isn't theirs.
  select * into v_showing
  from public.showings
  where id = p_showing_id
    and assigned_agent_id = v_agent.id
    and organization_id = v_agent.organization_id
  for update;
  if v_showing.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Coordination must be open: a cancelled / attended / no_show viewing is closed.
  if v_showing.outcome is not null and v_showing.outcome <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- Idempotent: a second tap on an already-confirmed viewing is a no-op success.
  if v_showing.confirmed_at is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  update public.showings
     set confirmed_at = now(),
         confirmed_by = 'agent'
   where id = v_showing.id;

  if v_showing.lead_id is not null then
    insert into public.messages (organization_id, lead_id, channel, direction, body)
    values (v_showing.organization_id, v_showing.lead_id, 'note', 'outbound',
            'Viewing confirmed with the renter by ' || v_agent.name || ' (self-confirmed).');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.confirm_showing_from_token(uuid, uuid)
  to anon, authenticated;
