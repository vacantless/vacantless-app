"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOrgNotification } from "@/lib/notifications-server";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import { feedbackAlertVars } from "@/lib/feedback";
import type { NotifyMember } from "@/lib/incident-reports";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";
const MAX_NOTIFY_RECIPIENTS = 10;

function fmtShowingTime(iso: string | null, tz: string): string {
  if (!iso) return "time not recorded";
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

// S718: email the leasing team when a renter leaves feedback (Noam approved
// 2026-10-14). Same recipients as "Viewing booked" (leasing.viewing_feedback,
// showing lane, manage-leads member fallback). The renter has no session, so
// the showing, lead, property and members are read with the admin client after
// the RPC has saved the row. Never throws: the feedback is already saved.
async function notifyOperatorsOfFeedback(
  showingId: string,
  rating: number,
  comments: string,
): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;

    const { data: showing } = await admin
      .from("showings")
      .select("id, organization_id, lead_id, property_id, scheduled_at")
      .eq("id", showingId)
      .maybeSingle();
    if (!showing?.organization_id) return;

    const { data: org } = await admin
      .from("organizations")
      .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email, booking_timezone")
      .eq("id", showing.organization_id)
      .maybeSingle();
    if (!org) return;

    const [{ data: lead }, { data: property }] = await Promise.all([
      showing.lead_id
        ? admin.from("leads").select("name").eq("id", showing.lead_id).maybeSingle()
        : Promise.resolve({ data: null }),
      showing.property_id
        ? admin.from("properties").select("address").eq("id", showing.property_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const { data: memberRows } = await admin
      .from("memberships")
      .select("user_id, role")
      .eq("organization_id", org.id);
    const members: NotifyMember[] = [];
    for (const m of (memberRows ?? []) as { user_id: string; role: string }[]) {
      const { data: u } = await admin.auth.admin.getUserById(m.user_id);
      members.push({ role: m.role, email: u?.user?.email ?? null });
    }
    const operatorFallback = resolveLeadNotifyEmailsPreferMemberFallback(members, [
      org.reply_to_email,
      org.public_contact_email,
    ]).slice(0, MAX_NOTIFY_RECIPIENTS);

    const dashboardUrl = showing.lead_id
      ? `${APP_URL}/dashboard/leads/${showing.lead_id}`
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
      eventKey: "leasing.viewing_feedback",
      vars: {
        org_name: org.name ?? "",
        property_address:
          (property as { address?: string | null } | null)?.address?.trim() || "your rental",
        lead_name: (lead as { name?: string | null } | null)?.name?.trim() || "A renter",
        showing_time: fmtShowingTime(
          showing.scheduled_at ?? null,
          org.booking_timezone || "America/Toronto",
        ),
        dashboard_url: dashboardUrl,
        ...feedbackAlertVars({ rating, comments }),
      },
      operatorFallback,
      action: { label: "Open the inquiry", url: dashboardUrl },
    });
  } catch {
    // Swallow: the feedback is saved; the alert is best-effort.
  }
}

// Public, unauthenticated feedback submission. Calls a SECURITY DEFINER RPC
// that resolves the org from the showing, inserts one feedback row, and logs
// the lead timeline. The renter can leave feedback for their own showing but
// can never read or target another tenant's data. The RPC rejects an
// out-of-range rating; a repeat submission returns already:true (no alert).
export async function submitFeedback(formData: FormData) {
  const showingId = String(formData.get("showing_id") ?? "");
  if (!showingId) return;

  const ratingRaw = String(formData.get("rating") ?? "").trim();
  const rating = Number.parseInt(ratingRaw, 10);
  const comments = String(formData.get("comments") ?? "").trim();

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    redirect(`/f/${showingId}?error=rating`);
  }

  const supabase = createClient();
  const { data, error } = await supabase.rpc("submit_public_feedback", {
    p_showing_id: showingId,
    p_rating: rating,
    p_comments: comments || null,
  });

  if (error) {
    // Any RPC error: friendly state on the page.
    redirect(`/f/${showingId}?error=1`);
  }

  const result = (data as { ok?: boolean; already?: boolean } | null) ?? null;
  if (result?.ok && !result.already) {
    await notifyOperatorsOfFeedback(showingId, rating, comments);
  }

  redirect(`/f/${showingId}?submitted=1`);
}
