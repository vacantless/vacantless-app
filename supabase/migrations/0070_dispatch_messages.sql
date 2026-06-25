-- ============================================================================
-- 0070_dispatch_messages — per-dispatch trade<->operator MESSAGE thread
-- (Option B incident-dispatch, S329 — the "trade asks a question" reply; see
--  DISPATCH-MESSAGES-DESIGN-2026-06-25.md).
--
-- The gap S328 left: the trade now sees Details + Photos on /job/[token] (the
-- "dispatch brief", 0068/0069), but if that's still not enough their only move is
-- to phone off-platform. This adds the missing back-channel: a trade can ask a
-- clarifying question BEFORE accepting, and the operator replies — all in-app,
-- text only. No money, no state change, no attachments (v1). Rides the existing
-- incident_dispatch (Premium) entitlement, so it lands DARK for non-Premium orgs.
--
-- Identity model (UNCHANGED, the proven 0061/0065 rail): the trade is
-- account-less. The trade's ONLY handle is the dispatch's trade_access_token. The
-- trade NEVER touches this table directly — they READ the thread through
-- get_dispatch_context (extended below, exactly as 0068 added the photo paths) and
-- WRITE through one anon SECURITY DEFINER RPC (post_dispatch_question) that
-- RE-DERIVES the dispatch / org FROM THE TOKEN, re-checks not-expired + the live-
-- state predicate in SQL, and bounds the body
-- (feedback_anon_rpc_revalidate_server_side). That keeps the ONLY new anon-definer
-- surface a SINGLE RPC — the same intentional anon-definer WARN class as
-- accept_dispatch / submit_incident_report (no NEW advisor class).
--
-- The OPERATOR side (read the thread, reply) is NOT a token RPC — the operator is
-- an authenticated member, so per-org RLS scopes the select and the reply insert
-- runs as an ordinary RLS-checked INSERT (the work_order_dispatches pattern).
--
-- Conventions mirror 0065 / 0067: sender CHECK (not a pg enum) so a future third
-- party is a one-line change; per-org RLS on organization_id in
-- (select public.user_org_ids()); explicit grants because auto-expose is OFF;
-- service_role DML so the token RPC (SECURITY DEFINER) + any future cron never hit
-- the silent permission-denied trap. The body bound + the live-state predicate are
-- MIRRORED in lib/dispatch-messages.ts; the RPC re-checks them so both sides agree.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- dispatch_messages — one line of text on a dispatch, from the trade or operator.
--   Cascade off the dispatch: a deleted dispatch takes its thread with it (a
--   message has no meaning without its job).
-- ---------------------------------------------------------------------------
create table if not exists public.dispatch_messages (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dispatch_id     uuid not null references public.work_order_dispatches(id) on delete cascade,

  -- who wrote it. CHECK (not an enum) for one-line extensibility. Mirrors
  -- lib/dispatch-messages.DISPATCH_MESSAGE_SENDERS.
  sender          text not null check (sender in ('trade','operator')),

  -- the message. Non-blank, bounded to 2000 chars (mirrors
  -- MAX_DISPATCH_MESSAGE_LEN + validateDispatchMessage). Text only in v1.
  body            text not null
                    check (length(btrim(body)) between 1 and 2000),

  created_at      timestamptz not null default now()
);

create index if not exists dispatch_messages_org_idx
  on public.dispatch_messages(organization_id);
-- the hot read on both sides: a dispatch's thread, oldest-first.
create index if not exists dispatch_messages_thread_idx
  on public.dispatch_messages(dispatch_id, created_at);

alter table public.dispatch_messages enable row level security;

-- Operators: standard per-org policy (read the thread, post a reply). Trades
-- NEVER touch this table directly — only through the SECURITY DEFINER token RPC.
drop policy if exists dispatch_messages_all on public.dispatch_messages;
create policy dispatch_messages_all on public.dispatch_messages
  for all
  using (organization_id in (select public.user_org_ids()))
  with check (organization_id in (select public.user_org_ids()));

