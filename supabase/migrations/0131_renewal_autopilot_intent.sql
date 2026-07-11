-- ============================================================================
-- 0131_renewal_autopilot_intent — renewal & rent-increase autopilot Slice A (S460).
--
-- The "handle my renewal & increase" opt-in + the tenant stay/leave check-in.
-- A landlord toggles renewal_autopilot ON once per lease; ~90 days before the
-- lease's completion the autopilot asks the tenant "staying or leaving?" via an
-- org-branded /renewal/[token] page (no login), and branches: staying/unsure ->
-- proceed to the annual rent increase; leaving -> hand off to turnover.
--
-- Columns (all on tenancies, all additive + nullable/defaulted):
--   * renewal_autopilot           — the opt-in-once toggle (default false).
--   * renewal_intent              — the tenant's answer (staying/leaving/unsure).
--   * renewal_intent_at           — when they answered.
--   * renewal_intent_requested_at — when the landlord asked (idempotency/UX).
--   * renewal_intent_token        — the anon capture credential (like report_token,
--                                   S? — unguessable per-row uuid). NOT NULL with a
--                                   volatile default, so adding the column stamps a
--                                   DISTINCT uuid on every existing row.
--
-- PII posture: the tenant records ONE enum choice. NO name/DL/SIN/credit/bank
-- data ever lands through this path (KI715/725). The token is the only handle;
-- a wrong token records nothing and reveals nothing.
--
-- All additive; ships inert (no behaviour until a landlord opts in + asks).
-- Reversible (drop the columns + the function).
-- ============================================================================

alter table public.tenancies
  add column if not exists renewal_autopilot boolean not null default false,
  add column if not exists renewal_intent text
    check (renewal_intent is null or renewal_intent in ('staying','leaving','unsure')),
  add column if not exists renewal_intent_at timestamptz,
  add column if not exists renewal_intent_requested_at timestamptz,
  add column if not exists renewal_intent_token uuid not null default gen_random_uuid();

create index if not exists tenancies_renewal_intent_token_idx
  on public.tenancies(renewal_intent_token);

comment on column public.tenancies.renewal_autopilot is
  'Opt-in-once toggle: when true the renewal & rent-increase autopilot runs the annual check-in -> serve -> file -> apply cycle for this lease (S460).';
comment on column public.tenancies.renewal_intent is
  'Tenant''s stay/leave answer to the renewal check-in: staying | leaving | unsure. NULL = not yet asked/answered.';
comment on column public.tenancies.renewal_intent_token is
  'Unguessable anon credential for the /renewal/[token] tenant check-in page. The token is the only handle; a wrong token records nothing.';

-- ---------------------------------------------------------------------------
-- Public check-in RPC. Anon-safe: resolves the tenancy from the token
-- server-side, accepts only the three enum choices, and writes ONLY the choice
-- + timestamp. Mirrors record_showing_outcome_from_agent_token (0120) /
-- join_waitlist (0128): the token is the credential, anon gets NO table grant,
-- and no PII crosses the boundary. Idempotent-friendly: the latest genuine
-- answer wins (a tenant may correct themselves), and the timestamp re-stamps.
-- Returns the recorded choice, or an {ok:false, reason} the caller maps to a
-- soft page state — never an error the tenant sees as a crash.
-- ---------------------------------------------------------------------------
create or replace function public.record_renewal_intent(
  p_token  uuid,
  p_choice text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'bad_input');
  end if;

  -- Only the three real answers; anything else bounces without a write.
  if p_choice is null or p_choice not in ('staying','leaving','unsure') then
    return jsonb_build_object('ok', false, 'reason', 'bad_choice');
  end if;

  -- Resolve the tenancy from the token. Only an ACTIVE tenancy accepts an
  -- answer (a check-in on an ended lease is meaningless); a wrong/stale token
  -- simply finds nothing.
  select * into v_tenancy
  from public.tenancies
  where renewal_intent_token = p_token
    and status = 'active'
  for update;
  if v_tenancy.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  update public.tenancies
     set renewal_intent = p_choice,
         renewal_intent_at = now(),
         updated_at = now()
   where id = v_tenancy.id;

  return jsonb_build_object('ok', true, 'choice', p_choice);
end;
$$;

grant execute on function public.record_renewal_intent(uuid, text)
  to anon, authenticated;
