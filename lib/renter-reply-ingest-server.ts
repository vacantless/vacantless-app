import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEFAULT_INGEST_DOMAIN,
  extractAddress,
  ingestDedupeKey,
  isAutoReplyOrLoop,
  parseIngestAlias,
  readIngestSecretFromAuth,
  verifyIngestSecret,
  type IngestLoopHeaders,
} from "@/lib/email-ingest";
import {
  sendOrgNotification,
  type SendOrgNotificationResult,
} from "@/lib/notifications-server";
import { resolveLeadNotifyEmailsPreferMemberFallback } from "@/lib/leads-notify";
import type { NotifyMember } from "@/lib/incident-reports";

const PROVIDER = "renter_reply";
const MAIN_MAIL_DOMAIN = "vacantless.com";
const ORG_HOURLY_RELAY_LIMIT = 10;
const LEAD_HOURLY_RELAY_LIMIT = 3;
const MAX_LEAD_NOTIFY_RECIPIENTS = 10;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

type AdminClient = SupabaseClient;

type RenterReplyDeps = {
  admin?: AdminClient | null;
  secret?: string;
  now?: () => number;
  sendOrgNotification?: typeof sendOrgNotification;
};

type ResolvedOrg = {
  id: string;
  name: string | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
  mail_alias: string | null;
};

type MatchedLead = {
  id: string;
  name: string | null;
  email: string | null;
  status: string | null;
  property: { address: string | null } | { address: string | null }[] | null;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function firstNonBlank(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function headerValue(headers: Record<string, string>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) return value || null;
  }
  return null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function collectPostmarkRecipients(payload: Record<string, unknown>): string[] {
  const recipients: string[] = [];
  for (const key of ["ToFull", "CcFull", "BccFull"]) {
    const arr = payload[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      const email =
        item && typeof item === "object" ? str((item as Record<string, unknown>).Email) : "";
      if (email) recipients.push(email);
    }
  }
  for (const key of ["To", "Cc", "OriginalRecipient"]) {
    const value = str(payload[key]);
    if (value) recipients.push(value);
  }
  return recipients;
}

function pickReplyAlias(recipients: string[], ingestDomain: string): string | null {
  const domains = [ingestDomain, MAIN_MAIL_DOMAIN];
  for (const recipient of recipients) {
    for (const domain of domains) {
      const alias = parseIngestAlias(recipient, domain);
      if (alias) return alias;
    }
  }
  return null;
}

function postmarkMessageId(
  payload: Record<string, unknown>,
  headers: Record<string, string>,
): string | null {
  return firstNonBlank(
    str(payload.MessageID),
    str(payload.MessageId),
    headerValue(headers, "Message-ID"),
  );
}

function messageBody(payload: Record<string, unknown>): string {
  const body = firstNonBlank(
    str(payload.StrippedTextReply),
    str(payload.TextBody),
    str(payload.HtmlBody),
  );
  return body ?? "(No message body was included.)";
}

function senderDomain(senderEmail: string | null): string | null {
  const at = senderEmail?.lastIndexOf("@") ?? -1;
  return at > 0 ? senderEmail!.slice(at + 1).toLowerCase() : null;
}

function isOwnSender(senderEmail: string | null, ingestDomain: string): boolean {
  const domain = senderDomain(senderEmail);
  return domain === MAIN_MAIL_DOMAIN || domain === ingestDomain.trim().toLowerCase();
}

async function resolveOrgByAlias(
  admin: AdminClient,
  alias: string,
): Promise<ResolvedOrg | null> {
  const { data } = await admin
    .from("organizations")
    .select("id, name, brand_color, logo_url, reply_to_email, public_contact_email, mail_alias")
    .ilike("mail_alias", alias)
    .maybeSingle();
  return (data as ResolvedOrg | null) ?? null;
}

async function resolveLeadBySender(
  admin: AdminClient,
  orgId: string,
  senderEmail: string,
): Promise<MatchedLead | null> {
  const { data } = await admin
    .from("leads")
    .select("id, name, email, status, property:properties(address)")
    .eq("organization_id", orgId)
    .ilike("email", senderEmail)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as MatchedLead | null) ?? null;
}

