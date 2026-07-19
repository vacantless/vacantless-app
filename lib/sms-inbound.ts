import type { SupabaseClient } from "@supabase/supabase-js";
import { classifyInbound, normalizePhoneE164 } from "./sms";

type SmsInboundClient = Pick<SupabaseClient, "from">;

type LeadMatch = {
  id: string;
  organization_id: string | null;
  sms_opt_out?: boolean | null;
};

type TenantMatch = {
  id: string;
  sms_opt_out?: boolean | null;
};

export type ApplyInboundSmsResult = {
  action: "stop" | "start" | "reply" | "ignored";
  senderE164: string | null;
  matchedLeads: number;
  matchedTenants: number;
  updatedLeads: number;
  updatedTenants: number;
  messagesInserted: number;
  reason?: "invalid_sender" | "empty_body";
};

export type ApplyInboundSmsInput = {
  from: string | null | undefined;
  body: string | null | undefined;
};

const MAX_INBOUND_REPLY_BODY = 4000;

function cleanBody(body: string | null | undefined): string {
  return (body || "").trim().slice(0, MAX_INBOUND_REPLY_BODY);
}

function optOutMessageBody(action: "stop" | "start", body: string): string {
  if (action === "start") return "Renter texted START \u2014 opted back in to SMS";
  const keyword = body.trim().toUpperCase().split(/\s+/)[0] || "STOP";
  return `Renter texted ${keyword} \u2014 opted out of SMS`;
}

const ignored = (
  reason: ApplyInboundSmsResult["reason"],
  senderE164: string | null,
): ApplyInboundSmsResult => ({
  action: "ignored",
  senderE164,
  matchedLeads: 0,
  matchedTenants: 0,
  updatedLeads: 0,
  updatedTenants: 0,
  messagesInserted: 0,
  reason,
});

export async function applyInboundSms(
  admin: SmsInboundClient,
  input: ApplyInboundSmsInput,
): Promise<ApplyInboundSmsResult> {
  const senderE164 = normalizePhoneE164(input.from);
  if (!senderE164) return ignored("invalid_sender", null);

  const body = cleanBody(input.body);
  if (!body) return ignored("empty_body", senderE164);

  const action = classifyInbound(body);

  const { data: leadRows } = await admin
    .from("leads")
    .select("id, organization_id, sms_opt_out")
    .eq("phone_e164", senderE164);
  const leads = ((leadRows ?? []) as LeadMatch[]).filter((l) => l.id);

  const base = {
    senderE164,
    matchedLeads: leads.length,
    matchedTenants: 0,
    updatedLeads: 0,
    updatedTenants: 0,
    messagesInserted: 0,
  };

  if (!action) {
    const rows = leads
      .filter((l) => l.organization_id)
      .map((l) => ({
        organization_id: l.organization_id,
        lead_id: l.id,
        channel: "sms",
        direction: "inbound",
        body,
      }));
    if (rows.length > 0) {
      await admin.from("messages").insert(rows);
    }
    return {
      ...base,
      action: "reply",
      messagesInserted: rows.length,
    };
  }

  const optOut = action === "stop";
  const leadIds = leads
    .filter((l) => Boolean(l.sms_opt_out) !== optOut)
    .map((l) => l.id);

  if (leadIds.length > 0) {
    await admin
      .from("leads")
      .update({
        sms_opt_out: optOut,
        sms_opt_out_at: optOut ? new Date().toISOString() : null,
      })
      .in("id", leadIds);

    const rows = leads
      .filter((l) => leadIds.includes(l.id) && l.organization_id)
      .map((l) => ({
        organization_id: l.organization_id,
        lead_id: l.id,
        channel: "sms",
        direction: "inbound",
        body: optOutMessageBody(action, body),
      }));
    if (rows.length > 0) {
      await admin.from("messages").insert(rows);
    }
    base.updatedLeads = leadIds.length;
    base.messagesInserted = rows.length;
  }

  // Tenant comms have no lead-style timeline, but their opt-out flags must stay
  // in sync with STOP/START so later tenant SMS paths skip correctly.
  const { data: tenantRows } = await admin
    .from("tenants")
    .select("id, sms_opt_out")
    .eq("phone_e164", senderE164);
  const tenants = ((tenantRows ?? []) as TenantMatch[]).filter((t) => t.id);
  const tenantIds = tenants
    .filter((t) => Boolean(t.sms_opt_out) !== optOut)
    .map((t) => t.id);

  if (tenantIds.length > 0) {
    await admin
      .from("tenants")
      .update({
        sms_opt_out: optOut,
        sms_opt_out_at: optOut ? new Date().toISOString() : null,
      })
      .in("id", tenantIds);
  }

  return {
    ...base,
    action,
    matchedTenants: tenants.length,
    updatedTenants: tenantIds.length,
  };
}
