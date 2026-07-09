-- ============================================================================
-- 0114_showing_agent_same_org — enforce same-org showing<->agent assignment
-- (S436 Codex P1 fold).
--
-- 0113 added showings.assigned_agent_id as a SIMPLE FK to showing_agents(id). RLS
-- scopes both tables to user_org_ids(), which for a multi-org member (or a future
-- service_role writer) allows storing an Org A showing pointing at an Org B agent -
-- then the hand-off email would carry Org A's renter/property to Org B's external
-- agent. The app is one-org-per-user today so this is defense-in-depth, but the
-- DB should enforce the invariant regardless of the writer.
--
-- A composite FK (assigned_agent_id, organization_id) -> showing_agents(id,
-- organization_id) can't be used with ON DELETE SET NULL: it would try to null the
-- NOT NULL showings.organization_id when an agent is deleted. So we enforce the
-- pairing with a BEFORE trigger instead, and keep 0113's simple FK for the
-- set-null-on-delete behavior.
--
-- SECURITY DEFINER + fixed search_path so the existence check always sees the
-- agent row regardless of the caller's RLS (a false negative would wrongly block a
-- legitimate same-org assignment).
-- ============================================================================

create or replace function public.enforce_showing_agent_same_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_agent_id is not null then
    if not exists (
      select 1
      from public.showing_agents sa
      where sa.id = new.assigned_agent_id
        and sa.organization_id = new.organization_id
    ) then
      raise exception
        'showing_agents assignment cross-org: agent % is not in organization %',
        new.assigned_agent_id, new.organization_id
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists showings_agent_same_org on public.showings;
create trigger showings_agent_same_org
  before insert or update of assigned_agent_id on public.showings
  for each row
  execute function public.enforce_showing_agent_same_org();
