import {
  applySmsEntitlement,
  buildTenantSmsBody,
  isSendable,
  planDeliveries,
  renderForRecipient,
  type MessageChannel,
  type TenantContact,
  type TokenContext,
} from "@/lib/tenant-comms";
import { canUseSms } from "@/lib/billing";
import { sendTenantMessageEmail } from "@/lib/email";
import { sendSms, smsLive } from "@/lib/sms";

type SupabaseClientLike = {
  from: (table: string) => any;
};

export type TenantCommsDispatchOrg = {
  id: string;
  name: string | null;
  plan: string;
  sms_enabled: boolean | null;
  brand_color: string | null;
  logo_url: string | null;
  reply_to_email: string | null;
  public_contact_email: string | null;
  public_contact_phone: string | null;
};

type DeliveryRow = {
  tenant_id: string | null;
  tenant_name: string | null;
  channel: "email" | "sms";
  destination: string | null;
  status: "sent" | "failed" | "skipped";
  reason: string | null;
};

export async function dispatchTenantMessage(args: {
  supabase: SupabaseClientLike;
  org: TenantCommsDispatchOrg;
  tenancyId: string;
  channel: MessageChannel;
  subject: string | null;
  body: string;
  recipientIds: string[];
  sentBy: string | null;
}): Promise<{
  ok: boolean;
  messageId: string | null;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const { supabase, org, tenancyId, channel, subject, body, recipientIds, sentBy } = args;

  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, property:properties(address), tenants(id, name, email, phone, sms_opt_out)",
    )
    .eq("id", tenancyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!data) {
    return { ok: false, messageId: null, sent: 0, failed: 0, skipped: 0 };
  }

  const row = data as unknown as {
    id: string;
    rent_cents: number | null;
    property: { address: string } | { address: string }[] | null;
    tenants: TenantContact[] | null;
  };
  const tenants = row.tenants ?? [];
  const selectedSet = new Set(
    recipientIds.filter((id) => tenants.some((t) => t.id === id)),
  );

  const smsEntitled = canUseSms(org.plan);
  const smsAllowed = org.sms_enabled === true && smsEntitled && smsLive();
  const plan = applySmsEntitlement(
    planDeliveries(channel, tenants, selectedSet),
    smsAllowed,
  );
  const propertyRel = Array.isArray(row.property) ? row.property[0] : row.property;
  const propertyAddress = propertyRel?.address ?? null;
  const rentCents = row.rent_cents ?? null;
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const deliveries: DeliveryRow[] = [];
  const recipientTenants = new Set<string>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const d of plan) {
    recipientTenants.add(d.tenantId);
    const tenant = tenantById.get(d.tenantId);
    const ctx: TokenContext = {
      tenantName: tenant?.name ?? null,
      orgName: org.name,
      propertyAddress,
      rentCents,
      orgContactEmail: org.public_contact_email,
      orgContactPhone: org.public_contact_phone,
    };

    if (!isSendable(d)) {
      skipped++;
      deliveries.push({
        tenant_id: d.tenantId,
        tenant_name: d.tenantName,
        channel: d.channel,
        destination: d.destination,
        status: "skipped",
        reason: d.skipReason ?? "skipped",
      });
      continue;
    }

    if (d.channel === "email") {
      const renderedSubject = renderForRecipient(subject ?? "", ctx);
      const renderedBody = renderForRecipient(body, ctx);
      const result = await sendTenantMessageEmail({
        tenant_email: d.destination as string,
        tenant_name: tenant?.name ?? null,
        org_name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
        subject: renderedSubject,
        body: renderedBody,
      });
      if (result.sent) sent++;
      else failed++;
      deliveries.push({
        tenant_id: d.tenantId,
        tenant_name: d.tenantName,
        channel: "email",
        destination: d.destination,
        status: result.sent ? "sent" : "failed",
        reason: result.reason ?? null,
      });
    } else {
      const renderedBody = renderForRecipient(body, ctx);
      const smsBody = buildTenantSmsBody(renderedBody, org.name);
      const result = await sendSms({ to: d.destination, body: smsBody });
      if (result.sent) sent++;
      else failed++;
      deliveries.push({
        tenant_id: d.tenantId,
        tenant_name: d.tenantName,
        channel: "sms",
        destination: d.destination,
        status: result.sent ? "sent" : "failed",
        reason: result.reason ?? null,
      });
    }
  }

  const { data: msgRow } = await supabase
    .from("tenant_messages")
    .insert({
      organization_id: org.id,
      tenancy_id: tenancyId,
      channel,
      subject,
      body,
      recipient_count: recipientTenants.size,
      sent_count: sent,
      failed_count: failed,
      skipped_count: skipped,
      sent_by: sentBy,
    })
    .select("id")
    .single();

  const messageId = (msgRow as { id?: string } | null)?.id ?? null;
  if (messageId && deliveries.length > 0) {
    await supabase.from("tenant_message_deliveries").insert(
      deliveries.map((d) => ({
        organization_id: org.id,
        message_id: messageId,
        tenant_id: d.tenant_id,
        tenant_name: d.tenant_name,
        channel: d.channel,
        destination: d.destination,
        status: d.status,
        reason: d.reason,
      })),
    );
  }

  return { ok: true, messageId, sent, failed, skipped };
}
