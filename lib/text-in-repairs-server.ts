// ============================================================================
// text-in-repairs, server half (S808b). Called by the Twilio inbound route for a
// plain text (not STOP/START/YES). When the sender is a tenant on an active or
// upcoming tenancy of an account on a paid plan, the text becomes a repair
// request through the same SECURITY DEFINER RPC as the web repair link, the
// team gets the same email (lib/incident-notify-server), and the tenant gets one
// text back with their repair link (sendSms applies the monthly text limit).
// Anyone else falls through to the normal renter-reply path.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneE164, sendSms } from "./sms";
import { orgsWithSwitch } from "./platform-switches";
import { canUseIncidentIntake } from "./billing";
import { generateReportToken, tenantReportUrl } from "./incident-reports";
import { notifyOperatorsOfNewReport } from "./incident-notify-server";
import {
  TEXTED_MARKER,
  appendFollowOn,
  isFollowOnText,
  textedDescription,
  textedRepairCategory,
  textedRepairReply,
} from "./text-in-repairs";

type Admin = Pick<SupabaseClient, "from" | "rpc">;

type TenantRow = {
  id: string;
  organization_id: string | null;
  tenancy_id: string | null;
  name: string | null;
  sms_opt_out: boolean | null;
};

export type TextedRepairResult =
  | { handled: false; reason: "not_a_tenant" | "plan" | "ambiguous" | "failed" }
  | { handled: true; reportId: string; followOn: boolean; replied: boolean };

export async function fileTextedRepair(
  admin: Admin,
  input: { from: string | null | undefined; body: string; ownerOrgId: string | null },
): Promise<TextedRepairResult> {
  const sender = normalizePhoneE164(input.from);
  const body = input.body.trim().slice(0, 3800);
  if (!sender || body.length < 3) return { handled: false, reason: "not_a_tenant" };

  const { data: tRows } = await admin
    .from("tenants")
    .select("id, organization_id, tenancy_id, name, sms_opt_out")
    .eq("phone_e164", sender);
  let tenants = ((tRows ?? []) as TenantRow[]).filter((t) => t.tenancy_id && t.organization_id);
  if (input.ownerOrgId) {
    tenants = tenants.filter((t) => t.organization_id === input.ownerOrgId);
  } else {
    const on = await orgsWithSwitch(admin, "shared_sms_number", tenants.map((t) => t.organization_id));
    tenants = tenants.filter((t) => on.has(t.organization_id as string));
  }
  if (tenants.length === 0) return { handled: false, reason: "not_a_tenant" };

  const { data: tyRows } = await admin
    .from("tenancies")
    .select("id, organization_id, status, report_token, start_date")
    .in("id", tenants.map((t) => t.tenancy_id as string))
    .in("status", ["active", "upcoming"]);
  const tenancies = ((tyRows ?? []) as { id: string; organization_id: string; status: string; report_token: string | null; start_date: string | null }[])
    .sort((a, b) => (a.status === b.status ? (b.start_date ?? "").localeCompare(a.start_date ?? "") : a.status === "active" ? -1 : 1));
  if (tenancies.length === 0) return { handled: false, reason: "not_a_tenant" };
  // One account only: a phone on two landlords' tenancies via the shared number is not guessed.
  if (new Set(tenancies.map((t) => t.organization_id)).size > 1) return { handled: false, reason: "ambiguous" };
  const tenancy = tenancies[0];
  const tenant = tenants.find((t) => t.tenancy_id === tenancy.id)!;

  const { data: org } = await admin
    .from("organizations")
    .select("id, name, plan")
    .eq("id", tenancy.organization_id)
    .maybeSingle();
  const o = org as { id: string; name: string | null; plan: string | null } | null;
  if (!o || !canUseIncidentIntake(o.plan)) return { handled: false, reason: "plan" };

  // A second text minutes after the first adds to that request.
  const { data: recent } = await admin
    .from("incident_reports")
    .select("id, description, submitted_at, status")
    .eq("tenancy_id", tenancy.id)
    .order("submitted_at", { ascending: false })
    .limit(1);
  const last = (recent ?? [])[0] as { id: string; description: string; submitted_at: string; status: string } | undefined;
  if (last && last.status === "submitted" && last.description.includes(TEXTED_MARKER) && isFollowOnText(last.submitted_at)) {
    await admin.from("incident_reports").update({ description: appendFollowOn(last.description, body) }).eq("id", last.id);
    return { handled: true, reportId: last.id, followOn: true, replied: false };
  }

  let token = tenancy.report_token;
  if (!token) {
    token = generateReportToken();
    const { error } = await admin.from("tenancies").update({ report_token: token }).eq("id", tenancy.id).is("report_token", null);
    if (error) return { handled: false, reason: "failed" };
    const { data: again } = await admin.from("tenancies").select("report_token").eq("id", tenancy.id).maybeSingle();
    token = (again as { report_token: string | null } | null)?.report_token ?? token;
  }

  const { category, emergencyKind } = textedRepairCategory(body);
  const { data, error } = await admin.rpc("submit_incident_report", {
    p_token: token,
    p_category: category,
    p_description: textedDescription(body),
    p_reporter_name: tenant.name ?? null,
    p_reporter_contact: sender,
    p_media_consent: false,
    p_emergency_kind: emergencyKind,
  });
  const res = data as { ok?: boolean; report_id?: string; organization_id?: string } | null;
  if (error || !res?.ok || !res.report_id) return { handled: false, reason: "failed" };

  try {
    await notifyOperatorsOfNewReport(o.id, res.report_id, emergencyKind);
  } catch {
    // The request is saved; the team still sees it under Repairs.
  }

  let replied = false;
  if (!tenant.sms_opt_out) {
    const base = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/$/, "");
    const r = await sendSms({
      to: sender,
      organizationId: o.id,
      body: textedRepairReply({ orgName: o.name, reportUrl: tenantReportUrl(base, token), emergencyKind }),
    }).catch(() => null);
    replied = !!r?.sent;
  }
  return { handled: true, reportId: res.report_id, followOn: false, replied };
}
