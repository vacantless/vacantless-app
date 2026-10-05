-- 0228_cancelled_showing_returns_lead.sql
-- S700 (2026-10-05). A cancelled viewing must not leave the renter filed as handled.
--
-- Before this, every cancel path (the renter's one-tap cancel RPC, the operator's
-- outcome select, auto-release of an unconfirmed viewing, archiving a unit) set
-- showings.outcome = 'cancelled' and left the lead at 'booked'. 'booked' is the
-- stage that means "taken care of", so the renter dropped out of every worklist.
-- PROD had 51 such leads on 2026-10-05 (DECISION-S697 blocker 1).
--
-- Rule: when a showing becomes cancelled, and its lead is still 'booked', and the
-- lead has no OTHER showing still scheduled, move the lead to 'contacted' (the
-- "In conversation" bucket) and set a follow-up for today in the org's timezone,
-- so it surfaces as needing a rebook. A note is added only if none is set, so an
-- operator's own next-step note is never overwritten.
--
-- Done as a trigger, not app code, so every cancel path is covered, including the
-- SECURITY DEFINER RPC the renter's cancel link calls. Additive and idempotent.

create or replace function public.lead_back_to_worklist_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz text;
begin
  if new.lead_id is null then
    return new;
  end if;

  select coalesce(o.booking_timezone, 'America/Toronto')
    into v_tz
    from public.organizations o
   where o.id = new.organization_id;

  update public.leads l
     set status = 'contacted',
         next_action_at = (now() at time zone coalesce(v_tz, 'America/Toronto'))::date,
         next_action_note = coalesce(nullif(l.next_action_note, ''), 'Viewing cancelled: offer a new time')
   where l.id = new.lead_id
     and l.status = 'booked'
     and not exists (
       select 1 from public.showings s
        where s.lead_id = new.lead_id
          and s.id <> new.id
          and s.outcome = 'scheduled'
     );

  return new;
end;
$$;

drop trigger if exists trg_lead_back_to_worklist_on_cancel on public.showings;
create trigger trg_lead_back_to_worklist_on_cancel
  after update of outcome on public.showings
  for each row
  when (new.outcome = 'cancelled' and old.outcome is distinct from 'cancelled')
  execute function public.lead_back_to_worklist_on_cancel();

-- One-time repair of the leads already buried. Every one moves to 'contacted'.
-- Only those whose cancelled viewing was in the last 21 days get a follow-up date,
-- so months-old renters do not flood today's worklist; older ones are findable
-- under In conversation without demanding action.
with buried as (
  select l.id,
         max(s.scheduled_at) as last_cancelled_at,
         coalesce(max(o.booking_timezone), 'America/Toronto') as tz
    from public.leads l
    join public.showings s on s.lead_id = l.id and s.outcome = 'cancelled'
    join public.organizations o on o.id = l.organization_id
   where l.status = 'booked'
     and not exists (
       select 1 from public.showings s2
        where s2.lead_id = l.id and s2.outcome = 'scheduled'
     )
   group by l.id
)
update public.leads l
   set status = 'contacted',
       next_action_at = case
         when b.last_cancelled_at > now() - interval '21 days'
           then (now() at time zone b.tz)::date
         else l.next_action_at
       end,
       next_action_note = case
         when b.last_cancelled_at > now() - interval '21 days'
           then coalesce(nullif(l.next_action_note, ''), 'Viewing cancelled: offer a new time')
         else l.next_action_note
       end
  from buried b
 where l.id = b.id;
