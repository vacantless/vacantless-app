"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyRenterUnsubscribeToken } from "@/lib/renter-unsubscribe";
import { renterUnsubscribeSecret } from "@/lib/renter-unsubscribe-server";
import { markRenterEmailOptOut } from "@/lib/renter-email-block";

// S728: the POST half of the renter unsubscribe link. Records the opt-out on
// every lead carrying the address, writes one note, and never throws.
export async function unsubscribeRenter(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const v = verifyRenterUnsubscribeToken(token, renterUnsubscribeSecret());
  if (!v) redirect(`/unsubscribe/${encodeURIComponent(token)}?status=invalid`);
  const admin = createAdminClient();
  if (!admin) redirect(`/unsubscribe/${encodeURIComponent(token)}?status=error`);
  const now = new Date().toISOString();
  if (v.subject === "waitlist") {
    const { data: entry } = await admin
      .from("waitlist_entries")
      .select("id, email, status, notes")
      .eq("id", v.id)
      .maybeSingle();
    if (!entry) redirect(`/unsubscribe/${encodeURIComponent(token)}?status=invalid`);
    if (entry.status !== "removed") {
      await admin
        .from("waitlist_entries")
        .update({ status: "removed", notes: [entry.notes, `Unsubscribed by the renter ${now.slice(0, 10)}.`].filter(Boolean).join("\n") })
        .eq("id", v.id);
    }
    await markRenterEmailOptOut(admin, entry.email as string | null, now);
    redirect(`/unsubscribe/${encodeURIComponent(token)}?status=done`);
  }
  const leadId = v.id;
  const { data: lead } = await admin
    .from("leads")
    .select("id, organization_id, email, email_opt_out_at")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) redirect(`/unsubscribe/${encodeURIComponent(token)}?status=invalid`);
  if (!lead.email_opt_out_at) {
    const n = await markRenterEmailOptOut(admin, lead.email as string | null, now);
    if (n === 0) {
      // No address on the lead: still honour it on this row.
      await admin.from("leads").update({ email_opt_out_at: now }).eq("id", leadId);
    }
    await admin.from("messages").insert({
      organization_id: lead.organization_id,
      lead_id: leadId,
      channel: "note",
      direction: "inbound",
      body: "Renter unsubscribed from follow-up emails (link in the email). Booking confirmations and reminders still go out.",
    });
  }
  redirect(`/unsubscribe/${encodeURIComponent(token)}?status=done`);
}
