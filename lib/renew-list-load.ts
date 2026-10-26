// S737: loads the old live ads for the Renew box on the rentals list
// (app/dashboard/properties/renew-list-card.tsx). Same rule as the "ads need
// a refresh" email (lib/listing-health). Kept out of page.tsx so the page
// holds no query text.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listingHealthChannels, renewListItems, type ListingHealthPost, type RenewListItem } from "@/lib/listing-health";
import { localDateString } from "@/lib/leasing-snapshot";

const POST_COLUMNS =
  "id, property_id, portal, label, url, status, posted_on, created_at, properties!inner(address, status, archived_at)";

type Row = {
  id: string;
  property_id: string;
  portal: string;
  label: string | null;
  url: string | null;
  status: string;
  posted_on: string | null;
  created_at: string | null;
  properties: { address: string | null } | { address: string | null }[] | null;
};

export async function loadRenewItems(
  supabase: SupabaseClient,
  orgId: string,
  timezone: string,
): Promise<RenewListItem[]> {
  const { data } = await supabase
    .from("listing_posts")
    .select(POST_COLUMNS)
    .eq("organization_id", orgId)
    .eq("status", "live")
    .eq("properties.status", "available")
    .is("properties.archived_at", null);
  const posts = ((data ?? []) as unknown as Row[]).map((r): ListingHealthPost => {
    const prop = Array.isArray(r.properties) ? r.properties[0] : r.properties;
    return {
      id: r.id,
      propertyId: r.property_id,
      address: prop?.address ?? null,
      portal: r.portal,
      label: r.label,
      status: r.status,
      url: r.url,
      postedOn: r.posted_on,
      createdAt: r.created_at,
      lastHealthAlertedAt: null,
    };
  });
  const nowISO = new Date().toISOString();
  return renewListItems(listingHealthChannels({ posts, today: localDateString(Date.now(), timezone), nowISO }), nowISO);
}