async function resolveOperatorFallback(
  admin: AdminClient,
  org: ResolvedOrg,
): Promise<string[]> {
  const { data: memberRows } = await admin
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", org.id);
  const members: NotifyMember[] = [];
  for (const member of (memberRows ?? []) as { user_id: string; role: string }[]) {
    const { data: userData } = await admin.auth.admin.getUserById(member.user_id);
    members.push({ role: member.role, email: userData?.user?.email ?? null });
  }
  return resolveLeadNotifyEmailsPreferMemberFallback(members, [
    org.reply_to_email,
    org.public_contact_email,
  ]).slice(0, MAX_LEAD_NOTIFY_RECIPIENTS);
}

function dashboardUrl(leadId: string): string {
  return `${APP_URL}/dashboard/leads/${leadId}`;
}

function relayCopy(args: {
  lead: MatchedLead | null;
  propertyAddress: string;
  senderEmail: string;
  subject: string | null;
  body: string;
}): { subject: string; body: string; action: { label: string; url: string } | null } {
  const matchedLeadName = args.lead?.name?.trim() || args.lead?.email?.trim() || null;
  const subject = `Renter reply - ${args.propertyAddress}`;
  const lines = [
    `Renter reply from ${args.senderEmail}`,
    args.subject ? `Original subject: ${args.subject}` : null,
    "",
    args.lead
      ? `Matched lead: ${matchedLeadName ?? args.lead.id}`
      : "We could not match this reply to a lead.",
    args.lead ? `Lead dashboard: ${dashboardUrl(args.lead.id)}` : null,
    "",
    "Message:",
    args.body,
  ].filter((line): line is string => line != null);
  return {
    subject,
    body: lines.join("\n"),
    action: args.lead ? { label: "Open lead", url: dashboardUrl(args.lead.id) } : null,
  };
}

function replyMessageKey(args: {
  orgId: string;
  alias: string;
  senderEmail: string | null;
  subject: string | null;
  body: string;
  messageId: string | null;
}): string {
  return ingestDedupeKey(
    PROVIDER,
    args.messageId,
    `${args.orgId}:${args.alias}:${args.senderEmail ?? ""}:${args.subject ?? ""}:${args.body.slice(0, 1000)}`,
  );
}

async function insertReceivedAudit(args: {
  admin: AdminClient;
  orgId: string;
  leadId: string | null;
  messageKey: string;
  senderEmail: string;
  matched: boolean;
}) {
  const { data, error } = await args.admin
    .from("renter_reply_ingests")
    .insert({
      organization_id: args.orgId,
      lead_id: args.leadId,
      message_key: args.messageKey,
      sender_email: args.senderEmail,
      matched: args.matched,
      status: "received",
      relay_recipients: [],
    })
    .select("id")
    .maybeSingle();
  if (!error) return { ok: true as const, id: (data as { id: string } | null)?.id ?? null };
  if ((error as { code?: string }).code === "23505") {
    return { ok: false as const, reason: "duplicate" as const };
  }
  console.error("inbound/reply: audit insert failed", { message: error.message });
  return { ok: false as const, reason: "audit_failed" as const };
}

async function insertDroppedAudit(args: {
  admin: AdminClient;
  orgId: string;
  messageKey: string;
  senderEmail: string | null;
  reason: "auto_reply" | "sender_unresolved" | "own_sender";
}) {
  const { error } = await args.admin.from("renter_reply_ingests").insert({
    organization_id: args.orgId,
    lead_id: null,
    message_key: args.messageKey,
    sender_email: args.senderEmail ?? "(unresolved)",
    matched: false,
    status: "dropped",
    drop_reason: args.reason,
    relay_recipients: [],
  });
  if (error && (error as { code?: string }).code !== "23505") {
    console.warn("inbound/reply: dropped audit insert failed", { message: error.message });
  }
}

async function updateAudit(args: {
  admin: AdminClient;
  id: string | null;
  status: "relayed" | "rate_limited" | "relay_failed";
  recipients?: string[];
}) {
  if (!args.id) return;
  const { error } = await args.admin
    .from("renter_reply_ingests")
    .update({
      status: args.status,
      relay_recipients: args.recipients ?? [],
    })
    .eq("id", args.id);
  if (error) {
    console.warn("inbound/reply: audit update failed", { message: error.message });
  }
}

