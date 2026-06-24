-- ============================================================================
-- 0066_dispatch_terms_acceptance — Slice 0 acceptance mechanics
-- (Option B incident-dispatch — see SLICE-0-TRADES-TOS-LIABILITY-CONSENT-2026-06-23.md
--  + OPTION-B-INCIDENT-DISPATCH-SLICE-PLAN-2026-06-23.md §6 Slice 0).
--
-- Slice 5 (0065) shipped the in-app trade-dispatch portal behind the
-- `incident_dispatch` Premium flag, DARK. Slice 0 is the legal/consent gate that
-- has to clear before any org can flip that flag for real use. The copy was
-- drafted (the S324 redline); this migration adds the three ACCEPTANCE STAMPS the
-- three surfaces need, and re-checks the two that are enforceable in SQL:
--
--   Block A (trade Terms, /job/[token] accept): work_order_dispatches gains
--     `terms_accepted_at`. accept_dispatch now REQUIRES the trade to have agreed
--     to the Vacantless Trade Terms (p_terms_accepted) and stamps the time.
--     SAFE to hard-require: the dispatch flow is DARK (no org on Premium yet, so
--     zero live dispatches) — there is no old client to break.
--
--   Block B (tenant media-consent, /report/[token] upload): incident_reports
--     gains `media_consent_at`. submit_incident_report stamps it from a new
--     p_media_consent flag (set by the client when the tenant attaches media and
--     ticks the consent box). We DO NOT hard-block the media RPCs on it: /report
--     is LIVE for Agile (incident_intake = Growth+), and a hard guard would break
--     in-flight uploads in the window between applying this migration and
--     deploying the new client. Consent is enforced in the UI (can't attach media
--     without ticking) and RECORDED here for the audit trail — Block B is a
--     consent record, not an org-scoping boundary.
--
--   Block C (operator dispatch acknowledgment, /dashboard/maintenance):
--     organizations gains `dispatch_terms_accepted_at` + `dispatch_terms_accepted_by`.
--     The one-time per-org gate is enforced in the operator action
--     (dispatchWorkOrderToTrade), which is authenticated + RLS-scoped — no SQL
--     function change needed; the columns are the stamp.
--
-- accept_dispatch + submit_incident_report change SIGNATURE (a new param), so they
-- are DROP + CREATE (not create-or-replace, which can't alter the arg list). New
-- params carry DEFAULTs so PostgREST still resolves a call that omits them. No new
-- advisor class — the recreated functions keep the same SECURITY DEFINER anon
-- WARN as before (sign_lease_document et al.).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Block A — trade Terms acceptance stamp on the dispatch.
-- ---------------------------------------------------------------------------
alter table public.work_order_dispatches
  add column if not exists terms_accepted_at timestamptz;

-- ---------------------------------------------------------------------------
-- Block B — tenant media-consent stamp on the report.
-- ---------------------------------------------------------------------------
alter table public.incident_reports
  add column if not exists media_consent_at timestamptz;

-- ---------------------------------------------------------------------------
-- Block C — one-time per-org operator dispatch acknowledgment.
--   accepted_by stores the acting member's auth uid (audit only); plain uuid,
--   no FK to auth.users to avoid cross-schema grant coupling.
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists dispatch_terms_accepted_at timestamptz;
alter table public.organizations
  add column if not exists dispatch_terms_accepted_by uuid;

-- ---------------------------------------------------------------------------
-- accept_dispatch (REPLACES 0065) — now REQUIRES the trade to agree to the
-- Vacantless Trade Terms, and stamps terms_accepted_at. Re-derives the dispatch
-- from the token, re-checks not-expired + status=offered (unchanged).
-- ---------------------------------------------------------------------------
drop function if exists public.accept_dispatch(text);

create or replace function public.accept_dispatch(
  p_token          text,
  p_terms_accepted boolean default false
)
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
  -- Slice 0 Block A: the trade must accept the Vacantless Trade Terms to take
  -- the job. The /job client gates the Accept button on the checkbox; this is
  -- the server-side backstop (feedback_anon_rpc_revalidate_server_side).
  if not coalesce(p_terms_accepted, false) then
    return jsonb_build_object('ok', false, 'reason', 'terms_required');
  end if;

  update public.work_order_dispatches
     set dispatch_status = 'accepted',
         accepted_at = now(),
         terms_accepted_at = now(),
         updated_at = now()
   where id = v_dispatch.id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.accept_dispatch(text, boolean) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- submit_incident_report (REPLACES 0061) — unchanged validation, plus a new
-- p_media_consent flag that stamps incident_reports.media_consent_at when the
-- tenant attached media and ticked the consent box. Slice 0 Block B.
-- ---------------------------------------------------------------------------
drop function if exists public.submit_incident_report(text, text, text, text, text);

create or replace function public.submit_incident_report(
  p_token            text,
  p_category         text,
  p_description      text,
  p_reporter_name    text default null,
  p_reporter_contact text default null,
  p_media_consent    boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenancy public.tenancies%rowtype;
  v_desc    text;
  v_report  public.incident_reports%rowtype;
begin
  select * into v_tenancy from public.tenancies where report_token = p_token for update;
  if v_tenancy.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_tenancy.status not in ('active','upcoming') then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  -- mirror lib/incident-reports.validateReportSubmission exactly.
  if p_category is null or p_category not in
       ('plumbing','electrical','hvac','appliance','structural','pest','landscaping','cleaning','general') then
    return jsonb_build_object('ok', false, 'reason', 'bad_category');
  end if;

  v_desc := btrim(coalesce(p_description, ''));
  if length(v_desc) < 3 then
    return jsonb_build_object('ok', false, 'reason', 'description_required');
  end if;
  if length(v_desc) > 4000 then
    return jsonb_build_object('ok', false, 'reason', 'description_too_long');
  end if;

  insert into public.incident_reports (
    organization_id, tenancy_id, property_id,
    reporter_name, reporter_contact,
    category, description, status,
    media_consent_at
  ) values (
    v_tenancy.organization_id, v_tenancy.id, v_tenancy.property_id,
    nullif(btrim(coalesce(p_reporter_name, '')), ''),
    nullif(btrim(coalesce(p_reporter_contact, '')), ''),
    p_category, v_desc, 'submitted',
    case when coalesce(p_media_consent, false) then now() else null end
  )
  returning * into v_report;

  return jsonb_build_object(
    'ok', true,
    'report_id', v_report.id,
    'organization_id', v_report.organization_id
  );
end;
$$;

grant execute on function public.submit_incident_report(text, text, text, text, text, boolean)
  to anon, authenticated;
