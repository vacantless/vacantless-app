-- ============================================================================
-- 0065_work_order_dispatches — in-app tokenized TRADE dispatch
-- (Option B incident-dispatch, Slice 5 — see
--  OPTION-B-INCIDENT-DISPATCH-SLICE-PLAN-2026-06-23.md §3.3, §4, §5, §6).
--
-- THE GUARDRAIL AMENDMENT. Slices 1-4 reached the "Option A ceiling": a tenant
-- self-reports, the operator triages into a work order, enters a quote/timeline,
-- and communicates it. Through all of that Vacantless stayed a record-keeper /
-- communicator — it never reached out to a trade. This slice is the deliberate,
-- Noam-authorized scope expansion (S313): the operator can DISPATCH a work order
-- to one of their own trades, and the trade can ACCEPT / DECLINE / QUOTE / propose
-- a date — all in-app, two-way. The owner still approves the quote and still pays
-- the trade DIRECTLY, off-platform. **No money ever moves through Vacantless.**
-- The quote is a recorded/communicated NUMBER, exactly like work_orders.quote_cents.
--
-- Identity model (plan §2, §4 — LOCKED token-first): the trade is account-less,
-- the same call made for tenants in 0061. The ONLY thing the trade holds is the
-- dispatch's single-purpose `trade_access_token`. Every read and write from the
-- trade side is a SECURITY DEFINER RPC that RE-DERIVES the dispatch / org / work
-- order FROM THE TOKEN, re-checks the state machine in SQL, and trusts nothing
-- else the client sends (feedback_anon_rpc_revalidate_server_side). This mirrors
-- the proven /sign (0040) and /report (0061) rails. Persistent trade Supabase-Auth
-- accounts are DEFERRED to Slice 7, demand-gated — tokens carry us until then.
--   Difference from the report token: a tenancy report token is STABLE+reusable;
--   a dispatch token is SINGLE-JOB (one work order, one trade) and EXPIRES.
--
-- The OPERATOR side (create the dispatch, approve the quote + schedule, cancel,
-- mark complete) is NOT a token RPC — the operator is an authenticated member, so
-- per-org RLS scopes every statement and the actions use ordinary guarded UPDATEs
-- (the declineIncidentReport pattern: .in('dispatch_status', [...]) + check rows
-- affected). That keeps the ONLY new SECURITY DEFINER surface the four anon token
-- RPCs — the SAME intentional anon-definer WARN class as sign_lease_document /
-- submit_incident_report (no NEW advisor class).
--
-- Conventions mirror 0054 / 0061 / 0064: CHECK (not a pg enum) so adding a state
-- later is a one-line change; per-org RLS gates operators on organization_id in
-- (select public.user_org_ids()); explicit grants because auto-expose is OFF;
-- service_role gets DML so any future cron (token-expiry sweep, transition
-- notifications in Slice 6) doesn't hit the silent permission-denied trap.
--
-- The dispatch_status set + the quote rules are MIRRORED verbatim in
-- lib/work-order-dispatch.ts; the token RPCs re-check them so both sides agree.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- work_order_dispatches — one dispatch attempt of a work order to a trade.
--   Re-dispatch after a decline creates a NEW row; a partial-unique index
--   guarantees at most ONE active dispatch per work order at a time (plan §3.3).
-- ---------------------------------------------------------------------------
create table if not exists public.work_order_dispatches (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null references public.organizations(id) on delete cascade,
  -- the job being dispatched. cascade: a deleted work order takes its dispatch
  -- attempts with it (an in-flight dispatch has no independent meaning).
  work_order_id         uuid not null references public.work_orders(id) on delete cascade,

  -- the trade being dispatched. v1 dispatches to the org's OWN rolodex
  -- (trade_contacts, which carries an email). set-null so archiving/deleting a
  -- vendor never erases the dispatch history. directory_trade_id is reserved for
  -- a future "dispatch straight from the network" path (plan §3.3 "one of") — a
  -- column now, unwired in v1.
  trade_contact_id      uuid references public.trade_contacts(id)  on delete set null,
  directory_trade_id    uuid references public.directory_trades(id) on delete set null,
  -- snapshot of who it went to + where the link was emailed, frozen at dispatch
  -- so the record survives an archived/edited contact.
  trade_name_snapshot   text not null,
  trade_email_snapshot  text,

  -- the two-way state machine (plan §3.3). offered -> accepted -> quoted ->
  -- scheduled -> completed, plus declined (trade) and cancelled (operator).
  -- quote-approval is folded into scheduling: the operator approves a quote BY
  -- confirming a date (minimal-clicks), moving quoted -> scheduled in one step.
  dispatch_status       text not null default 'offered'
                          check (dispatch_status in
                            ('offered','accepted','quoted','scheduled','completed',
                             'declined','cancelled')),

  -- operator's instructions to the trade at dispatch (what + where, the access
  -- detail the operator chooses to share). Free text, optional.
  operator_note         text,
  -- the trade's reason when they decline. Optional.
  decline_reason        text,

  -- the trade's QUOTE — a recorded number for the owner, NOT a charge. Non-negative.
  quote_cents           integer,
  quote_note            text,
  quote_submitted_at    timestamptz,

  -- two-way scheduling. The trade may PROPOSE a date with their quote; the
  -- operator CONFIRMS the agreed date when approving. proposed_by records who
  -- offered the date last.
  proposed_date         date,
  proposed_by           text check (proposed_by in ('trade','operator')),
  scheduled_for         date,
  schedule_confirmed_at timestamptz,
  completed_at          timestamptz,

  -- the magic-link credential for /job/[token] + when it stops working.
  trade_access_token    text not null,
  token_expires_at      timestamptz not null,

  -- timeline
  offered_at            timestamptz not null default now(),
  accepted_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint work_order_dispatches_quote_cents_chk
    check (quote_cents is null or quote_cents >= 0)
);