grant select, insert, update, delete on public.dispatch_messages to authenticated;
grant select, insert, update, delete on public.dispatch_messages to service_role;

-- ---------------------------------------------------------------------------
-- RPC post_dispatch_question — anon-callable: the trade posts a question/message
-- on their job from /job/[token]. Re-derives the dispatch from the token,
-- re-checks not-expired + a LIVE (non-terminal) dispatch, validates the body,
-- and inserts a sender='trade' row (org copied from the dispatch). Returns
-- { ok, reason }. Mirrors lib/dispatch-messages (canPostDispatchMessage +
-- validateDispatchMessage) so the TS caller and the RPC agree.
-- ---------------------------------------------------------------------------
create or replace function public.post_dispatch_question(p_token text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dispatch public.work_order_dispatches%rowtype;
  v_body     text;
begin
  if p_token is null or btrim(p_token) = '' then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

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
  -- live states only — the terminal set (completed/declined/cancelled) is a
  -- read-only thread. Mirrors canPostDispatchMessage / isTerminalDispatchStatus.
  if v_dispatch.dispatch_status in ('completed','declined','cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'wrong_state');
  end if;

  v_body := btrim(coalesce(p_body, ''));
  if v_body = '' then
    return jsonb_build_object('ok', false, 'reason', 'empty');
  end if;
  if length(v_body) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'too_long');
  end if;

  insert into public.dispatch_messages (organization_id, dispatch_id, sender, body)
  values (v_dispatch.organization_id, v_dispatch.id, 'trade', v_body);

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.post_dispatch_question(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_dispatch_context — CREATE OR REPLACE to ALSO return the message thread.
--
-- Carries forward 0069 VERBATIM (the job_photos union of incident-report photos +
-- operator work-order photos) and adds a `messages` array: id / sender / body /
-- created_at for THIS dispatch, oldest-first, so the /job page renders the thread
-- on load with no extra round-trip. Authorization is unchanged: the token
-- re-derives the dispatch, and we only return messages whose dispatch_id is that
-- dispatch — a token can never reach another job's thread
-- (feedback_anon_rpc_revalidate_server_side). The expired branch still returns
-- only branding (no thread leaks past expiry).
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
  v_photos   jsonb;
  v_messages jsonb;
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

  -- Photos the trade should see (carried forward from 0069): the tenant's incident
  -- photos (if this job came from a report) PLUS any photos the operator attached
  -- to the work order. Image kind only, oldest first. Paths only; the page signs.
  select coalesce(
           jsonb_agg(jsonb_build_object('path', p.storage_path) order by p.created_at),
           '[]'::jsonb
         )
    into v_photos
  from (
    select im.storage_path, im.created_at
    from public.incident_reports ir
    join public.incident_media im on im.incident_report_id = ir.id
    where ir.converted_work_order_id = v_wo.id
      and im.kind = 'image'
    union all
    select wm.storage_path, wm.created_at
    from public.work_order_media wm
    where wm.work_order_id = v_wo.id
      and wm.kind = 'image'
  ) p;

  -- the message thread for this dispatch, oldest-first.
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', dm.id,
               'sender', dm.sender,
               'body', dm.body,
               'created_at', dm.created_at
             ) order by dm.created_at
           ),
           '[]'::jsonb
         )
    into v_messages
  from public.dispatch_messages dm
  where dm.dispatch_id = v_dispatch.id;

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
    'job_photos',       coalesce(v_photos, '[]'::jsonb),
    'messages',         coalesce(v_messages, '[]'::jsonb),
    'property_address', v_address,
    'org_name',         v_org_name,
    'brand_color',      v_brand,
    'brand_color_secondary', v_brand2,
    'logo_url',         v_logo
  );
end;
$$;

grant execute on function public.get_dispatch_context(text) to anon, authenticated;
