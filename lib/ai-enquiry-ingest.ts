// ai-enquiry-ingest.ts (S702). Files a forwarded enquiry the hand-built site
// readers could not read, using the AI reader, and sends every emailed-in
// renter the same instant reply a website renter gets.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAutoReply, type AutoReplyPayload } from "./email";
import { callBackSms, isWithinQuietHours, normalizePhoneE164, sendSms, smsLive } from "./sms";
import { canUseRenterSms } from "./billing";
import { generateSlots, type Availability } from "./booking";
import { buildTrackedLink } from "./listing-distribution";
import { htmlToLines } from "./portal-lead-email";
import { isFileableEnquiry, type EnquiryRead } from "./ai-enquiry";
import { answerRenterQuestion, openRentalsForOrg, readEnquiryWithAi } from "./ai-enquiry-server";

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

/**
 * Accounts whose own staff answer emailed-in renters, so we file the renter
 * but send no instant reply. Agile: Aaliyah answers every renter herself
 * (Noam, 2026-10-08).
 */
export const ORGS_THAT_ANSWER_THEMSELVES: readonly string[] = [
  "921f7c08-98af-428f-a238-36f4a781b0de", // Agile Real Estate Group
];

/** Leads an unknown sender may create per account per day before we stop. */
export const UNKNOWN_SENDER_DAILY_CAP = 30;

export type AiIngestInput = {
  orgId: string;
  subject: string;
  from: string;
  replyTo: string | null;
  textBody: string | null;
  htmlBody: string | null;
  /** True when the sender is neither a known site nor verified by the org. */
  untrustedSender: boolean;
  /** Addresses that can never be the renter (the org's own senders). */
  blockedEmails: string[];
  messageKey: string | null;
};

export type AiIngestResult =
  | { handled: "ai_lead_created"; leadId: string; propertyId: string | null; read: EnquiryRead }
  | { handled: "ai_not_enquiry" | "ai_unavailable" | "ai_daily_cap" | "ai_duplicate"; leadId?: string };

export type ReadEnquiry = typeof readEnquiryWithAi;

export async function fileAiEnquiry(
  admin: SupabaseClient,
  input: AiIngestInput,
  deps: { read?: ReadEnquiry; notify?: (leadId: string) => Promise<void> } = {},
): Promise<AiIngestResult> {
  const read = deps.read ?? readEnquiryWithAi;
  const rentals = await openRentalsForOrg(admin, input.orgId);
  const body = input.textBody?.trim() || (input.htmlBody ? htmlToLines(input.htmlBody) : "");
  const r = await read(
    { subject: input.subject, from: input.from, replyTo: input.replyTo, body },
    rentals,
    input.blockedEmails,
  );
  if (r === null) return { handled: "ai_unavailable" };
  if (!isFileableEnquiry(r, input.untrustedSender ? 0.8 : 0.7)) return { handled: "ai_not_enquiry" };

  if (input.untrustedSender) {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const { count } = await admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", input.orgId)
      .like("source", "%(email)%")
      .gte("created_at", since);
    if ((count ?? 0) >= UNKNOWN_SENDER_DAILY_CAP) return { handled: "ai_daily_cap" };
  }

  if (input.messageKey) {
    const { data: dup } = await admin
      .from("leads")
      .select("id")
      .eq("organization_id", input.orgId)
      .eq("ingest_message_key", input.messageKey)
      .maybeSingle();
    if (dup?.id) return { handled: "ai_duplicate", leadId: dup.id as string };
  }

  const source = `${r.site ? r.site : "Email"} (email)`;
  const notes = [
    r.question ? `Asked: ${r.question}` : null,
    `Read by AI from a forwarded email${r.site ? ` (${r.site})` : ""}. Subject: ${input.subject.slice(0, 160)}`,
  ]
    .filter(Boolean)
    .join("\n");

  let leadId: string | null = null;
  let rpcPayload: AutoReplyPayload | null = null;
  if (r.rentalId) {
    const { data, error } = await admin.rpc("submit_public_lead", {
      p_property_id: r.rentalId,
      p_name: r.name,
      p_email: r.email,
      p_phone: r.phone,
      p_move_in: null,
      p_notes: notes,
      p_listing_post_id: null,
    });
    if (!error && data && typeof data === "object") {
      rpcPayload = data as AutoReplyPayload;
      leadId = (data as { lead_id?: string }).lead_id ?? null;
    }
  }
  if (!leadId) {
    const { data, error } = await admin
      .from("leads")
      .insert({
        organization_id: input.orgId,
        property_id: r.rentalId,
        name: r.name,
        email: r.email,
        phone: r.phone,
        phone_e164: normalizePhoneE164(r.phone),
        source,
        status: "new",
        notes: r.rentalId
          ? notes
          : `${notes}\n\nCould not tell which rental this is about. Assign it by hand.`,
      })
      .select("id")
      .maybeSingle();
    if (error || !data?.id) throw new Error(`ai lead insert failed: ${error?.message ?? "no id"}`);
    leadId = data.id as string;
  } else {
    await admin.from("leads").update({ source }).eq("id", leadId);
  }
  if (input.messageKey) {
    await admin.from("leads").update({ ingest_message_key: input.messageKey }).eq("id", leadId);
  }

  if (deps.notify) await deps.notify(leadId);

  if (rpcPayload && r.rentalId) {
    await autoReplyIngestedLead(admin, {
      orgId: input.orgId,
      propertyId: r.rentalId,
      listingPostId: null,
      payload: rpcPayload,
      question: r.question,
      site: r.site,
      phone: r.phone,
    });
  }
  return { handled: "ai_lead_created", leadId, propertyId: r.rentalId, read: r };
}