create index if not exists work_order_dispatches_org_idx
  on public.work_order_dispatches(organization_id);
create index if not exists work_order_dispatches_wo_idx
  on public.work_order_dispatches(work_order_id);
create index if not exists work_order_dispatches_status_idx
  on public.work_order_dispatches(organization_id, dispatch_status);

-- the token is the only lookup key in the RPCs — globally unique.
create unique index if not exists uq_work_order_dispatches_token
  on public.work_order_dispatches(trade_access_token);

-- AT MOST ONE active dispatch per work order (plan §3.3: "only one active at a
-- time"). The terminal states (completed/declined/cancelled) are excluded, so a
-- declined dispatch can be re-dispatched as a fresh row. Partial-unique with an
-- IN predicate.
create unique index if not exists uq_work_order_dispatches_one_active
  on public.work_order_dispatches(work_order_id)
  where dispatch_status in ('offered','accepted','quoted','scheduled');

alter table public.work_order_dispatches enable row level security;

-- Operators: standard per-org policy. Trades NEVER touch this table directly —
-- only through the SECURITY DEFINER token RPCs below.
drop policy if exists work_order_dispatches_all on public.work_order_dispatches;
create policy work_order_dispatches_all on public.work_order_dispatches
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.work_order_dispatches to authenticated;
grant select, insert, update, delete on public.work_order_dispatches to service_role;

-- ---------------------------------------------------------------------------
-- RPC get_dispatch_context — anon-callable read for the /job/[token] page.
--
-- Given a dispatch token, returns everything the trade's job page needs: the job
-- (title/description/category/priority), the address to go to, the current
-- dispatch state + any quote/proposed/scheduled values, the operator's note, and
-- the org brand. SECURITY DEFINER so an account-less trade can read it; it
-- re-derives the org from the token and returns NOTHING about any other dispatch,
-- job, or org. Returns null for an unknown token (the page 404s); for a found but
-- EXPIRED token it returns a minimal { expired:true, org_name, brand_* } so the
-- page can show a friendly "this link has expired" instead of a 404.
-- ---------------------------------------------------------------------------
create or replace function public.get_dispatch_context(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dispatch public.work_order_dispatches%rowtype;
  v_wo       public.work_orders%rowtype;
  v_org_name text;
  v_brand    text;
  v_brand2   text;
  v_logo     text;
  v_address  text;
begin
  if p_token is null or btrim(p_token) = '' then
    return null;
  end if;

  select * into v_dispatch
  from public.work_order_dispatches
  where trade_access_token = p_token;
  if v_dispatch.id is null then
    return null;
  end if;

  select o.name, o.brand_color, o.brand_color_secondary, o.logo_url
    into v_org_name, v_brand, v_brand2, v_logo
  from public.organizations o
  where o.id = v_dispatch.organization_id;

  -- expired link: return only org branding so the page can render a friendly
  -- terminal message (no job detail leaks past expiry).
  if v_dispatch.token_expires_at <= now() then
    return jsonb_build_object(
      'expired',   true,
      'org_name',  v_org_name,
      'brand_color', v_brand,
      'brand_color_secondary', v_brand2,
      'logo_url',  v_logo
    );
  end if;

  select * into v_wo from public.work_orders where id = v_dispatch.work_order_id;

  -- the address to send the trade to: the unit's address, else the building key.
  if v_wo.property_id is not null then
    select p.address into v_address from public.properties p where p.id = v_wo.property_id;
  else
    v_address := v_wo.building_key;
  end if;

  return jsonb_build_object(
    'expired',          false,
    'token',            v_dispatch.trade_access_token,
    'dispatch_status',  v_dispatch.dispatch_status,
    'trade_name',       v_dispatch.trade_name_snapshot,
    'operator_note',    v_dispatch.operator_note,
    'decline_reason',   v_dispatch.decline_reason,
    'quote_cents',      v_dispatch.quote_cents,
    'quote_note',       v_dispatch.quote_note,
    'proposed_date',    v_dispatch.proposed_date,
    'scheduled_for',    v_dispatch.scheduled_for,
    'job_title',        v_wo.title,
    'job_description',  v_wo.description,
    'job_category',     v_wo.category,
    'job_priority',     v_wo.priority,
    'property_address', v_address,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'brand_color_secondary', v_brand2,
    'logo_url',         v_logo
  );
end;
$$;

grant execute on function public.get_dispatch_context(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC accept_dispatch — anon-callable: the trade accepts an OFFERED job.
-- Re-derives the dispatch from the token, re-checks not-expired + status=offered.
-- Returns { ok, reason }.
-- ---------------------------------------------------------------------------
create or replace function public.accept_dispatch(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.work_order_dispatches%rowtype;
begin
  select * into v_dispatch
  from public.work_order_dispatches
  where trade_access_token = p_token
  for update;
  if v_dispatch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_dispatch.token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_dispatch.dispatch_status <> 'offered' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_state');
  end if;

  update public.work_order_dispatches
     set dispatch_status = 'accepted',
         accepted_at = now(),
         updated_at = now()
   where id = v_dispatch.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.accept_dispatch(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC decline_dispatch — anon-callable: the trade declines an OFFERED job.
-- Re-checks not-expired + status=offered, records an optional reason.
-- Returns { ok, reason }.
-- ---------------------------------------------------------------------------
create or replace function public.decline_dispatch(p_token text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.work_order_dispatches%rowtype;
  v_reason   text;
begin
  select * into v_dispatch
  from public.work_order_dispatches
  where trade_access_token = p_token
  for update;
  if v_dispatch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_dispatch.token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_dispatch.dispatch_status <> 'offered' then
    return jsonb_build_object('ok', false, 'reason', 'wrong_state');
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and length(v_reason) > 1000 then
    v_reason := left(v_reason, 1000);
  end if;

  update public.work_order_dispatches
     set dispatch_status = 'declined',
         decline_reason = v_reason,
         updated_at = now()
   where id = v_dispatch.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.decline_dispatch(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC submit_dispatch_quote — anon-callable: the trade submits (or revises) a
-- quote and may propose a date. Allowed while ACCEPTED or QUOTED (revise). The
-- quote is a recorded number (NOT a charge). Re-validates: not-expired, state,
-- quote_cents present + non-negative + within a sane ceiling, note/date bounds.
-- mirrors lib/work-order-dispatch.validateDispatchQuote. Returns { ok, reason }.
-- ---------------------------------------------------------------------------
create or replace function public.submit_dispatch_quote(
  p_token         text,
  p_quote_cents   integer,
  p_note          text default null,
  p_proposed_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.work_order_dispatches%rowtype;
  v_note     text;
begin
  select * into v_dispatch
  from public.work_order_dispatches
  where trade_access_token = p_token
  for update;
  if v_dispatch.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_dispatch.token_expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if v_dispatch.dispatch_status not in ('accepted','quoted') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_state');
  end if;

  -- quote: required, non-negative, under a $10,000,000 ceiling (1e9 cents) to
  -- catch a fat-fingered amount. Mirrors validateDispatchQuote.
  if p_quote_cents is null or p_quote_cents < 0 or p_quote_cents > 1000000000 then
    return jsonb_build_object('ok', false, 'reason', 'bad_quote');
  end if;

  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_note is not null and length(v_note) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'note_too_long');
  end if;

  update public.work_order_dispatches
     set dispatch_status   = 'quoted',
         quote_cents       = p_quote_cents,
         quote_note        = v_note,
         quote_submitted_at = now(),
         proposed_date     = p_proposed_date,
         proposed_by       = case when p_proposed_date is not null then 'trade'
                                  else proposed_by end,
         updated_at        = now()
   where id = v_dispatch.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.submit_dispatch_quote(text, integer, text, date)
  to anon, authenticated;
