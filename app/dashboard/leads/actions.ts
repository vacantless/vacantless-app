"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { isLeadStatus } from "@/lib/pipeline";
import { normalizeDate, normalizeText } from "@/lib/lead-detail";
import { redirect } from "next/navigation";
import { canUseRentalApplications } from "@/lib/billing";
import { normalizeEmail } from "@/lib/persons";
import { resolvePersonId } from "@/lib/persons-server";
import { normalizePhoneE164 } from "@/lib/sms";
import { sendApplicationOfferInvite, sendCreditCheckInvite } from "@/lib/email";
import { startRentalApplication } from "@/lib/rental-application-server";
import { parseOfferInput, offerTermLines, canSendNewOffer, type OfferParsed } from "@/lib/application-offer";
import { createHash } from "crypto";
import { DOCUMENTS_BUCKET } from "@/lib/documents-server";
import { documentStoragePath, validateDocumentUpload } from "@/lib/documents";
import { applicationSummaryTitle } from "@/lib/rental-application-summary";
import {
  isFeatureEnabledForOrg,
  loadOrganizationFeatureFlags,
} from "@/lib/feature-entitlements";
import {
  buildQaUpsert,
  savePropertyQaEntry,
} from "@/lib/property-qa";

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

function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

function leadPath(leadId: string): string {
  return `/dashboard/leads/${leadId}`;
}

function qaAnchor(leadId: string, status: string): string {
  return `${leadPath(leadId)}?qa=${status}#property-qa`;
}

async function aiReplyEnabledForCurrentOrg(
  supabase: ReturnType<typeof createClient>,
  org: NonNullable<Awaited<ReturnType<typeof getCurrentOrg>>>,
): Promise<boolean> {
  const flags = await loadOrganizationFeatureFlags(supabase, org.id, ["ai_reply"]);
  return isFeatureEnabledForOrg(
    "ai_reply",
    { ...org, featureFlags: flags },
    { env: process.env },
  );
}

