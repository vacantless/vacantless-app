// S806: the reads behind lib/renter-emails (pure). One place for the
// inbound_portal_events and live-ad queries that Today, getting-started and the
// sites page share.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortalInboxEvent } from "./portal-inbox";
import { PORTAL_INBOX_ORDER } from "./portal-inbox";

export async function readRenterEmailEvents(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Pick<PortalInboxEvent, "source" | "outcome">[]> {
  const { data } = await supabase
    .from("inbound_portal_events")
    .select("source, outcome")
    .eq("organization_id", orgId)
    .in("outcome", ["lead_created", "duplicate", "scam_held"])
    .limit(50);
  return (data ?? []) as Pick<PortalInboxEvent, "source" | "outcome">[];
}

/** Kijiji, Rentals.ca and Zumper sites with at least one live ad on this account. */
export async function readLiveEmailSites(supabase: SupabaseClient, orgId: string): Promise<string[]> {
  const { data } = await supabase
    .from("listing_posts")
    .select("portal")
    .eq("organization_id", orgId)
    .eq("status", "live")
    .in("portal", PORTAL_INBOX_ORDER as string[]);
  return Array.from(new Set(((data ?? []) as { portal: string }[]).map((r) => String(r.portal))));
}
