"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadAgentMarketplaceContext, recordMarketplaceAd } from "@/lib/marketplace-kit-server";
import { normalizeUrl } from "@/lib/listing-distribution";
import { agentMarketplaceKitPath } from "@/lib/marketplace-kit";

// S712: a showing agent saves the link to the Marketplace ad they posted. POST
// only (a link scanner fetching the page never writes). The token and the
// rental are re-checked here; a wrong token or another org's rental saves
// nothing.
export async function saveMarketplaceAdFromToken(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const propertyId = String(formData.get("property_id") ?? "").trim();
  const back = (status: string) => `${agentMarketplaceKitPath(token, propertyId)}?status=${status}`;
  const admin = createAdminClient();
  if (!admin || !token || !propertyId) redirect("/agent/invalid?status=invalid");
  const ctx = await loadAgentMarketplaceContext(admin, token, propertyId);
  if (!ctx) redirect("/agent/invalid?status=invalid");
  const result = await recordMarketplaceAd(admin, {
    orgId: ctx.agent.organization_id,
    propertyId,
    url: normalizeUrl(formData.get("url")),
    agentName: ctx.agent.name,
  });
  redirect(back(result.ok ? "saved" : result.code));
}
