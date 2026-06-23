"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import {
  validateBuildingNoticeInput,
  composeNoticeBody,
  planBuildingEmailDeliveries,
  isBuildingSendable,
  buildingLabelFor,
  buildBuildingOptions,
  type BuildingTenancy,
} from "@/lib/building-notices";
import { renderForRecipient, type TenantContact, type TokenContext } from "@/lib/tenant-comms";
import { sendTenantMessageEmail } from "@/lib/email";

// Send an OUTBOUND building-wide tenant notice (S321): one operator-authored
// notice emailed to every tenant on every tenancy in the chosen building. The
// demand case is scheduled building work. Guarded on manage_tenancies (the same
// tenant-comms capability as per-tenancy messaging). REDIRECT-based (the S170
// revalidate-503 WATCH). The pure logic — recipient resolution, body
// composition, token substitution — lives in lib/building-notices +
// lib/tenant-comms; this action orchestrates the I/O (load the building's
// tenancies, send per recipient, log).
//
// Guardrail-neutral: operator -> tenant only, EMAIL only, no trade, no money.
// The operator always drafts + reviews + sends; nothing here auto-sends.

const BASE = "/dashboard/maintenance/notices";

function s(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

type DeliveryRow = {
  tenancy_id: string | null;
  tenant_id: string | null;
  tenant_name: string | null;
  property_address: string | null;
  destination: string | null;
  status: "sent" | "failed" | "skipped";
  reason: string | null;
};

export async function sendBuildingNotice(formData: FormData) {
  await requireCapability("manage_tenancies", `${BASE}?msg=forbidden`);

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");

  const buildingKey = s(formData, "building_key");
  const subject = s(formData, "subject");
  const body = s(formData, "body");
  const impact = s(formData, "impact") || null;

  const supabase = createClient();

  // Resolve the building's label (for the log snapshot) + all tenancies in it.
  // RLS scopes properties + tenancies to this org. building_key is a stored
  // generated column on properties (0049); the tenancies join brings the
  // tenants + the unit address for per-recipient {{tokens}}.
  const { data: propData } = await supabase
    .from("properties")
    .select("id, address, building_key");
  const buildingOptions = buildBuildingOptions(
    (propData ?? []) as { id: string; address: string; building_key: string | null }[],
  );
  const buildingLabel = buildingKey ? buildingLabelFor(buildingOptions, buildingKey) : "";

  const { data: tenData } = await supabase
    .from("tenancies")
    .select(
      "id, rent_cents, property:properties!inner(address, building_key), tenants(id, name, email, phone, sms_opt_out)",
    )
    .eq("property.building_key", buildingKey);

  const tenancies: BuildingTenancy[] = ((tenData ?? []) as unknown as {
    id: string;
    rent_cents: number | null;
    property: { address: string; building_key: string | null } | null;
    tenants: TenantContact[];
  }[]).map((t) => ({
    tenancyId: t.id,
    propertyAddress: t.property?.address ?? null,
    rentCents: t.rent_cents ?? null,
    tenants: t.tenants ?? [],
  }));

  const plan = planBuildingEmailDeliveries(tenancies);

  // Validate AFTER resolving recipients (recipientCount = sendable deliveries).
  const sendableCount = plan.filter(isBuildingSendable).length;
  const check = validateBuildingNoticeInput({
    buildingKey,
    subject,
    body,
    recipientCount: sendableCount,
  });
  if (!check.ok) redirect(`${BASE}?building=${encodeURIComponent(buildingKey)}&msg=${check.code}`);

  const composedBody = composeNoticeBody(check.value.body, impact);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const deliveries: DeliveryRow[] = [];
  const recipientTenants = new Set<string>();
  const recipientTenancies = new Set<string>();
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const d of plan) {
    recipientTenants.add(d.tenantId);
    recipientTenancies.add(d.tenancyId);

    if (!isBuildingSendable(d)) {
      skipped++;
      deliveries.push({
        tenancy_id: d.tenancyId,
        tenant_id: d.tenantId,
        tenant_name: d.tenantName,
        property_address: d.propertyAddress,
        destination: d.destination,
        status: "skipped",
        reason: d.skipReason ?? "skipped",
      });
      continue;
    }

    const ctx: TokenContext = {
      tenantName: d.tenantName,
      orgName: org.name,
      propertyAddress: d.propertyAddress,
      rentCents: d.rentCents,
      orgContactEmail: org.public_contact_email,
      orgContactPhone: org.public_contact_phone,
    };
    const renderedSubject = renderForRecipient(check.value.subject, ctx);
    const renderedBody = renderForRecipient(composedBody, ctx);

    const r = await sendTenantMessageEmail({
      tenant_email: d.destination as string,
      tenant_name: d.tenantName,
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
      tenancy_id: d.tenancyId,
      tenant_id: d.tenantId,
      tenant_name: d.tenantName,
      property_address: d.propertyAddress,
      destination: d.destination,
      status: r.sent ? "sent" : "failed",
      reason: r.reason ?? null,
    });
  }

  // Log the send: parent first, then the per-recipient delivery rows.
  const { data: noticeRow } = await supabase
    .from("building_notices")
    .insert({
      organization_id: org.id,
      building_key: check.value.buildingKey,
      building_label: buildingLabel || null,
      channel: "email",
      subject: check.value.subject,
      body: check.value.body,
      impact,
      recipient_tenancy_count: recipientTenancies.size,
      recipient_count: recipientTenants.size,
      sent_count: sent,
      failed_count: failed,
      skipped_count: skipped,
      sent_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (noticeRow?.id) {
    await supabase.from("building_notice_deliveries").insert(
      deliveries.map((d) => ({
        organization_id: org.id,
        notice_id: noticeRow.id,
        tenancy_id: d.tenancy_id,
        tenant_id: d.tenant_id,
        tenant_name: d.tenant_name,
        property_address: d.property_address,
        channel: "email",
        destination: d.destination,
        status: d.status,
        reason: d.reason,
      })),
    );
  }

  revalidatePath(BASE);
  const outcome = sent > 0 ? "sent" : failed > 0 ? "failed" : "noone";
  redirect(`${BASE}?msg=${outcome}&s=${sent}&k=${skipped}&f=${failed}`);
}
