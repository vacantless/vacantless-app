-- S729: "Can't make it" on the agent's no-login viewings page.
-- The agent hands an upcoming viewing back: it becomes unassigned (so the
-- landlord's Viewings page shows it under "Assign unassigned viewings"), an
-- agent's own confirmation is cleared (a renter's confirmation stands), and a
-- note goes on the renter's timeline. The renter is NOT contacted; the viewing
-- keeps its time. Same SECURITY DEFINER token pattern as 0118: the token is
-- the only handle and only a viewing assigned to that agent can be released.
create or replace function public.release_showing_from_agent_token(
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

  select * into v_agent
  from public.showing_agents
  where agent_token = p_agent_token
    and archived = false;
  if v_agent.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_showing
  from public.showings
  where id = p_showing_id
    and assigned_agent_id = v_agent.id
    and organization_id = v_agent.organization_id
  for update;
  if v_showing.id is null then
    -- Already handed back (a second tap) or never theirs: nothing to do.
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_showing.outcome is not null and v_showing.outcome <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  if v_showing.scheduled_at is not null and v_showing.scheduled_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'past');
  end if;

  update public.showings
     set assigned_agent_id = null,
         confirmed_at = case when confirmed_by = 'agent' then null else confirmed_at end,
         confirmed_by = case when confirmed_by = 'agent' then null else confirmed_by end
   where id = v_showing.id;

  if v_showing.lead_id is not null then
    insert into public.messages (organization_id, lead_id, channel, direction, body)
    values (v_showing.organization_id, v_showing.lead_id, 'note', 'outbound',
            v_agent.name || ' can''t make this viewing and handed it back. It needs someone to run it.');
  end if;

  return jsonb_build_object('ok', true, 'agent_name', v_agent.name,
                            'organization_id', v_showing.organization_id,
                            'lead_id', v_showing.lead_id,
                            'property_id', v_showing.property_id,
                            'scheduled_at', v_showing.scheduled_at);
end;
$$;

revoke all on function public.release_showing_from_agent_token(uuid, uuid) from public;
grant execute on function public.release_showing_from_agent_token(uuid, uuid) to anon, authenticated;