async function propertyInOrg(
  supabase: ReturnType<typeof createClient>,
  propertyId: string,
  organizationId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("properties")
    .select("id")
    .eq("id", propertyId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return !!data;
}

async function requireQaCurationContext(formData: FormData) {
  const leadId = formString(formData, "lead_id");
  const propertyId = formString(formData, "property_id");
  if (!leadId) redirect("/dashboard/leads");
  if (!propertyId) redirect(qaAnchor(leadId, "missing-property"));

  await requireCapability("manage_properties", qaAnchor(leadId, "forbidden"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  if (!(await leadInOrg(supabase, leadId))) {
    redirect("/dashboard/leads");
  }
  if (!(await aiReplyEnabledForCurrentOrg(supabase, org))) {
    redirect(qaAnchor(leadId, "disabled"));
  }
  if (!(await propertyInOrg(supabase, propertyId, org.id))) {
    redirect(qaAnchor(leadId, "missing-property"));
  }

  return { supabase, org, leadId, propertyId };
}

async function qaRowInScope(
  supabase: ReturnType<typeof createClient>,
  qaId: string,
  organizationId: string,
  propertyId: string,
) {
  const { data } = await supabase
    .from("property_qa")
    .select("id, property_id, question_text, answer_text")
    .eq("id", qaId)
    .eq("organization_id", organizationId)
    .or(`property_id.eq.${propertyId},property_id.is.null`)
    .maybeSingle();
  return data as {
    id: string;
    property_id: string | null;
    question_text: string;
    answer_text: string;
  } | null;
}

export async function addLeadPropertyQa(formData: FormData) {
  const { supabase, org, leadId, propertyId } =
    await requireQaCurationContext(formData);
  const scope = formString(formData, "scope") === "org" ? "org" : "property";
  const source =
    formString(formData, "source") === "auto" ? "auto" : "operator";
  const ok = await savePropertyQaEntry(supabase, {
    organizationId: org.id,
    propertyId: scope === "org" ? null : propertyId,
    questionText: formString(formData, "question_text"),
    answerText: formString(formData, "answer_text"),
    source,
  });
  redirect(qaAnchor(leadId, ok ? "saved" : "invalid"));
}

export async function updateLeadPropertyQa(formData: FormData) {
  const { supabase, org, leadId, propertyId } =
    await requireQaCurationContext(formData);
  const qaId = formString(formData, "qa_id");
  const existing = qaId
    ? await qaRowInScope(supabase, qaId, org.id, propertyId)
    : null;
  if (!existing) redirect(qaAnchor(leadId, "missing"));

  const row = buildQaUpsert({
    organizationId: org.id,
    propertyId: existing.property_id,
    questionText: formString(formData, "question_text"),
    answerText: formString(formData, "answer_text"),
    source: "operator",
  });
  if (!row) redirect(qaAnchor(leadId, "invalid"));

  const { error } = await supabase
    .from("property_qa")
    .update({
      question_key: row.question_key,
      question_text: row.question_text,
      answer_text: row.answer_text,
      source: row.source,
      updated_at: row.updated_at,
    })
    .eq("id", existing.id)
    .eq("organization_id", org.id);
  redirect(qaAnchor(leadId, error ? "error" : "saved"));
}

export async function deleteLeadPropertyQa(formData: FormData) {
  const { supabase, org, leadId, propertyId } =
    await requireQaCurationContext(formData);
  const qaId = formString(formData, "qa_id");
  const existing = qaId
    ? await qaRowInScope(supabase, qaId, org.id, propertyId)
    : null;
  if (!existing) redirect(qaAnchor(leadId, "missing"));

  const { error } = await supabase
    .from("property_qa")
    .delete()
    .eq("id", existing.id)
    .eq("organization_id", org.id);
  redirect(qaAnchor(leadId, error ? "error" : "deleted"));
}

export async function promoteLeadPropertyQa(formData: FormData) {
  const { supabase, org, leadId, propertyId } =
    await requireQaCurationContext(formData);
  const qaId = formString(formData, "qa_id");
  const existing = qaId
    ? await qaRowInScope(supabase, qaId, org.id, propertyId)
    : null;
  if (!existing || existing.property_id == null) {
    redirect(qaAnchor(leadId, "missing"));
  }

  const saved = await savePropertyQaEntry(supabase, {
    organizationId: org.id,
    propertyId: null,
    questionText: existing.question_text,
    answerText: existing.answer_text,
    source: "operator",
  });
  if (!saved) redirect(qaAnchor(leadId, "error"));

  await supabase
    .from("property_qa")
    .delete()
    .eq("id", existing.id)
    .eq("organization_id", org.id);
  redirect(qaAnchor(leadId, "promoted"));
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
  if (!id) return;

  const org = await getCurrentOrg();
  if (!org) return;
  // Server-side entitlement gate (never UI-only).
  if (!canUseRentalApplications(org.plan)) {
    redirect(`/dashboard/leads/${id}?apply=upgrade`);
  }

  const supabase = createClient();
  // RLS-scoped read — a foreign/forged lead id yields null and the action no-ops.
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

  // S816: the same button adds a co-applicant when a name/email/phone is typed
  // in "Add another applicant"; otherwise it goes to the renter on file.
  const coName = String(formData.get("co_name") ?? "").trim();
  const coEmail = String(formData.get("co_email") ?? "").trim();
  const coPhone = String(formData.get("co_phone") ?? "").trim();
  const isCo = !!(coName || coEmail || coPhone);
  const applicant = isCo
    ? { name: coName || null, email: coEmail || null, phone: coPhone || null }
    : { name: lead.name, email: lead.email, phone: lead.phone };

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const res = await startRentalApplication(supabase, {
    org: {
      id: org.id,
      name: org.name,
      brand_color: org.brand_color ?? null,
      logo_url: org.logo_url ?? null,
      mail_alias: org.mail_alias ?? null,
      reply_to_email: org.reply_to_email ?? null,
    },
    leadId: id,
    propertyId: lead.property_id,
    propertyAddress: lead.property?.address ?? null,
    applicant,
    requestedBy: user?.id ?? null,
    sentByLabel: "your team",
  });

  revalidatePath(`/dashboard/leads/${id}`);
  if (!res.ok) redirect(`/dashboard/leads/${id}?apply=${res.reason === "exists" ? "exists" : res.reason === "contact_required" ? "contact" : "error"}#application`);
  redirect(`/dashboard/leads/${id}?apply=${res.emailed ? "sent" : "made"}#application`);
}

// S816: mark the credit check as asked for or received (the landlord runs it
// with their own screening company; Vacantless never holds the report).
// S818: "Ask for credit check" is the moment the applicant gets the link: one
// check per vacancy, on the applicant the landlord picked (in Ontario the
// landlord pays and cannot charge the applicant). Emails the link when the
// account has one and the applicant left an email.
export async function setCreditCheck(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const leadId = String(formData.get("id") ?? "");
  const appId = String(formData.get("application_id") ?? "");
  const state = String(formData.get("state") ?? "");
  if (!leadId || !appId) return;
  const next = state === "asked" || state === "received" ? state : null;
  const supabase = createClient();
  const { data: app } = await supabase
    .from("rental_applications")
    .select("id, applicant_name, applicant_email, public_token, status, credit_check_status, property:properties(address)")
    .eq("id", appId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (!app) return;
  const row = app as unknown as {
    applicant_name: string | null;
    applicant_email: string | null;
    public_token: string;
    status: string;
    credit_check_status: string | null;
    property: { address: string | null } | null;
  };
  const org = await getCurrentOrg();
  if (!org) return;
  await supabase
    .from("rental_applications")
    .update({ credit_check_status: next, credit_check_at: next ? new Date().toISOString() : null })
    .eq("id", appId);

  let banner: string | null = null;
  let emailed = false;
  const firstAsk = next === "asked" && row.credit_check_status !== "asked" && row.status !== "requested";
  if (firstAsk) {
    if (!org.screening_link_url) {
      banner = "credit_nolink";
    } else if (row.applicant_email) {
      try {
        const r = await sendCreditCheckInvite({
          applicant_name: row.applicant_name,
          applicant_email: row.applicant_email,
          org_name: org.name,
          brand_color: org.brand_color ?? null,
          logo_url: org.logo_url ?? null,
          mail_alias: org.mail_alias ?? null,
          reply_to_email: org.reply_to_email ?? null,
          property_address: row.property?.address ?? null,
          screening_name: org.screening_link_name ?? null,
          apply_url: `${APP_URL}/apply/${row.public_token}`,
        });
        emailed = r.sent === true;
      } catch {
        emailed = false;
      }
      banner = emailed ? "credit_emailed" : "credit_copy";
    } else {
      banner = "credit_copy";
    }
  }
  if (next) {
    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: leadId,
      channel: "note",
      direction: "outbound",
      body: `Credit check ${next === "asked" ? "asked for" : "received"}: ${row.applicant_name ?? "applicant"}${emailed ? " (link emailed)" : ""}.`,
    });
  }
  revalidatePath(`/dashboard/leads/${leadId}`);
  redirect(`/dashboard/leads/${leadId}${banner ? `?apply=${banner}` : ""}#application`);
}

// S816: withdraw one application (wrong person, or they backed out).
export async function withdrawRentalApplication(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const leadId = String(formData.get("id") ?? "");
  const appId = String(formData.get("application_id") ?? "");
  if (!leadId || !appId) return;
  const org = await getCurrentOrg();
  if (!org) return;
  const supabase = createClient();
  const { data: app } = await supabase
    .from("rental_applications")
    .update({ status: "declined", updated_at: new Date().toISOString() })
    .eq("id", appId)
    .eq("lead_id", leadId)
    .select("applicant_name")
    .maybeSingle();
  if (app) {
    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: leadId,
      channel: "note",
      direction: "outbound",
      body: `Rental application withdrawn: ${(app as { applicant_name: string | null }).applicant_name ?? "applicant"}.`,
    });
  }
  revalidatePath(`/dashboard/leads/${leadId}`);
  redirect(`/dashboard/leads/${leadId}#application`);
}