/**
 * The instant reply for a renter who emailed through another website: the
 * booking link when there are open viewing times, and an answer to their
 * question from the rental's facts. Skipped for accounts that answer renters
 * themselves. Never throws.
 */
export async function autoReplyIngestedLead(
  admin: SupabaseClient,
  args: {
    orgId: string;
    propertyId: string;
    listingPostId: string | null;
    payload: AutoReplyPayload;
    question: string | null;
    site: string | null;
    /** The renter's phone, for a caller who left no email (voicemail). */
    phone?: string | null;
  },
): Promise<boolean> {
  try {
    if (ORGS_THAT_ANSWER_THEMSELVES.includes(args.orgId)) return false;
    if (!args.payload || args.payload.lead_reused) return false;
    if (!args.payload.renter_email && !args.phone) return false;
    let bookingUrl: string | null = null;
    const { data: avData } = await admin.rpc("get_public_availability", {
      p_property_id: args.propertyId,
    });
    const av = avData as Availability | null;
    if (av && generateSlots(av).some((d) => d.slots.length > 0)) {
      const base = `${APP_URL}/r/${args.propertyId}`;
      bookingUrl = args.listingPostId ? buildTrackedLink(base, args.listingPostId) : base;
    }
    const answer = await answerRenterQuestion(admin, args.propertyId, args.question);
    if (!args.payload.renter_email) {
      return await textBackCaller(admin, {
        orgId: args.orgId,
        leadId: args.payload.lead_id,
        phone: args.phone ?? null,
        orgName: args.payload.org_name,
        address: args.payload.property_address,
        bookingUrl,
        answer,
      });
    }
    const result = await sendAutoReply({
      ...args.payload,
      booking_url: bookingUrl,
      answer_text: answer,
      via_site: args.site,
    });
    if (result.sent) {
      await admin.rpc("record_auto_reply", {
        p_lead_id: args.payload.lead_id,
        p_subject: result.subject ?? null,
        p_to: args.payload.renter_email,
      });
    }
    return result.sent;
  } catch (err) {
    console.error("autoReplyIngestedLead failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/**
 * A caller who left a voicemail gets one text with the booking link, when the
 * landlord's plan includes renter texts and texts are switched on. Never at
 * night in the landlord's time zone, and never to someone who texted STOP.
 * Never throws.
 */
export async function textBackCaller(
  admin: SupabaseClient,
  args: {
    orgId: string;
    leadId: string;
    phone: string | null;
    orgName: string | null;
    address: string | null;
    bookingUrl: string | null;
    answer: string | null;
  },
  now: Date = new Date(),
  send: typeof sendSms = sendSms,
): Promise<boolean> {
  try {
    const to = normalizePhoneE164(args.phone);
    if (!to || !smsLive()) return false;
    const { data: org } = await admin
      .from("organizations")
      .select("sms_enabled, plan, booking_timezone")
      .eq("id", args.orgId)
      .maybeSingle();
    if (!org || org.sms_enabled !== true || !canUseRenterSms(org.plan as string | null)) return false;
    if (isWithinQuietHours(now, (org.booking_timezone as string | null) || "America/Toronto")) return false;
    const { data: optedOut } = await admin
      .from("leads")
      .select("id")
      .eq("phone_e164", to)
      .eq("sms_opt_out", true)
      .limit(1);
    if ((optedOut ?? []).length > 0) return false;
    const body = callBackSms({
      org_name: args.orgName,
      property_address: args.address,
      booking_url: args.bookingUrl,
      answer: args.answer,
    });
    const result = await send({ to, body });
    if (result.sent) {
      await admin.from("messages").insert({
        organization_id: args.orgId,
        lead_id: args.leadId,
        channel: "sms",
        direction: "outbound",
        body,
      });
    }
    return result.sent;
  } catch (err) {
    console.error("textBackCaller failed", { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
