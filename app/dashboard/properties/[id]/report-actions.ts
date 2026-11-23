"use server";
// S831: the monthly report on a rental: save the landlord's "next steps" note,
// and "Send to me now" (this month so far, to the signed-in person only).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { torontoDateHour } from "@/lib/health-digest";
import { currentMonthFor } from "@/lib/rental-report";
import { loadRentalReport, type ReportProperty } from "@/lib/rental-report-server";
import { sendRentalReportEmail } from "@/lib/email";

function back(id: string, r: string): string {
  return `/dashboard/properties/${id}?report=${r}#monthly-report`;
}

export async function saveReportNextSteps(formData: FormData) {
  const id = String(formData.get("property_id") ?? "");
  await requireCapability("manage_properties", back(id, "forbidden"));
  const org = await getCurrentOrg();
  if (!org || !id) redirect("/dashboard");
  const note = String(formData.get("next_steps") ?? "").trim().slice(0, 1000) || null;
  const supabase = createClient();
  const { error } = await supabase
    .from("properties")
    .update({ report_next_steps: note })
    .eq("id", id)
    .eq("organization_id", org.id);
  revalidatePath(`/dashboard/properties/${id}`);
  redirect(back(id, error ? "error" : "note_saved"));
}

export async function sendReportToMe(formData: FormData) {
  const id = String(formData.get("property_id") ?? "");
  await requireCapability("manage_properties", back(id, "forbidden"));
  const org = await getCurrentOrg();
  if (!org || !id) redirect("/dashboard");
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const to = user?.email?.trim().toLowerCase();
  if (!to) redirect(back(id, "no_email"));
  const admin = createAdminClient();
  if (!admin) redirect(back(id, "error"));
  const { data: p } = await admin
    .from("properties")
    .select("id, organization_id, address, rent_cents, available_since, report_next_steps")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!p) redirect(back(id, "error"));
  const { data: o } = await admin.from("organizations").select("name, logo_url, viewings_by_request").eq("id", org.id).maybeSingle();
  const today = torontoDateHour(new Date()).date;
  const r = await loadRentalReport(admin, p as ReportProperty, currentMonthFor(today), today, (o as { name?: string | null } | null)?.name ?? null, (o as { viewings_by_request?: boolean | null } | null)?.viewings_by_request === true);
  const res = await sendRentalReportEmail({
    to_email: to as string,
    subject: `${r.subject}, so far`,
    html: r.html,
    org_name: (o as { name?: string | null } | null)?.name ?? null,
    logo_url: (o as { logo_url?: string | null } | null)?.logo_url ?? null,
  });
  redirect(back(id, res.sent ? "sent" : "send_failed"));
}
