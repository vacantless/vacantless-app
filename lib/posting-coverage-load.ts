// S754: loads what postingCoverage needs for one org (rentals list card and
// the health email). Kept out of page.tsx so the page holds no query text.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  optionalSiteReason,
  postingCoverage,
  type Coverage,
  type OptionalSiteReason,
} from "@/lib/posting-coverage";
import {
  buildChannelTileStatuses,
  type DistributionChannelAccountTileRow,
  type DistributionChannelSessionStatusRow,
} from "@/lib/distribution-channel-tile-statuses";
import { loadMadeRoom } from "@/lib/rentals-slots";

export async function loadPostingCoverage(
  supabase: SupabaseClient,
  orgId: string,
  postingAddon: boolean,
): Promise<Coverage> {
  const [{ data: props }, { data: posts }, { data: sessions }, madeRoom, { data: accounts }] = await Promise.all([
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
      .select(
        "channel, account_label, alive, cap_used, cap_total, last_checked_at, last_check_code, last_check_error, check_pending, stale, last_validated_at",
      )
      .eq("organization_id", orgId),
    loadMadeRoom(supabase, orgId),
    supabase
      .from("distribution_channel_accounts")
      .select(
        "channel, account_status, automation_authorized, external_account_label, spend_authorized, spend_max_cents, spend_revoked_at, capabilities",
      )
      .eq("organization_id", orgId),
  ]);
  // S805: a paid ad or a full free limit is the landlord's choice, not a gap.
  const optional = new Map<string, OptionalSiteReason>();
  for (const tile of buildChannelTileStatuses(
    (accounts ?? []) as DistributionChannelAccountTileRow[],
    (sessions ?? []) as DistributionChannelSessionStatusRow[],
  )) {
    const reason = optionalSiteReason(tile.channel, tile.costCap);
    if (reason) optional.set(tile.channel, reason);
  }
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
    optional,
  });
}
