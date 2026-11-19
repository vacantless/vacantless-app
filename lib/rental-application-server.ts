// S816: one way to start a rental application, used by every button that sends
// one: the renter page (main renter and each co-applicant) and the showing
// agent's page. Mints the row, resolves the person (so the application, offer
// and future tenancy share one identity on the People page), emails the link
// and notes the renter's timeline. Never throws for the email.
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeEmail } from "@/lib/persons";
import { resolvePersonId } from "@/lib/persons-server";
import { normalizePhoneE164 } from "@/lib/sms";
import { sendRentalApplicationInvite } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://vacantless-app.vercel.app";

export type StartApplicationOrg = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  mail_alias?: string | null;
  reply_to_email: string | null;
  // S818b: the account's own application form (Buildium and the like).
  application_link_url?: string | null;
  application_link_name?: string | null;
};

export type StartApplicationResult =
  | { ok: true; applicationId: string; applyUrl: string; emailed: boolean; external?: false }
  | { ok: true; external: true; applyUrl: string; emailed: boolean; formName: string | null }
  | { ok: false; reason: "exists" | "contact_required" | "error" };

export async function startRentalApplication(
  client: SupabaseClient,
  args: {
    org: StartApplicationOrg;
    leadId: string;
    propertyId: string | null;
    propertyAddress: string | null;
    applicant: { name: string | null; email: string | null; phone: string | null };
    requestedBy?: string | null;
    sentByAgentId?: string | null;
    sentByLabel: string; // "you", "Maya (showing agent)"
    // S820b: a co-applicant's invite says who added them.
    addedByName?: string | null;
  },
): Promise<StartApplicationResult> {
  const name = (args.applicant.name ?? "").trim() || null;
  const email = (args.applicant.email ?? "").trim() || null;
  const phone = (args.applicant.phone ?? "").trim() || null;
  if (!email && !phone) return { ok: false, reason: "contact_required" };

  // S818b: an account with its own application form sends that link instead.
  // No Vacantless application row: the paperwork lives in their own system.
  if (args.org.application_link_url) {
    const link = args.org.application_link_url;
    const formName = args.org.application_link_name ?? null;
    let sent = false;
    if (email) {
      try {
        const r = await sendRentalApplicationInvite({
          applicant_name: name,
          applicant_email: email,
          org_name: args.org.name,
          brand_color: args.org.brand_color,
          logo_url: args.org.logo_url,
          mail_alias: args.org.mail_alias ?? null,
          reply_to_email: args.org.reply_to_email,
          property_address: args.propertyAddress,
          apply_url: link,
          added_by_name: args.addedByName ?? null,
        });
        sent = r.sent === true;
      } catch {
        sent = false;
      }
    }
    await client.from("messages").insert({
      organization_id: args.org.id,
      lead_id: args.leadId,
      channel: "note",
      direction: "outbound",
      body: `${formName ?? "Your own"} application link sent to ${name ?? email ?? phone} by ${args.sentByLabel}${sent ? " (emailed)" : ""}.`,
    });
    return { ok: true, external: true, applyUrl: link, emailed: sent, formName };
  }

  const emailNorm = normalizeEmail(email);
  const phoneE164 = normalizePhoneE164(phone);

  // One open application per person on this renter: same email or phone.
  const { data: open } = await client
    .from("rental_applications")
    .select("id, applicant_email_norm, applicant_phone_e164")
    .eq("lead_id", args.leadId)
    .neq("status", "declined");
  const dup = ((open ?? []) as { applicant_email_norm: string | null; applicant_phone_e164: string | null }[]).some(
    (r) =>
      (emailNorm && r.applicant_email_norm === emailNorm) ||
      (phoneE164 && r.applicant_phone_e164 === phoneE164),
  );
  if (dup) return { ok: false, reason: "exists" };

  const personId = await resolvePersonId(client, args.org.id, {
    name,
    email,
    phone,
    phone_e164: phoneE164,
  });

  const { data: inserted, error } = await client
    .from("rental_applications")
    .insert({
      organization_id: args.org.id,
      lead_id: args.leadId,
      property_id: args.propertyId,
      person_id: personId,
      applicant_name: name,
      applicant_email: email,
      applicant_phone: phone,
      applicant_email_norm: emailNorm,
      applicant_phone_e164: phoneE164,
      pay_mode: "applicant",
      requested_by: args.requestedBy ?? null,
      sent_by_agent_id: args.sentByAgentId ?? null,
    })
    .select("id, public_token")
    .single();
  if (error || !inserted) return { ok: false, reason: "error" };
  const row = inserted as { id: string; public_token: string };
  const applyUrl = `${APP_URL}/apply/${row.public_token}`;

  let emailed = false;
  if (email) {
    try {
      const r = await sendRentalApplicationInvite({
        applicant_name: name,
        applicant_email: email,
        org_name: args.org.name,
        brand_color: args.org.brand_color,
        logo_url: args.org.logo_url,
        mail_alias: args.org.mail_alias ?? null,
        reply_to_email: args.org.reply_to_email,
        property_address: args.propertyAddress,
        apply_url: applyUrl,
        added_by_name: args.addedByName ?? null,
      });
      emailed = r.sent === true;
    } catch {
      emailed = false;
    }
  }

  await client.from("messages").insert({
    organization_id: args.org.id,
    lead_id: args.leadId,
    channel: "note",
    direction: "outbound",
    body: `Rental application sent to ${name ?? email ?? phone} by ${args.sentByLabel}${emailed ? " (emailed)" : ""}.`,
  });

  return { ok: true, applicationId: row.id, applyUrl, emailed };
}
