-- 0119_auto_assign_agents.sql (S443 — full auto-assign at booking time)
--
-- Opt-in flag: when true, a viewing a renter self-books online is automatically
-- routed to the load-balanced showing agent (the same pick the manual "Assign
-- {name}" assist suggests), the agent gets the leasing.showing_assigned hand-off
-- email, and it's logged to the lead timeline. Auto-assign respects each agent's
-- weekly_capacity — if every active agent is at capacity (or the roster is
-- empty), the viewing stays unassigned for manual routing rather than piling
-- onto a full agent.
--
-- Ships DARK: NOT NULL DEFAULT false, so every existing org (including Agile)
-- is unaffected until an operator turns it on from the Showing agents page. The
-- ranking + capacity logic lives in the pure lib/showing-agents.ts; this flag
-- only decides whether the booking action runs it. No new table, no RPC change.

alter table public.organizations
  add column if not exists auto_assign_agents boolean not null default false;

comment on column public.organizations.auto_assign_agents is
  'S443: when true, self-booked viewings are auto-routed to the load-balanced '
  'showing agent (respects weekly_capacity; no-op when the roster is empty or '
  'all agents are full). Default false = dark.';