async function recentRelayCount(args: {
  admin: AdminClient;
  orgId: string;
  leadId?: string | null;
  sinceIso: string;
  limit: number;
}): Promise<number> {
  let query = args.admin
    .from("renter_reply_ingests")
    .select("id")
    .eq("organization_id", args.orgId)
    .eq("status", "relayed")
    .gte("created_at", args.sinceIso)
    .limit(args.limit + 1);
  if (args.leadId) query = query.eq("lead_id", args.leadId);
  const { data } = await query;
  return ((data ?? []) as unknown[]).length;
}

async function appendMatchedLeadMetadata(args: {
  admin: AdminClient;
  orgId: string;
  lead: MatchedLead;
  senderEmail: string;
  recipients: string[];
}) {
  await args.admin.from("messages").insert({
    organization_id: args.orgId,
    lead_id: args.lead.id,
    channel: "email",
    direction: "inbound",
    body:
      `Renter replied by email from ${args.senderEmail}. ` +
      `Relayed to ${args.recipients.join(", ") || "the leasing notification recipients"}. ` +
      "Message body relayed by email and not stored.",
  });
  if (args.lead.status === "new") {
    await args.admin
      .from("leads")
      .update({ status: "replied", next_action_at: null, next_action_note: null })
      .eq("id", args.lead.id)
      .eq("organization_id", args.orgId)
      .eq("status", "new");
  }
}