// S816: send an offer to everyone who signed an application on this renter.
// The landlord signs by typing their name; each applicant gets their own link.
export async function sendApplicationOffer(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const leadId = String(formData.get("id") ?? "");
  if (!leadId) return;
  const org = await getCurrentOrg();
  if (!org) return;
  if (!canUseRentalApplications(org.plan)) redirect(`/dashboard/leads/${leadId}?apply=upgrade`);
  const back = (e: string) => redirect(`/dashboard/leads/${leadId}?offer_err=${e}#offer`);

  const parsed = parseOfferInput({
    rent: String(formData.get("rent") ?? ""),
    deposit: String(formData.get("deposit") ?? ""),
    startDate: String(formData.get("start_date") ?? ""),
    termMonths: String(formData.get("term_months") ?? ""),
    conditions: String(formData.get("conditions") ?? ""),
    landlordName: String(formData.get("landlord_name") ?? ""),
  });
  if (!parsed.ok) back(parsed.reason);
  const offer = (parsed as { ok: true; value: OfferParsed }).value;

  const supabase = createClient();
  const { data: leadRow } = await supabase
    .from("leads")
    .select("id, property_id, property:properties(address)")
    .eq("id", leadId)
    .maybeSingle();
  if (!leadRow) return;
  const lead = leadRow as unknown as { property_id: string | null; property: { address: string | null } | null };

  const { data: latest } = await supabase
    .from("application_offers")
    .select("status")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!canSendNewOffer((latest as { status: string } | null)?.status)) back("open_offer");

  const { data: apps } = await supabase
    .from("rental_applications")
    .select("id, person_id, applicant_name, applicant_email")
    .eq("lead_id", leadId)
    .in("status", ["submitted", "screening", "complete"]);
  const applicants = (apps ?? []) as {
    id: string;
    person_id: string | null;
    applicant_name: string | null;
    applicant_email: string | null;
  }[];
  if (applicants.length === 0) back("no_applicants");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: ins, error } = await supabase
    .from("application_offers")
    .insert({
      organization_id: org.id,
      lead_id: leadId,
      property_id: lead.property_id,
      ...offer,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error || !ins) back("error");
  const offerId = (ins as { id: string }).id;

  const { data: signers } = await supabase
    .from("application_offer_signers")
    .insert(
      applicants.map((a) => ({
        organization_id: org.id,
        offer_id: offerId,
        application_id: a.id,
        person_id: a.person_id,
        name: a.applicant_name,
        email: a.applicant_email,
      })),
    )
    .select("name, email, token");

  let emailed = 0;
  for (const s of (signers ?? []) as { name: string | null; email: string | null; token: string }[]) {
    if (!s.email) continue;
    try {
      const r = await sendApplicationOfferInvite({
        applicant_name: s.name,
        applicant_email: s.email,
        org_name: org.name,
        brand_color: org.brand_color ?? null,
        logo_url: org.logo_url ?? null,
        mail_alias: org.mail_alias ?? null,
        reply_to_email: org.reply_to_email ?? null,
        property_address: lead.property?.address ?? null,
        term_lines: offerTermLines(offer),
        offer_url: `${APP_URL}/offer/${s.token}`,
      });
      if (r.sent) emailed++;
    } catch {
      // best effort; the link is on the renter page to copy
    }
  }

  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: leadId,
    channel: "note",
    direction: "outbound",
    body: `Offer sent, signed by ${offer.landlord_signed_name}: ${offerTermLines(offer).join(", ")}. Emailed ${emailed} of ${applicants.length}.`,
  });
  revalidatePath(`/dashboard/leads/${leadId}`);
  redirect(`/dashboard/leads/${leadId}?offer=sent#offer`);
}

