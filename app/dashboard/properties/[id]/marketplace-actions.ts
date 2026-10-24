"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { requireCapability } from "@/lib/membership";
import { sendOrgNotification } from "@/lib/notifications-server";
import { agentMarketplaceKitPath, marketplacePhoneKitPath } from "@/lib/marketplace-kit";
import { phoneKitSecret, signPhoneKitToken } from "@/lib/marketplace-phone-link";
import { phoneKitEmail } from "@/lib/marketplace-phone-email";
import { sendNotificationEmail } from "@/lib/email";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com";

// S712: send a rental's Marketplace kit to one of the org's showing agents.
// The agent has no login; the email carries their stable agent token link to
// the kit page (app/agent/[token]/marketplace/[propertyId]). Org-scoped: both
// the rental and the agent must belong to the signed-in org.
export async function sendMarketplaceKit(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  const agentId = String(formData.get("agent_id") ?? "");
  if (!propertyId) return;
  const back = (q: string) => `/dashboard/properties/${propertyId}?tab=distribute&mkt=${q}#for-you-facebook`;
  if (!agentId) redirect(back("pick"));

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();

  const { data: prop } = await supabase
    .from("properties")
    .select("id, address")
    .eq("id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties?forbidden=1");

  const { data: agentRow } = await supabase
    .from("showing_agents")
    .select("id, name, email, agent_token, archived")
    .eq("id", agentId)
    .eq("organization_id", org.id)
    .maybeSingle();
  const agent = agentRow as
    | { id: string; name: string | null; email: string | null; agent_token: string | null; archived: boolean | null }
    | null;
  if (!agent || agent.archived || !agent.email || !agent.agent_token) redirect(back("noagent"));

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const address = (prop as { address: string | null }).address ?? "the rental";
  const kitUrl = `${APP_URL}${agentMarketplaceKitPath(agent.agent_token, propertyId)}`;
  const result = await sendOrgNotification({
    client: supabase,
    org: {
      id: org.id,
      name: org.name,
      brand_color: org.brand_color,
      logo_url: org.logo_url,
      reply_to_email: org.reply_to_email,
    },
    eventKey: "leasing.marketplace_kit",
    // The agent is the natural party and is always included (as with
    // leasing.showing_assigned); configured recipients are CC'd.
    audienceEmail: agent.email,
    vars: {
      org_name: org.name ?? "Your property manager",
      property_address: address,
      agent_name: (agent.name ?? "").trim() || "there",
      sent_by: org.name ?? user?.email ?? "Your landlord",
      kit_url: kitUrl,
    },
    action: { label: "Open the posting page", url: kitUrl },
  });

  revalidatePath(`/dashboard/properties/${propertyId}`);
  redirect(back(result.delivered ? "sent" : "notsent"));
}

// S736 (review item 9): email the signed-in landlord the no-sign-in link to
// this rental's Marketplace kit, so they can post from the Facebook app on
// their phone. Goes only to the person pressing the button, never to a renter.
export async function emailMarketplacePhoneLink(formData: FormData) {
  await requireCapability("manage_properties", "/dashboard/properties?forbidden=1");
  const propertyId = String(formData.get("property_id") ?? "");
  if (!propertyId) return;
  const back = (q: string) => `/dashboard/properties/${propertyId}?tab=distribute&mkt=${q}#for-you-facebook`;

  const org = await getCurrentOrg();
  if (!org) redirect("/onboarding");
  const supabase = createClient();
  const { data: prop } = await supabase
    .from("properties")
    .select("id, address")
    .eq("id", propertyId)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!prop) redirect("/dashboard/properties?forbidden=1");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const to = user?.email?.trim();
  const token = signPhoneKitToken({ propertyId, orgId: org.id, nowMs: Date.now() }, phoneKitSecret());
  if (!to || !token) redirect(back("mailfail"));

  const url = `${APP_URL}${marketplacePhoneKitPath(token)}`;
  const mail = phoneKitEmail({ address: (prop as { address: string | null }).address });
  const result = await sendNotificationEmail({
    to_email: to,
    subject: mail.subject,
    body: mail.body,
    action_label: "Open it on my phone",
    action_url: url,
    org_name: org.name ?? "Vacantless",
    brand_color: org.brand_color ?? null,
    logo_url: org.logo_url ?? null,
    reply_to_email: null,
  }).catch(() => ({ sent: false }));
  redirect(back(result.sent ? "mailed" : "mailfail"));
}
