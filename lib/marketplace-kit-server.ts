import type { SupabaseClient } from "@supabase/supabase-js";
import { validateListingPost } from "@/lib/listing-distribution";
import { recordVerificationAndAttempt } from "@/lib/distribution-verification-write";
import { closeStaleConciergeItems } from "@/lib/concierge-stale-close-server";

// S712: a showing agent pasted the link to the Marketplace ad they posted from
// the no-login kit page. Record it the same way a landlord's "Save the link to
// your ad" does (app/dashboard/properties/actions.ts addListingPost): a live
// listing_posts row, then the rental's Marketplace run item follows it with
// live proof, and any stale desk request for the same site is closed. Runs
// with the service-role client; the caller has already proved the agent token
// belongs to the same org as the property.

export type RecordMarketplaceAdResult =
  | { ok: true; listingPostId: string | null }
  | { ok: false; code: string };

export async function recordMarketplaceAd(
  admin: SupabaseClient,
  input: { orgId: string; propertyId: string; url: string | null; agentName: string },
): Promise<RecordMarketplaceAdResult> {
  const portal = "facebook";
  const check = validateListingPost({ portal, status: "live", url: input.url });
  if (!check.ok) return { ok: false, code: check.code };
  const url = input.url as string;

  const { data: inserted, error } = await admin
    .from("listing_posts")
    .insert({
      organization_id: input.orgId,
      property_id: input.propertyId,
      portal,
      label: null,
      url,
      status: "live",
      posted_on: new Date().toISOString().slice(0, 10),
      notes: `Posted by ${input.agentName} from the Marketplace kit.`,
    })
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, code: "save_failed" };
  const listingPostId = (inserted?.id as string | undefined) ?? null;

  // Follow it on the rental's newest active run, when there is one.
  const { data: run } = await admin
    .from("distribution_runs")
    .select("id")
    .eq("property_id", input.propertyId)
    .eq("organization_id", input.orgId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const runId = (run?.id as string | undefined) ?? null;
  if (runId) {
    const { data: item } = await admin
      .from("distribution_run_items")
      .select("id, publish_status")
      .eq("run_id", runId)
      .eq("channel", portal)
      .maybeSingle();
    if (item && item.publish_status !== "live") {
      const now = new Date().toISOString();
      const verId = await recordVerificationAndAttempt(admin, {
        orgId: input.orgId,
        userId: null,
        channel: portal,
        verificationType: "external_url",
        result: "verified_live",
        propertyId: input.propertyId,
        runId,
        runItemId: item.id as string,
        listingPostId,
        transport: null,
        externalUrl: url,
        screenshotPath: null,
        matchedFields: { operatorConfirmed: true },
        failureReason: null,
        actorType: "operator",
        nowISO: now,
      });
      if (verId) {
        await admin
          .from("distribution_run_items")
          .update({
            status: "done",
            publish_status: "live",
            external_url: url,
            listing_post_id: listingPostId,
            last_verified_at: now,
            error_code: null,
            error_message: null,
            updated_at: now,
          })
          .eq("id", item.id as string);
      }
    }
  }
  await closeStaleConciergeItems(admin, {
    organizationId: input.orgId,
    propertyId: input.propertyId,
    trigger: "already_live",
    channel: portal,
  });
  return { ok: true, listingPostId };
}

// S712: everything the agent's no-login kit page needs, resolved from the
// agent token. The property must belong to the same org as the agent, and an
// archived agent sees nothing. Renter data is never read here.
export type AgentMarketplaceContext = {
  agent: { id: string; name: string; organization_id: string };
  org: {
    name: string | null;
    brand_color: string | null;
    brand_color_secondary: string | null;
    public_contact_phone: string | null;
  };
  property: {
    id: string;
    address: string;
    rent_cents: number | null;
    beds: number | null;
    baths: number | null;
    sqft: number | null;
    description: string | null;
    available_date: string | null;
    heating_type: string | null;
    security_deposit_cents: number | null;
  };
  photos: { id: string; url: string; sort_order: number; is_cover: boolean }[];
  liveUrl: string | null;
};

export async function loadAgentMarketplaceContext(
  admin: SupabaseClient,
  token: string,
  propertyId: string,
): Promise<AgentMarketplaceContext | null> {
  if (!token || !propertyId) return null;
  const { data: agentData } = await admin
    .from("showing_agents")
    .select(
      "id, name, archived, organization_id, organization:organizations(name, brand_color, brand_color_secondary, public_contact_phone)",
    )
    .eq("agent_token", token)
    .maybeSingle();
  const agent = agentData as unknown as {
    id: string;
    name: string | null;
    archived: boolean | null;
    organization_id: string;
    organization: AgentMarketplaceContext["org"] | null;
  } | null;
  if (!agent || agent.archived) return null;

  const { data: prop } = await admin
    .from("properties")
    .select("id, address, rent_cents, beds, baths, sqft, description, available_date, heating_type, security_deposit_cents")
    .eq("id", propertyId)
    .eq("organization_id", agent.organization_id)
    .maybeSingle();
  if (!prop) return null;

  const [{ data: photos }, { data: posts }] = await Promise.all([
    admin
      .from("property_photos")
      .select("id, url, sort_order, is_cover")
      .eq("property_id", propertyId)
      .eq("organization_id", agent.organization_id),
    admin
      .from("listing_posts")
      .select("url, created_at")
      .eq("property_id", propertyId)
      .eq("organization_id", agent.organization_id)
      .eq("portal", "facebook")
      .eq("status", "live")
      .order("created_at", { ascending: false })
      .limit(1),
  ]);

  return {
    agent: {
      id: agent.id,
      name: (agent.name ?? "").trim() || "there",
      organization_id: agent.organization_id,
    },
    org: agent.organization ?? {
      name: null,
      brand_color: null,
      brand_color_secondary: null,
      public_contact_phone: null,
    },
    property: prop as AgentMarketplaceContext["property"],
    photos: (photos ?? []) as AgentMarketplaceContext["photos"],
    liveUrl: ((posts ?? [])[0]?.url as string | undefined) ?? null,
  };
}
