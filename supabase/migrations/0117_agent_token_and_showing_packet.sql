-- ============================================================================
-- 0117_agent_token_and_showing_packet — showing routing Slice 3 schema (S440).
--
-- WHY (dogfood, Noam 2026-07-09): "when a showing agent takes over for you this
-- would essentially help with the handoff." Slice 1/2 gave the org a roster and a
-- confirmation trail the LEAD AGENT records on the agent's behalf (account-less
-- agents). Slice 3 hands the confirmation — and the whole showing packet — to the
-- covering agent directly, via a tokenized /agent/[token] shared calendar (the
-- get_dispatch_context/0065 magic-link pattern the 0113 header anticipated). No
-- login: the token IS the handle.
--
-- Three additive, live-safe columns:
--
-- 1. showing_agents.agent_token — a STABLE per-agent uuid. The agent's personal
--    link (/agent/[token]) lists ALL their upcoming assigned viewings = the
--    "shared calendar". Stable (not per-showing) so one link keeps working as new
--    viewings are routed to them. NOT NULL DEFAULT gen_random_uuid() backfills
--    each existing agent with its own distinct token; UNIQUE so a token resolves
--    to exactly one agent (it is the credential).
--
-- 2. properties.showing_instructions — free-text access/showing notes (where the
--    lockbox is, buzzer code, parking, "text before arriving", etc.) that the
--    packet carries to the covering agent. Free-text on purpose: no structured
--    access-code vault (an operator includes whatever they choose, at their
--    discretion). NULL = none.
--
-- 3. showings.confirmation_nudge_sent_at — the once-per-showing stamp for the
--    pre-showing "still unconfirmed" nudge cron (mirrors outcome_nudge_sent_at
--    from 0097). NULL = not yet nudged.
--
-- No new RLS surface for the agent columns: showing_agents/properties keep their
-- existing per-org policies; the token is read only through the SECURITY DEFINER
-- path in 0118. Reversible (drop the columns).
-- ============================================================================

-- 1. Per-agent stable token for the /agent/[token] shared calendar.
alter table public.showing_agents
  add column if not exists agent_token uuid not null default gen_random_uuid();

create unique index if not exists showing_agents_agent_token_key
  on public.showing_agents(agent_token);

-- 2. Per-property showing/access instructions carried in the handoff packet.
alter table public.properties
  add column if not exists showing_instructions text;

-- 3. Once-per-showing stamp for the pre-showing unconfirmed nudge.
alter table public.showings
  add column if not exists confirmation_nudge_sent_at timestamptz;