export async function withdrawApplicationOffer(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const leadId = String(formData.get("id") ?? "");
  const offerId = String(formData.get("offer_id") ?? "");
  if (!leadId || !offerId) return;
  const org = await getCurrentOrg();
  if (!org) return;
  const supabase = createClient();
  const { data } = await supabase
    .from("application_offers")
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("lead_id", leadId)
    .eq("status", "sent")
    .select("id")
    .maybeSingle();
  if (data) {
    await supabase.from("messages").insert({
      organization_id: org.id,
      lead_id: leadId,
      channel: "note",
      direction: "outbound",
      body: "Offer withdrawn.",
    });
  }
  revalidatePath(`/dashboard/leads/${leadId}`);
  redirect(`/dashboard/leads/${leadId}#offer`);
}

// File a SUBMITTED application's NON-SENSITIVE summary PDF into the document
// vault (S456, Slice 1b). The operator opens the print view
// (/dashboard/leads/[id]/application/print), reviews it, Prints -> Saves as PDF,
// and files that PDF here. Stored as a documents(0076) row
// (doc_type='id_package', source='uploaded') and back-linked via
// rental_applications.filed_document_id so the card shows a download and
// re-filing is idempotent. Mirrors fileExecutedLeasePdf's storage + rollback.
// MODEL B holds — the filed artifact is the non-sensitive summary only; no
// SIN/DOB/banking ever enters the vault.
export async function fileApplicationPdf(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const leadId = String(formData.get("id") ?? "");
  const applicationId = String(formData.get("application_id") ?? "");
  if (!leadId || !applicationId) return;

  const fail = (reason: string): never =>
    redirect(`/dashboard/leads/${leadId}?apply=${reason}`);

  const org = await getCurrentOrg();
  if (!org) return;
  // Server-side entitlement gate (never UI-only) — mirrors requestRentalApplication.
  if (!canUseRentalApplications(org.plan)) fail("upgrade");

  const supabase = createClient();

  // The application must exist, belong to THIS lead (and this org via RLS), and be
  // submitted (or beyond) — a 'requested' application has no summary to file.
  const { data: appRow } = await supabase
    .from("rental_applications")
    .select("id, lead_id, status, applicant_name, filed_document_id, person_id")
    .eq("id", applicationId)
    .eq("lead_id", leadId)
    .maybeSingle();
  if (!appRow) fail("filefail");
  const app = appRow as {
    id: string;
    lead_id: string;
    status: string;
    applicant_name: string | null;
    filed_document_id: string | null;
    person_id: string | null;
  };
  if (app.status === "requested") fail("filenotready");
  // Idempotent: already filed -> bounce back with the filed banner (no duplicate).
  if (app.filed_document_id) redirect(`/dashboard/leads/${leadId}?apply=filed`);

  // Exactly one PDF (the printed summary). Reject images/other in this slot.
  const file = formData
    .getAll("document")
    .find(
      (f): f is File =>
        typeof f === "object" &&
        f !== null &&
        "size" in f &&
        "type" in f &&
        (f as File).size > 0,
    );
  if (!file) fail("filenone");
  const theFile = file as File;
  if (theFile.type !== "application/pdf") fail("filetype");
  const v = validateDocumentUpload({ type: theFile.type, size: theFile.size });
  if (!v.ok) fail("filefail");

  const docId = crypto.randomUUID();
  const path = documentStoragePath(org.id, docId, "pdf");

  const { error: upErr } = await supabase.storage
    .from(DOCUMENTS_BUCKET)
    .upload(path, theFile, { contentType: "application/pdf", upsert: false });
  if (upErr) fail("filefail");

  let sha256: string | null = null;
  try {
    sha256 = createHash("sha256")
      .update(Buffer.from(await theFile.arrayBuffer()))
      .digest("hex");
  } catch {
    sha256 = null;
  }

  const { error: insErr } = await supabase.from("documents").insert({
    id: docId,
    organization_id: org.id,
    person_id: app.person_id,
    title: applicationSummaryTitle(app.applicant_name),
    doc_type: "id_package",
    storage_path: path,
    mime_type: "application/pdf",
    size_bytes: theFile.size,
    sha256,
    source: "uploaded",
  });
  if (insErr) {
    // Roll back the orphaned object so Storage and the table stay in sync.
    const { error: rbErr } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([path]);
    if (rbErr) {
      console.error("fileApplicationPdf: rollback remove failed", {
        path,
        error: rbErr.message,
      });
    }
    fail("filefail");
  }

  // Back-link the application to the filed doc (idempotency + card download).
  await supabase
    .from("rental_applications")
    .update({ filed_document_id: docId, filed_to_vault_at: new Date().toISOString() })
    .eq("id", app.id);

  // Timeline note for oversight.
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: leadId,
    channel: "note",
    direction: "outbound",
    body: "Rental application summary filed to the document vault.",
  });

  revalidatePath(`/dashboard/leads/${leadId}`);
  redirect(`/dashboard/leads/${leadId}?apply=filed`);
}

