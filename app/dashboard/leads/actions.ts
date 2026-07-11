"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { isLeadStatus } from "@/lib/pipeline";
import { normalizeDate, normalizeText } from "@/lib/lead-detail";
import { redirect } from "next/navigation";
import { canUseRentalApplications } from "@/lib/billing";
import { normalizePayMode } from "@/lib/rental-application";
import { normalizeEmail } from "@/lib/persons";
import { normalizePhoneE164 } from "@/lib/sms";
import { sendRentalApplicationInvite } from "@/lib/email";

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

// Confirm a lead belongs to the caller's org before we write anything that
// carries its id (audit C6). The RLS select only returns leads in the caller's
// org, so a foreign / forged lead id resolves to "not found" and the action
// no-ops. This guards the messages insert in particular: messages' RLS WITH
// CHECK only validates organization_id, so without this a note could be written
// referencing another org's lead id.
async function leadInOrg(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .limit(1);
  return (data?.length ?? 0) > 0;
}

export async function updateLeadStatus(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !isLeadStatus(status)) return;

  const supabase = createClient();
  if (!(await leadInOrg(supabase, id))) return;
  // RLS scopes the update to the caller's org; status check is also enforced
  // by the table's CHECK constraint.
  await supabase
    .from("leads")
    .update({
      status,
      ...(status === "leased"
        ? { leased_date: new Date().toISOString().slice(0, 10) }
        : {}),
    })
    .eq("id", id);

  // Log the stage change to the activity timeline.
  const org = await getCurrentOrg();
  if (org) {
    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: id,
      channel: "note",
      direction: "outbound",
      body: `Stage changed to ${status}.`,
    });
  }

  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard");
}

export async function addNote(formData: FormData) {
  await requireCapability("add_notes", "/dashboard/leads?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!id || !body) return;

  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();
  if (!(await leadInOrg(supabase, id))) return;
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body,
  });

  revalidatePath(`/dashboard/leads/${id}`);
}

// Set (or update) a follow-up reminder on a lead. A blank date clears it.
export async function setNextAction(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const date = normalizeDate(formData.get("next_action_at"));
  const note = normalizeText(formData.get("next_action_note"));

  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();
  if (!(await leadInOrg(supabase, id))) return;
  // RLS scopes the update to the caller's org. A blank date clears the follow-up
  // (and its note, which is meaningless without a date).
  await supabase
    .from("leads")
    .update({
      next_action_at: date,
      next_action_note: date ? note : null,
    })
    .eq("id", id);

  // Log to the activity timeline so the change is visible in history.
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body: date
      ? `Follow-up set for ${date}${note ? `: ${note}` : ""}.`
      : "Follow-up cleared.",
  });

  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
}

// Clear a follow-up reminder (e.g. once it's been actioned).
export async function clearNextAction(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const org = await getCurrentOrg();
  if (!org) return;

  const supabase = createClient();
  if (!(await leadInOrg(supabase, id))) return;
  await supabase
    .from("leads")
    .update({ next_action_at: null, next_action_note: null })
    .eq("id", id);

  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body: "Follow-up marked done.",
  });

  revalidatePath(`/dashboard/leads/${id}`);
  revalidatePath("/dashboard/leads");
}


// Request a rental application from a lead (S454, Slice 1). Growth+ (the report
// is applicant-paid; screening completes the leasing funnel Growth owns). Mints a
// tokenized rental_applications row and emails the applicant the /apply link
// (best-effort). Idempotent: an existing OPEN application short-circuits to a
// notice instead of minting a duplicate. NEVER captures sensitive PII here —
// the applicant fills a Form-410-equivalent non-sensitive form (Model B).
export async function requestRentalApplication(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const payMode = normalizePayMode(String(formData.get("pay_mode") ?? ""));
  if (!id) return;

  const org = await getCurrentOrg();
  if (!org) return;
  // Server-side entitlement gate (never UI-only).
  if (!canUseRentalApplications(org.plan)) {
    redirect(`/dashboard/leads/${id}?apply=upgrade`);
  }

  const supabase = createClient();
  // RLS-scoped read — a foreign/forged lead id yields null and the action no-ops
  // (mirrors leadInOrg). Pull the basics we denormalize onto the application.
  const { data: leadRow } = await supabase
    .from("leads")
    .select("id, name, email, phone, property_id, property:properties(address)")
    .eq("id", id)
    .maybeSingle();
  if (!leadRow) return;
  const lead = leadRow as unknown as {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    property_id: string | null;
    property: { address: string | null } | null;
  };

  // Idempotency: don't mint a duplicate while an application is already open for
  // this lead (any non-declined status). A declined one may be re-requested.
  const { data: existing } = await supabase
    .from("rental_applications")
    .select("id")
    .eq("lead_id", id)
    .neq("status", "declined")
    .limit(1);
  if ((existing?.length ?? 0) > 0) {
    redirect(`/dashboard/leads/${id}?apply=exists`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: inserted, error } = await supabase
    .from("rental_applications")
    .insert({
      organization_id: org.id,
      lead_id: id,
      property_id: lead.property_id,
      applicant_name: lead.name,
      applicant_email: lead.email,
      applicant_phone: lead.phone,
      applicant_email_norm: normalizeEmail(lead.email),
      applicant_phone_e164: normalizePhoneE164(lead.phone),
      pay_mode: payMode,
      requested_by: user?.id ?? null,
    })
    .select("public_token")
    .single();
  if (error || !inserted) {
    redirect(`/dashboard/leads/${id}?apply=error`);
  }
  const token = (inserted as { public_token: string }).public_token;
  const applyUrl = `${APP_URL}/apply/${token}`;

  // Best-effort branded invite to the applicant (never blocks the operator).
  if (lead.email) {
    try {
      await sendRentalApplicationInvite({
        applicant_name: lead.name,
        applicant_email: lead.email,
        org_name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
        property_address: lead.property?.address ?? null,
        apply_url: applyUrl,
      });
    } catch {
      // swallow — the application row is saved; the invite is best-effort and the
      // operator can always copy the link from the lead detail card.
    }
  }

  // Timeline note for oversight.
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: "note",
    direction: "outbound",
    body: `Rental application requested (${payMode === "landlord" ? "landlord-paid" : "applicant-paid"}).`,
  });

  revalidatePath(`/dashboard/leads/${id}`);
  redirect(`/dashboard/leads/${id}?apply=sent`);
}
