import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTrackedLink } from "@/lib/listing-distribution";
import { recordMarketplaceAd } from "@/lib/marketplace-kit-server";
import { roleCan } from "@/lib/roles";
import {
  helperReplyTemplate,
  marketplaceItemIdFrom,
  shortRentalName,
  type HelperAdEntry,
  type HelperCapturedAd,
} from "@/lib/marketplace-helper";

// S738: the server half of the helper's ad list and link capture. The caller
// (app/dashboard/marketplace-helper-actions.ts) has the signed-in user; this
// file works across every account they manage, because one person's
// Facebook profile posts for all of them (Agile and Davis Muscovitch Rentals).

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.vacantless.com").replace(/\/+$/, "");

/** The accounts this person may manage rentals in. */
export async function helperOrgIds(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await admin.from("memberships").select("organization_id, role").eq("user_id", userId);
  return ((data ?? []) as { organization_id: string | null; role: string | null }[])
    .filter((m) => m.organization_id && roleCan(m.role, "manage_properties"))
    .map((m) => m.organization_id as string);
}

/** Every live Marketplace ad in those accounts, with its rental and reply. */
export async function loadHelperAdList(admin: SupabaseClient, orgIds: string[]): Promise<HelperAdEntry[]> {
  if (orgIds.length === 0) return [];
  const { data: posts } = await admin
    .from("listing_posts")
    .select("id, organization_id, property_id, url, created_at")
    .in("organization_id", orgIds)
    .eq("portal", "facebook")
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = ((posts ?? []) as { id: string; organization_id: string; property_id: string | null; url: string | null }[])
    .map((p) => ({ ...p, itemId: marketplaceItemIdFrom(p.url) }))
    .filter((p) => p.itemId && p.property_id);
  if (rows.length === 0) return [];
  const propIds = Array.from(new Set(rows.map((r) => r.property_id as string)));
  const { data: props } = await admin
    .from("properties")
    .select("id, address, status, archived_at")
    .in("id", propIds);
  const { data: orgs } = await admin.from("organizations").select("id, public_contact_phone").in("id", orgIds);
  const propById = new Map(
    ((props ?? []) as { id: string; address: string | null; status: string | null; archived_at: string | null }[]).map((p) => [p.id, p]),
  );
  const phoneByOrg = new Map(
    ((orgs ?? []) as { id: string; public_contact_phone: string | null }[]).map((o) => [o.id, o.public_contact_phone]),
  );
  const seen = new Set<string>();
  const out: HelperAdEntry[] = [];
  for (const r of rows) {
    const itemId = r.itemId as string;
    if (seen.has(itemId)) continue; // newest row wins
    const prop = propById.get(r.property_id as string);
    if (!prop) continue;
    seen.add(itemId);
    const available = prop.status === "available" && !prop.archived_at;
    out.push({
      itemId,
      propertyId: prop.id,
      rental: shortRentalName(prop.address),
      available,
      reply: helperReplyTemplate({
        available,
        bookingUrl: buildTrackedLink(`${APP_URL}/r/${prop.id}`, r.id),
        phone: phoneByOrg.get(r.organization_id) ?? null,
      }),
    });
  }
  return out;
}

/**
 * Save the ad links the helper noted on the landlord's own new ads. Returns the
 * ad ids the helper may forget: saved now, or already in Vacantless. A rental
 * outside this person's accounts is skipped and kept by the helper for nothing
 * (it drops it after a day).
 */
export async function saveHelperCapturedAds(
  admin: SupabaseClient,
  orgIds: string[],
  items: HelperCapturedAd[],
): Promise<string[]> {
  const done: string[] = [];
  if (orgIds.length === 0) return done;
  for (const item of items) {
    const { data: prop } = await admin
      .from("properties")
      .select("id, organization_id")
      .eq("id", item.propertyId)
      .maybeSingle();
    const orgId = (prop as { organization_id?: string } | null)?.organization_id;
    if (!orgId || !orgIds.includes(orgId)) continue;
    const { data: existing } = await admin
      .from("listing_posts")
      .select("id")
      .eq("organization_id", orgId)
      .eq("portal", "facebook")
      .ilike("url", `%/marketplace/item/${item.itemId}%`)
      .limit(1);
    if ((existing ?? []).length > 0) {
      done.push(item.itemId);
      continue;
    }
    const res = await recordMarketplaceAd(admin, {
      orgId,
      propertyId: item.propertyId,
      url: `https://www.facebook.com/marketplace/item/${item.itemId}/`,
      agentName: "the Vacantless helper",
      note: "Saved by the Vacantless helper from the landlord's own new Marketplace ad.",
    });
    if (res.ok) done.push(item.itemId);
  }
  return done;
}