// ---------------------------------------------------------------------------
// S728: Text back. A renter who texts the account's number gets the reply
// from that same number, written on their record, instead of from the
// landlord's own phone (which showed the renter two different numbers).
// Gated on manage_leads, the lead being in the org, a phone on file, no STOP,
// and the account really texting (lib/sms orgTextsRenters).
// ---------------------------------------------------------------------------
export async function textRenter(formData: FormData) {
  await requireCapability("manage_leads", "/dashboard/leads?forbidden=1");
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("text") ?? "").replace(/\s+/g, " ").trim().slice(0, 320);
  if (!id) return;
  if (!text) redirect(`/dashboard/leads/${id}?text=empty#text-back`);

  const supabase = createClient();
  const org = await getCurrentOrg();
  if (!org) return;
  const { data: lead } = await supabase
    .from("leads")
    .select("id, phone, sms_opt_out")
    .eq("id", id)
    .maybeSingle();
  if (!lead) return;
  const to = normalizePhoneE164((lead.phone as string | null) ?? "");
  if (!to) redirect(`/dashboard/leads/${id}?text=no_phone#text-back`);
  if (lead.sms_opt_out) redirect(`/dashboard/leads/${id}?text=opted_out#text-back`);

  const { sendSms, orgTextsRenters } = await import("@/lib/sms");
  if (!(await orgTextsRenters(org.id))) redirect(`/dashboard/leads/${id}?text=not_on#text-back`);
  const result = await sendSms({ to, body: text, organizationId: org.id });
  await supabase.from("messages").insert({
    organization_id: org.id,
    lead_id: id,
    channel: result.sent ? "sms" : "note",
    direction: "outbound",
    body: result.sent ? text : `Text not sent (${result.reason ?? "unknown"}): ${text}`,
  });
  revalidatePath(`/dashboard/leads/${id}`);
  redirect(`/dashboard/leads/${id}?text=${result.sent ? "sent" : "failed"}#text-back`);
}
