"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { sendNotificationEmail } from "@/lib/email";
import { adminEmails } from "@/lib/provisioning-server";
import { brokerageRouteFor, validateBrokerageRequest } from "@/lib/brokerage-request";
import { brokerageRequestEmail } from "@/lib/brokerage-request-email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

// S735: a landlord asks for a Realtor.ca listing through a partner agent
// (Ontario) or a local agent (outside Ontario). The app records the request
// and emails the admins; a person answers it. Nothing here posts anywhere
// and no money moves through Vacantless (S594, S710).
export async function requestBrokerageListing(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;
  const back = (q: string) => `/dashboard/properties/${propertyId}?tab=distribute&brk=${q}#realtor-ca-request`;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();

  const { data: prop } = await supabase
    .from("properties")
    .select("id, address, rent_cents")
    .eq("id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties?forbidden=1");
  const property = prop as { id: string; address: string | null; rent_cents: number | null };

  const check = validateBrokerageRequest({
    contactName: formData.get("contact_name"),
    contactPhone: formData.get("contact_phone"),
    contactEmail: formData.get("contact_email"),
    note: formData.get("note"),
  });
  if (!check.ok) redirect(back(check.field));

  const route = brokerageRouteFor(property.address);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase.from("brokerage_requests").insert({
    organization_id: org.id,
    property_id: property.id,
    kind: route.kind,
    province: route.province,
    contact_name: check.values.contactName || null,
    contact_phone: check.values.contactPhone || null,
    contact_email: check.values.contactEmail || null,
    note: check.values.note || null,
    requested_by: user?.id ?? null,
  });
  if (error) redirect(back("error"));

  const mail = brokerageRequestEmail({
    kind: route.kind,
    province: route.province,
    orgName: org.name ?? null,
    orgId: org.id,
    propertyId: property.id,
    address: property.address,
    rentCents: property.rent_cents,
    requesterEmail: user?.email ?? null,
    values: check.values,
    appUrl: APP_URL,
  });
  for (const to of adminEmails()) {
    await sendNotificationEmail({
      to_email: to,
      subject: mail.subject,
      body: mail.body,
      org_name: "Vacantless",
      brand_color: null,
      logo_url: null,
      reply_to_email: check.values.contactEmail || null,
    }).catch(() => null);
  }

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(back("sent"));
}