export async function handleInboundReplyPost(
  req: Pick<NextRequest, "headers" | "url" | "json">,
  deps: RenterReplyDeps = {},
) {
  const secret = deps.secret ?? process.env.INBOUND_WEBHOOK_SECRET;
  const admin = deps.admin ?? createAdminClient();
  const now = deps.now ?? Date.now;
  const relayNotification = deps.sendOrgNotification ?? sendOrgNotification;
  if (!secret || !admin) {
    return new NextResponse("Not found", { status: 404 });
  }

  const provided =
    readIngestSecretFromAuth(req.headers.get("authorization")) ??
    new URL(req.url).searchParams.get("key");
  if (!verifyIngestSecret(provided, secret)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: true, handled: "bad_payload" });
  }

  const ingestDomain = process.env.INGEST_EMAIL_DOMAIN || DEFAULT_INGEST_DOMAIN;
  const recipients = collectPostmarkRecipients(payload);
  const alias = pickReplyAlias(recipients, ingestDomain);
  if (!alias) {
    return NextResponse.json({ ok: true, handled: "org_unresolved" });
  }

  const org = await resolveOrgByAlias(admin, alias);
  if (!org) {
    return NextResponse.json({ ok: true, handled: "org_unresolved" });
  }

  const headers: Record<string, string> = {};
  const fromFull = payload.FromFull;
  const fromRaw =
    (fromFull && typeof fromFull === "object"
      ? str((fromFull as Record<string, unknown>).Email)
      : "") || str(payload.From);
  const senderEmail = extractAddress(fromRaw);
  const loopHeaders: IngestLoopHeaders = { from: senderEmail ?? fromRaw };
  const headerArr = payload.Headers;
  if (Array.isArray(headerArr)) {
    for (const header of headerArr) {
      if (!header || typeof header !== "object") continue;
      const record = header as Record<string, unknown>;
      const name = str(record.Name);
      const value = str(record.Value);
      if (!name) continue;
      headers[name] = value;
      const lower = name.toLowerCase();
      if (lower === "auto-submitted") loopHeaders["auto-submitted"] = value;
      else if (lower === "precedence") loopHeaders.precedence = value;
      else if (lower === "x-autoreply") loopHeaders["x-autoreply"] = value;
      else if (lower === "x-autorespond") loopHeaders["x-autorespond"] = value;
    }
  }

  const subject = str(payload.Subject) || null;
  const messageId = postmarkMessageId(payload, headers);
  const body = messageBody(payload);
  const messageKey = replyMessageKey({
    orgId: org.id,
    alias,
    senderEmail,
    subject,
    body,
    messageId,
  });

  if (isAutoReplyOrLoop(loopHeaders)) {
    await insertDroppedAudit({
      admin,
      orgId: org.id,
      messageKey,
      senderEmail,
      reason: "auto_reply",
    });
    return NextResponse.json({ ok: true, handled: "auto_reply" });
  }
  if (!senderEmail) {
    await insertDroppedAudit({
      admin,
      orgId: org.id,
      messageKey,
      senderEmail,
      reason: "sender_unresolved",
    });
    return NextResponse.json({ ok: true, handled: "sender_unresolved" });
  }
  if (isOwnSender(senderEmail, ingestDomain)) {
    await insertDroppedAudit({
      admin,
      orgId: org.id,
      messageKey,
      senderEmail,
      reason: "own_sender",
    });
    return NextResponse.json({ ok: true, handled: "own_sender" });
  }

  const lead = await resolveLeadBySender(admin, org.id, senderEmail);
  const propertyAddress =
    one(lead?.property)?.address?.trim() || (lead ? "unmatched" : "unmatched");

  // Do NOT apply org_ingest_senders here. A renter is not a verified sender, and
  // this route relays plus stores metadata only; it never writes authoritative
  // lead facts from an untrusted email body.
  const audit = await insertReceivedAudit({
    admin,
    orgId: org.id,
    leadId: lead?.id ?? null,
    messageKey,
    senderEmail,
    matched: lead != null,
  });
  if (!audit.ok && audit.reason === "duplicate") {
    return NextResponse.json({ ok: true, handled: "duplicate", lead_id: lead?.id ?? null });
  }
  if (!audit.ok) {
    return new NextResponse("Storage error", { status: 503 });
  }

  const sinceIso = new Date(now() - 60 * 60 * 1000).toISOString();
  const orgRecent = await recentRelayCount({
    admin,
    orgId: org.id,
    sinceIso,
    limit: ORG_HOURLY_RELAY_LIMIT,
  });
  const leadRecent = lead
    ? await recentRelayCount({
        admin,
        orgId: org.id,
        leadId: lead.id,
        sinceIso,
        limit: LEAD_HOURLY_RELAY_LIMIT,
      })
    : 0;
  if (orgRecent >= ORG_HOURLY_RELAY_LIMIT || leadRecent >= LEAD_HOURLY_RELAY_LIMIT) {
    await updateAudit({
      admin,
      id: audit.id,
      status: "rate_limited",
      recipients: [],
    });
    return NextResponse.json({ ok: true, handled: "rate_limited", lead_id: lead?.id ?? null });
  }

  const fallback = await resolveOperatorFallback(admin, org);
  const rendered = relayCopy({
    lead,
    propertyAddress,
    senderEmail,
    subject,
    body,
  });
  const result: SendOrgNotificationResult = await relayNotification({
    client: admin,
    org: {
      id: org.id,
      name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: senderEmail,
    },
    eventKey: "leasing.new_lead",
    vars: {
      org_name: org.name ?? "",
      property_address: propertyAddress,
      lead_name: lead?.name?.trim() || "(unmatched renter)",
      lead_email: senderEmail,
      lead_phone: "(unknown)",
      move_in: "(not specified)",
      no_suitable_time_note: "",
      screening: "",
      dashboard_url: lead ? dashboardUrl(lead.id) : APP_URL,
    },
    operatorFallback: fallback,
    action: rendered.action,
    renderedOverride: { subject: rendered.subject, body: rendered.body },
  });

  if (!result.delivered) {
    await updateAudit({
      admin,
      id: audit.id,
      status: "relay_failed",
      recipients: result.recipients ?? [],
    });
    return new NextResponse("Relay failed", { status: 503 });
  }

  await updateAudit({
    admin,
    id: audit.id,
    status: "relayed",
    recipients: result.recipients ?? [],
  });
  if (lead) {
    await appendMatchedLeadMetadata({
      admin,
      orgId: org.id,
      lead,
      senderEmail,
      recipients: result.recipients ?? [],
    });
  }

  return NextResponse.json({
    ok: true,
    handled: "relayed",
    lead_id: lead?.id ?? null,
    matched: lead != null,
  });
}
