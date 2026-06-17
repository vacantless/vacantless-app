"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  validateMessageInput,
  planDeliveries,
  isSendable,
  renderForRecipient,
  buildTenantSmsBody,
  type TenantContact,
  type TokenContext,
} from "@/lib/tenant-comms";
import { sendTenantMessageEmail } from "@/lib/email";
import { sendSms } from "@/lib/sms";

// Send a landlord -> tenant message (platform pivot step 3). Guarded on
// manage_tenancies (the post-lease property-management capability, same as the
// rest of the tenancy CRUD + the manual payment ledger). REDIRECT-based (the
// S170 revalidate-503 WATCH). The pure logic — channel fan-out, recipient
// resolution, token substitution, SMS body assembly — lives in lib/tenant-comms;
// this action just orchestrates the I/O (load tenancy, send per channel, log).
//
// Every send is logged: one tenant_messages parent + one
// tenant_message_deliveries row per (tenant x channel) attempt, recording the
// outcome (sent / failed / skipped) so the tenancy history is a real audit trail.

const BASE = "/dashboard/tenancies";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
function tenancyPath(id: string): string {
  return `${BASE}/${id}`;
}

type DeliveryRow = {
  tenant_id: string | null;
  tenant_name: string | null;
  channel: "email" | "sms";
  destination: string | null;
  status: "sent" | "failed" | "skipped";
  reason: string | null;
};

export async function sendTenantMessage(formData: FormData) {
  const tenancyId = s(formData, "tenancy_id");
  if (!tenancyId) redirect(BASE);
  await requireCapability("manage_tenancies", `${tenancyPath(tenancyId)}?msg=forbidden`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const channel = s(formData, "channel");
  const subject = s(formData, "subject") || null;
  const body = s(formData, "body");
  const selectedRaw = formData.getAll("recipient_ids").map((v) => String(v));

  const supabase = createClient();
  // Load the tenancy with its tenants + property address (for {{tokens}}). RLS
  // scopes to this org; a missing row means not-ours / deleted.
  const { data } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, property:properties(address), tenants(id, name, email, phone, sms_opt_out)",
    )
    .eq("id", tenancyId)
    .maybeSingle();
  if (!data) redirect(BASE);

  const row = data as unknown as {
    id: string;
    rent_cents: number | null;
    property: { address: string } | null;
    tenants: TenantContact[];
  };
  const tenants = row.tenants ?? [];

  // Only keep selected ids that are real tenants on this tenancy.
  const selectedSet = new Set(
    selectedRaw.filter((id) => tenants.some((t) => t.id === id)),
  );

  const check = validateMessageInput({
    channel,
    subject,
    body,
    recipientCount: selectedSet.size,
  });
  if (!check.ok) redirect(`${tenancyPath(tenancyId)}?msg=${check.code}`);

  const plan = planDeliveries(check.value.channel, tenants, selectedSet);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const propertyAddress = row.property?.address ?? null;
  const rentCents = row.rent_cents ?? null;
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const deliveries: DeliveryRow[] = [];
  const recipientTenants = new Set<string>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const d of plan) {
    recipientTenants.add(d.tenantId);
    const t = tenantById.get(d.tenantId);
    const ctx: TokenContext = {
      tenantName: t?.name ?? null,
      orgName: org.name,
      propertyAddress,
      rentCents,
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
      const renderedSubject = renderForRecipient(check.value.subject ?? "", ctx);
      const renderedBody = renderForRecipient(check.value.body, ctx);
      const r = await sendTenantMessageEmail({
        tenant_email: d.destination as string,
        tenant_name: t?.name ?? null,
        org_name: org.name,
        brand_color: org.brand_color,
        logo_url: org.logo_url,
        reply_to_email: org.reply_to_email,
        subject: renderedSubject,
        body: renderedBody,
      });
      if (r.sent) sent++;
      else failed++;
      deliveries.push({
        tenant_id: d.tenantId,
        tenant_name: d.tenantName,
        channel: "email",
        destination: d.destination,
        status: r.sent ? "sent" : "failed",
        reason: r.reason ?? null,
      });
    } else {
      const renderedBody = renderForRecipient(check.value.body, ctx);
      const smsBody = buildTenantSmsBody(renderedBody, org.name);
      const r = await sendSms({ to: d.destination, body: smsBody });
      if (r.sent) sent++;
      else failed++;
      deliveries.push({
        tenant_id: d.tenantId,
        tenant_name: d.tenantName,
        channel: "sms",
        destination: d.destination,
        status: r.sent ? "sent" : "failed",
        reason: r.reason ?? null,
      });
    }
  }

  // Log the send: parent first, then the per-recipient delivery rows.
  const { data: msgRow } = await supabase
    .from("tenant_messages")
    .insert({
      organization_id: org.id,
      tenancy_id: tenancyId,
      channel: check.value.channel,
      subject: check.value.subject,
      body: check.value.body,
      recipient_count: recipientTenants.size,
      sent_count: sent,
      failed_count: failed,
      skipped_count: skipped,
      sent_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (msgRow?.id) {
    await supabase.from("tenant_message_deliveries").insert(
      deliveries.map((d) => ({
        organization_id: org.id,
        message_id: msgRow.id,
        tenant_id: d.tenant_id,
        tenant_name: d.tenant_name,
        channel: d.channel,
        destination: d.destination,
        status: d.status,
        reason: d.reason,
      })),
    );
  }

  revalidatePath(tenancyPath(tenancyId));
  // Outcome: something sent -> success; else if any failed -> failed; else
  // everyone was skipped (no usable address / all opted out).
  const outcome = sent > 0 ? "sent" : failed > 0 ? "failed" : "noone";
  redirect(
    `${tenancyPath(tenancyId)}?msg=${outcome}&s=${sent}&k=${skipped}&f=${failed}`,
  );
}
