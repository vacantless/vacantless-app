"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveLeadNotifyEmails } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";

// Public, UNAUTHENTICATED one-tap viewing CANCELLATION (S418, KI632). The renter
// arrives from the "Cancel this viewing" link in their booking confirmation
// email; they have NO Vacantless session - the cancel_token in the URL is their
// only handle. The WRITE is a POST server action, never a GET side-effect: email
// link scanners (Outlook SafeLinks, Gmail prefetch) fetch GET URLs, so a GET that
// cancelled would auto-cancel real viewings (KI585). The page GET only renders;
// this POST cancels via the SECURITY DEFINER cancel_showing_from_token RPC (which
// re-derives showing + org server-side, marks it cancelled, logs a note, and
// leaves the lead stage unchanged) and then fires leasing.showing_cancelled to
// the operator recipient list - the structured signal that replaces a free-text
// "I can't make it" reply that dead-ends at reply_to_email.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_NOTIFY_RECIPIENTS = 10;

function path(token: string, status: string): string {
  return `/showing/cancel/${encodeURIComponent(token)}?status=${status}`;
}

function fmtShowingTime(iso: string | null, tz: string): string {
  if (!iso) return "the scheduled time";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

type CancelResult = {
  ok?: boolean;
  reason?: string;
  already?: boolean;
  organization_id?: string | null;
  lead_id?: string | null;
  property_id?: string | null;
  lead_name?: string | null;
  org_name?: string | null;
  property_address?: string | null;
  scheduled_at?: string | null;
  timezone?: string | null;
};

// Best-effort operator alert. Mirrors notifyOperatorsOfNewLead: the renter's
// session can't read org members (RLS), so we resolve the audience via the
// service-role admin client. Never throws - the cancellation already happened.
async function notifyOperatorsOfCancellation(r: CancelResult): Promise<void> {
  try {
    if (!r.organization_id) return;
    const admin = createAdminClient();
    if (!admin) return;

    const { data: org } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email")
      .eq("id", r.organization_id)
      .maybeSingle();
    if (!org) return;

    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", r.organization_id);
    const members: NotifyMember[] = [];
    for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      members.push({ role: m.role, email: u?.user?.email ?? null });
    }
    const anyMemberEmail =
      members.map((m) => m.email).find((e) => e && e.includes("@")) ?? null;
    const operatorFallback = resolveLeadNotifyEmails(members, [
      org.reply_to_email,
      org.public_contact_email,
      anyMemberEmail,
    ]).slice(0, MAX_NOTIFY_RECIPIENTS);

    const dashboardUrl = r.lead_id
      ? `${APP_URL}/dashboard/leads/${r.lead_id}`
      : `${APP_URL}/dashboard/showings`;

    await sendOrgNotification({
      client: admin,
      org: {
        id: org.id,
        name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      },
      eventKey: "leasing.showing_cancelled",
      vars: {
        org_name: org.name ?? "",
        property_address: r.property_address?.trim() || "(unspecified property)",
        lead_name: r.lead_name?.trim() || "A renter",
        showing_time: fmtShowingTime(r.scheduled_at ?? null, r.timezone || "America/Toronto"),
        dashboard_url: dashboardUrl,
      },
      operatorFallback,
      action: { label: "Open the inquiry", url: dashboardUrl },
    });
  } catch {
    // Swallow - the viewing is cancelled; the operator alert is best-effort.
  }
}

export async function cancelShowingFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  if (!token) redirect("/showing/cancel/invalid?status=invalid");

  const supabase = createClient();
  const { data, error } = await supabase.rpc("cancel_showing_from_token", {
    p_token: token,
  });
  const result = (data as CancelResult | null) ?? null;

  if (error || !result?.ok) {
    redirect(path(token, result?.reason === "not_found" ? "invalid" : "error"));
  }

  // Only alert the operator for a fresh cancellation; a second tap (already
  // cancelled) is an idempotent no-op and must not double-notify.
  if (!result.already) {
    await notifyOperatorsOfCancellation(result);
  }

  redirect(path(token, "cancelled"));
}
