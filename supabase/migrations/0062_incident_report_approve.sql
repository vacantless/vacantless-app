-- ============================================================================
-- 0062_incident_report_approve — operator triage: approve -> convert to work order
-- (Option B incident-dispatch, Slice 3 — see
--  OPTION-B-INCIDENT-DISPATCH-SLICE-PLAN-2026-06-23.md §6).
--
-- Slice 2 (0061) gave a tenant an account-less way to FILE an incident_report,
-- which lands in a dedicated table OFF the operator's work_orders queue. Slice 3
-- is the operator side: an authenticated owner/operator triages that inbox and
-- either APPROVES a report (it becomes a real work_orders row — the existing
-- spine — and the report is marked `converted`) or DECLINES it (recorded with a
-- reason; handled by a plain RLS-scoped UPDATE in the server action, no function
-- needed there).
--
-- The approve step is the only place that needs SQL: it is TWO writes that must
-- happen together — insert the work_orders row, then flip the report to
-- converted + stamp converted_work_order_id. A function makes that ATOMIC (one
-- statement from the action's view); a half-done approve (work order created but
-- report still `submitted`) would let a second click create a duplicate work
-- order. Wrapping both writes in one plpgsql function closes that race.
--
-- SECURITY INVOKER (the default), NOT definer: the caller is an authenticated
-- operator, so per-org RLS already scopes every row this function touches —
--   * the SELECT ... FOR UPDATE returns the report only if it's in the caller's
--     org (incident_reports_all policy, 0061),
--   * the work_orders INSERT is gated by work_orders_all WITH CHECK (0054),
--   * the incident_reports UPDATE is gated by the same report policy.
-- So a forged id from another org simply finds no row. This deliberately avoids
-- adding to the SECURITY DEFINER surface the advisors track (unlike the Slice-2
-- token RPCs, which HAD to be definer because their caller is anon). We still
-- pin search_path = public (the one advisor hygiene rule that applies to any
-- function). The manage_work_orders CAPABILITY check is enforced in the server
-- action before this is ever called; RLS here is the backstop.
--
-- The work-order TITLE is derived in TS (lib/incident-reports.workOrderTitleFromReport,
-- unit-tested) and passed in, so the title logic has one tested home; the
-- function only guards it (non-empty, length-capped) and falls back to the
-- category if a caller somehow passes nothing.
-- ============================================================================

create or replace function public.approve_incident_report(
  p_report_id uuid,
  p_title     text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_report public.incident_reports%rowtype;
  v_title  text;
  v_wo_id  uuid;
begin
  -- RLS scopes this to the caller's org; a forged/other-org id finds nothing.
  -- FOR UPDATE so a concurrent approve of the same report serializes (the second
  -- sees status = 'converted' and bails — no duplicate work order).
  select * into v_report
  from public.incident_reports
  where id = p_report_id
  for update;

  if v_report.id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  -- Only an OPEN report (submitted | under_review) can be approved. Mirrors
  -- lib/incident-reports.canApproveReport.
  if v_report.status not in ('submitted', 'under_review') then
    return jsonb_build_object('ok', false, 'reason', 'not_open');
  end if;

  v_title := nullif(btrim(coalesce(p_title, '')), '');
  if v_title is null then
    v_title := 'Tenant-reported ' || v_report.category;
  end if;

  -- Promote to the work_orders spine. Inherit the report's unit (property_id),
  -- tenancy, category, and description verbatim so the approved job rolls up to
  -- the right unit/building and the owner sees what the tenant wrote. New job
  -- starts at status 'open', priority 'normal' — the operator tunes both, plus
  -- cost / trade assignment, on the maintenance page afterward.
  insert into public.work_orders (
    organization_id, property_id, tenancy_id,
    title, description, category, priority, status
  ) values (
    v_report.organization_id, v_report.property_id, v_report.tenancy_id,
    left(v_title, 200), v_report.description, v_report.category, 'normal', 'open'
  )
  returning id into v_wo_id;

  update public.incident_reports
     set status                  = 'converted',
         converted_work_order_id = v_wo_id,
         reviewed_at             = now(),
         updated_at              = now()
   where id = v_report.id;

  return jsonb_build_object('ok', true, 'work_order_id', v_wo_id);
end;
$$;

grant execute on function public.approve_incident_report(uuid, text) to authenticated;
