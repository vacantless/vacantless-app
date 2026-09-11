// Which syndication channels this surface may show, measured across the whole
// product rather than inside one organization.
//
// WHY THE ADMIN CLIENT. "Rentals.ca works" is a claim about the product, and
// the evidence for it lives in other customers' rows. An RLS-scoped read would
// make every new landlord see an empty list on their first day, which is not
// the honest answer, it is just a different wrong one. The read is aggregate
// only: channel, result, type, date, transport and organization id. No address,
// no rent, no ad content, and nothing is returned to the browser except a list
// of channel keys.
//
// DEGRADES CLOSED. No admin client, or a failed read, returns null, and the
// caller renders the surface unfiltered. A missing service key must never
// silently empty a landlord's screen.
import { createAdminClient } from "@/lib/supabase/admin";
import {
  channelEvidence,
  shownChannels,
  NON_PRODUCTION_ORGANIZATION_IDS,
  type ChannelLivePostRow,
  type ChannelVerificationRow,
} from "@/lib/channel-provenness";

type VerificationQueryRow = {
  channel: string | null;
  result: string | null;
  verification_type: string | null;
  checked_by: string | null;
  checked_at: string | null;
  organization_id: string | null;
  // The embed comes back as an array even on a to-one relation.
  distribution_run_items: { transport: string | null }[] | null;
};

type LivePostQueryRow = {
  portal: string | null;
  url: string | null;
  organization_id: string | null;
};

/**
 * The channel keys a landlord may see, or null when the measurement could not
 * be made. Null means "show everything", never "show nothing".
 */
export async function loadShownChannelKeys(asOf: string): Promise<string[] | null> {
  const supabase = createAdminClient();
  if (!supabase) return null;

  const [verifRes, postRes] = await Promise.all([
    supabase
      .from("distribution_verifications")
      .select("channel, result, verification_type, checked_by, checked_at, organization_id, distribution_run_items(transport)")
      .eq("result", "verified_live"),
    supabase
      .from("listing_posts")
      .select("portal, url, organization_id")
      .eq("status", "live"),
  ]);
  if (verifRes.error || postRes.error) return null;

  const verifications: ChannelVerificationRow[] = ((verifRes.data ?? []) as VerificationQueryRow[])
    .filter((r): r is VerificationQueryRow & { channel: string; checked_at: string } =>
      typeof r.channel === "string" && typeof r.checked_at === "string")
    .map((r) => ({
      channel: r.channel,
      result: r.result ?? "",
      verificationType: r.verification_type ?? "",
      checkedBy: r.checked_by,
      checkedOn: r.checked_at.slice(0, 10),
      transport: r.distribution_run_items?.[0]?.transport ?? null,
      organizationId: r.organization_id,
    }));

  const livePosts: ChannelLivePostRow[] = ((postRes.data ?? []) as LivePostQueryRow[])
    .filter((r): r is LivePostQueryRow & { portal: string } => typeof r.portal === "string")
    .map((r) => ({
      channel: r.portal,
      organizationId: r.organization_id,
      hasUrl: typeof r.url === "string" && r.url.trim().length > 0,
    }));

  return shownChannels(
    channelEvidence({
      verifications,
      livePosts,
      asOf,
      testOrganizationIds: NON_PRODUCTION_ORGANIZATION_IDS,
    }),
  );
}
