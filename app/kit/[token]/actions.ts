"use server";

import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadPhoneMarketplaceContext, recordMarketplaceAd } from "@/lib/marketplace-kit-server";
import { normalizeUrl } from "@/lib/listing-distribution";
import { marketplacePhoneKitPath } from "@/lib/marketplace-kit";

// S736: the landlord saves the link to the Marketplace ad they posted from
// their phone. POST only, so a link scanner opening the page never writes. The
// signed token is checked again here; a bad or too-old token saves nothing.
export async function saveMarketplaceAdFromPhone(formData: FormData) {
  const token = String(formData.get("token") ?? "").trim();
  const back = (status: string) => `${marketplacePhoneKitPath(token)}?status=${status}`;
  const admin = createAdminClient();
  if (!admin || !token) redirect(back("invalid"));
  const loaded = await loadPhoneMarketplaceContext(admin, token, Date.now());
  if (!loaded.ok) redirect(back(loaded.reason === "too_old" ? "too_old" : "invalid"));
  const result = await recordMarketplaceAd(admin, {
    orgId: loaded.ctx.orgId,
    propertyId: loaded.ctx.property.id,
    url: normalizeUrl(formData.get("url")),
    agentName: "the landlord",
    note: "Posted from a phone with the Marketplace kit.",
  });
  redirect(back(result.ok ? "saved" : result.code));
}
