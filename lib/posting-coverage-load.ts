// S754: loads what postingCoverage needs for one org (rentals list card and
// the health email). Kept out of page.tsx so the page holds no query text.
import type { SupabaseClient } from "@supabase/supabase-js";
import { postingCoverage, type Coverage } from "@/lib/posting-coverage";
import { loadMadeRoom } from "@/lib/rentals-slots";

export async function loadPostingCoverage(
  supabase: SupabaseClient,
  orgId: string,
  postingAddon: boolean,
): Promise<Coverage> {
  const [{ data: props }, { data: posts }, { data: sessions }, madeRoom] = await Promise.all([
    supabase
      .from("properties")
      .select("id, address, status")
      .eq("organization_id", orgId)
      .eq("status", "available")
      .is("archived_at", null),
    supabase
      .from("listing_posts")
      .select("property_id, portal, status")
      .eq("organization_id", orgId)
      .eq("status", "live"),
    supabase
      .from("distribution_channel_session_status")
      .select("channel, alive")
      .eq("organization_id", orgId),
    loadMadeRoom(supabase, orgId),
  ]);
  return postingCoverage({
    properties: ((props ?? []) as { id: string; address: string | null; status: string | null }[]),
    posts: ((posts ?? []) as { property_id: string; portal: string; status: string | null }[]).map((p) => ({
      propertyId: p.property_id,
      portal: p.portal,
      status: p.status,
    })),
    sessions: (sessions ?? []) as { channel: string; alive: boolean | null }[],
    postingAddon,
    madeRoom,
  });
}
