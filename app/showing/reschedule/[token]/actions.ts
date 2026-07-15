"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendRescheduleAcceptedConfirmation } from "@/lib/email";
import { formatSlotLong } from "@/lib/booking";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_NOTIFY_RECIPIENTS = 10;

type AcceptResult = {
  ok?: boolean;
  reason?: string;
  organization_id?: string | null;
  lead_id?: string | null;
  property_id?: string | null;
  showing_id?: string | null;
  cancel_token?: string | null;
  scheduled_at?: string | null;
  old_scheduled_at?: string | null;
  timezone?: string | null;
  org_name?: string | null;
  brand_color?: string | null;
  logo_url?: string | null;
  reply_to_email?: string | null;
  property_address?: string | null;
  renter_name?: string | null;
  renter_email?: string | null;
  renter_phone?: string | null;
};

function path(token: string, status: string): string {
  return `/showing/reschedule/${encodeURIComponent(token)}?status=${status}`;
}

function statusForReason(reason: string | undefined): string {
  if (reason === "not_found" || reason === "slot_not_proposed") return "invalid";
  if (reason === "not_pending" || reason === "closed" || reason === "listing_unavailable") {
    return "expired";
  }
  if (reason === "not_available" || reason === "taken") return "taken";
  return "error";
}

async function notifyOperatorsOfAcceptedReschedule(r: AcceptResult): Promise<void> {
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
    const operatorFallback = resolveLeadNotifyEmailsPreferMemberFallback(members, [
      org.reply_to_email,
      org.public_contact_email,
    ]).slice(0, MAX_NOTIFY_RECIPIENTS);

    const dashboardUrl = r.lead_id
      ? `${APP_URL}/dashboard/leads/${r.lead_id}`
      : `${APP_URL}/dashboard/showings`;
    const timeZone = r.timezone || "America/Toronto";
    const showingTime = r.scheduled_at
      ? formatSlotLong(r.scheduled_at, timeZone)
      : "the selected time";

    await sendOrgNotification({
      client: admin,
      org: {
        id: org.id,
        name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
      },
      eventKey: "leasing.reschedule_accepted",
      vars: {
        org_name: org.name ?? "",
        property_address: r.property_address?.trim() || "(unspecified property)",
        lead_name: r.renter_name?.trim() || "A renter",
        showing_time: showingTime,
        dashboard_url: dashboardUrl,
      },
      operatorFallback,
      action: { label: "Open the inquiry", url: dashboardUrl },
    });
  } catch {
    // The showing was moved; operator notification is best-effort.
  }
}

async function sendRenterAcceptedConfirmation(
  supabase: ReturnType<typeof createClient>,
  r: AcceptResult,
): Promise<void> {
  try {
    if (!r.lead_id || !r.scheduled_at) return;
    const timeZone = r.timezone || "America/Toronto";
    let leasingPhone: string | null = null;
    let bookingRequiresConfirmation = false;
    if (r.property_id) {
      const { data: extras } = await supabase.rpc("get_booking_confirmation_extras", {
        p_property_id: r.property_id,
      });
      const e = extras as
        | { leasing_phone?: string | null; booking_requires_confirmation?: boolean | null }
        | null;
      leasingPhone = e?.leasing_phone ?? null;
      bookingRequiresConfirmation = e?.booking_requires_confirmation === true;
    }

    const result = await sendRescheduleAcceptedConfirmation({
      lead_id: r.lead_id,
      renter_name: r.renter_name ?? null,
      renter_email: r.renter_email ?? null,
      org_name: r.org_name ?? null,
      brand_color: r.brand_color ?? null,
      logo_url: r.logo_url ?? null,
      reply_to_email: r.reply_to_email ?? null,
      property_address: r.property_address ?? null,
      old_when_label: r.old_scheduled_at
        ? formatSlotLong(r.old_scheduled_at, timeZone)
        : null,
      when_label: formatSlotLong(r.scheduled_at, timeZone),
      cancel_url: r.cancel_token
        ? `${APP_URL}/showing/cancel/${r.cancel_token}`
        : null,
      leasing_phone: leasingPhone,
      booking_requires_confirmation: bookingRequiresConfirmation,
    });
    if (result.sent) {
      await supabase.rpc("record_booking_email", {
        p_lead_id: r.lead_id,
        p_to: r.renter_email ?? null,
        p_subject: result.subject ?? null,
      });
    }
  } catch {
    // Best-effort renter confirmation; the RPC already moved the showing.
  }
}

export async function acceptProposedTime(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const slot = String(formData.get("slot") ?? "").trim();
  if (!token) redirect("/showing/reschedule/invalid?status=invalid");
  if (!slot) redirect(path(token, "invalid"));

  const supabase = createClient();
  const { data, error } = await supabase.rpc("accept_reschedule_proposal", {
    p_token: token,
    p_slot: slot,
  });
  const result = (data as AcceptResult | null) ?? null;
  if (error || !result?.ok) {
    redirect(path(token, statusForReason(result?.reason)));
  }

  await notifyOperatorsOfAcceptedReschedule(result);
  await sendRenterAcceptedConfirmation(supabase, result);
  redirect(path(token, "accepted"));
}
