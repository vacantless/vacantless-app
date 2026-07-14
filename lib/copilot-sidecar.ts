import "server-only";

// No-install pop-out SIDECAR data loader (Lane C, S484). A same-origin companion
// window that gives an operator the browser co-pilot's channel-fit copy + the
// paste-the-live-URL completion WITHOUT installing the S483 Chrome extension.
//
// This module rebuilds the exact same pure CopilotScript the Distribute tab shows
// (app/dashboard/properties/[id]/page.tsx), for a SINGLE run item, so the sidecar
// route stays a thin presentational shell. It reuses the same pure libs
// (resolveEffectiveFeatures / resolveBuildingProfile / buildCopilotScript /
// buildTrackedLink / isPublicBookable) — no new server surface, no bridge, no
// nonce. Completion still flows through the existing completeCopilotPost action,
// which re-validates the URL and enforces the S482b proof-gate server-side.
//
// SECURITY: every id is derived from an RLS-scoped read. createClient() is scoped
// to the operator's org, so a foreign run item / property returns null and the
// loader returns null (the route 404s). The URL's propertyId is confirmed against
// the run's OWN property_id — never trusted on its own.

import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/org";
import { isPublicBookable, normalizePropertyStatus } from "@/lib/listing-state";
import {
  resolveEffectiveFeatures,
  resolveBuildingProfile,
  type PolicyProfile,
} from "@/lib/policy-profile";
import { buildTrackedLink } from "@/lib/listing-distribution";
import {
  normalizePublishChannel,
  publishChannelMeta,
  type PublishChannelKey,
} from "@/lib/distribution-publish";
import {
  buildCopilotScript,
  isCopilotChannel,
  type CopilotScript,
} from "@/lib/distribution-copilot";

export type CopilotSidecarData = {
  propertyId: string;
  itemId: string;
  channel: PublishChannelKey;
  channelLabel: string;
  script: CopilotScript;
};

type RunItemRow = {
  id: string;
  run_id: string;
  channel: string;
  listing_post_id: string | null;
  mode: string | null;
  publish_status: string | null;
};

type RunRow = { property_id: string | null; status: string | null };

type PropertyRow = {
  id: string;
  status: string | null;
  address: string | null;
  rent_cents: number | null;
  beds: number | null;
  baths: number | null;
  description: string | null;
  building_key: string | null;
  available_date: string | null;
  sqft: number | null;
  floor: string | null;
  parking: string | null;
  laundry: string | null;
  air_conditioning: boolean | null;
  balcony: boolean | null;
  furnished: boolean | null;
  pet_friendly: boolean | null;
  pets_cats: boolean | null;
  pets_dogs: boolean | null;
  pets_dog_size: string | null;
  pets_notes: string | null;
  heat_included: boolean | null;
  hydro_included: boolean | null;
  water_included: boolean | null;
  lease_term: string | null;
  smoking: string | null;
  ac_type: string | null;
  on_site_management: boolean | null;
};

/**
 * Load the co-pilot script for ONE run item, or null when the item can't be
 * shown as a sidecar (not found under RLS, wrong property, not a co-pilot
 * channel, no active run, or the item was handed to the concierge desk). Mirrors
 * the guards completeCopilotPost enforces so the sidecar never invites a post
 * the server would refuse to complete.
 */
export async function loadCopilotSidecar(input: {
  propertyId: string;
  itemId: string;
  publicUrl: string;
}): Promise<CopilotSidecarData | null> {
  const { propertyId, itemId, publicUrl } = input;
  if (!propertyId || !itemId) return null;

  const supabase = createClient();

  // 1) Run item (RLS). Derive its channel + tracker + run.
  const { data: itemRow } = await supabase
    .from("distribution_run_items")
    .select("id, run_id, channel, listing_post_id, mode, publish_status")
    .eq("id", itemId)
    .maybeSingle();
  const item = (itemRow ?? null) as RunItemRow | null;
  if (!item) return null;

  // Only the honest browser co-pilot channels have a sidecar.
  const channel = normalizePublishChannel(item.channel);
  if (!channel || !isCopilotChannel(channel)) return null;
  // An item handed to the concierge desk completes elsewhere.
  if (item.mode === "concierge") return null;

  // 2) The run is authoritative for property + active-ness (RLS).
  const { data: runRow } = await supabase
    .from("distribution_runs")
    .select("property_id, status")
    .eq("id", item.run_id)
    .maybeSingle();
  const run = (runRow ?? null) as RunRow | null;
  if (!run || run.status !== "active") return null;
  // Confirm the URL's property matches the run's OWN property (never trust the
  // path param on its own).
  if (!run.property_id || run.property_id !== propertyId) return null;

  // 3) Property (RLS) — the fields the copy + policy inheritance need.
  const { data: propRow } = await supabase
    .from("properties")
    .select(
      "id, status, address, rent_cents, beds, baths, description, building_key, available_date, sqft, floor, parking, laundry, air_conditioning, balcony, furnished, pet_friendly, pets_cats, pets_dogs, pets_dog_size, pets_notes, heat_included, hydro_included, water_included, lease_term, smoking, ac_type, on_site_management",
    )
    .eq("id", propertyId)
    .maybeSingle();
  const p = (propRow ?? null) as PropertyRow | null;
  if (!p) return null;

  const org = await getCurrentOrg();

  // 4) Policy inheritance (building over org), exactly as the Distribute tab does.
  const orgProfile: PolicyProfile | null = org
    ? {
        lease_term: org.policy_lease_term,
        smoking: org.policy_smoking,
        ac_type: org.policy_ac_type,
        on_site_management: org.policy_on_site_management,
        heat_included: org.policy_heat_included,
        hydro_included: org.policy_hydro_included,
        water_included: org.policy_water_included,
        pets_cats: org.policy_pets_cats,
        pets_dogs: org.policy_pets_dogs,
        pets_dog_size: org.policy_pets_dog_size,
      }
    : null;
  let buildingProfile: PolicyProfile | null = null;
  if (org && p.building_key) {
    const { data: bp } = await supabase
      .from("org_building_policies")
      .select(
        "policy_lease_term, policy_smoking, policy_ac_type, policy_on_site_management, policy_heat_included, policy_hydro_included, policy_water_included, policy_pets_cats, policy_pets_dogs, policy_pets_dog_size",
      )
      .eq("organization_id", org.id)
      .eq("building_key", p.building_key)
      .maybeSingle();
    if (bp) {
      buildingProfile = {
        lease_term: bp.policy_lease_term,
        smoking: bp.policy_smoking,
        ac_type: bp.policy_ac_type,
        on_site_management: bp.policy_on_site_management,
        heat_included: bp.policy_heat_included,
        hydro_included: bp.policy_hydro_included,
        water_included: bp.policy_water_included,
        pets_cats: bp.policy_pets_cats,
        pets_dogs: bp.policy_pets_dogs,
        pets_dog_size: bp.policy_pets_dog_size,
      };
    }
  }
  const policyProfile: PolicyProfile | null =
    orgProfile || buildingProfile
      ? resolveBuildingProfile(buildingProfile, orgProfile)
      : null;
  const { features: effectiveFeatures } = resolveEffectiveFeatures(
    {
      available_date: p.available_date,
      sqft: p.sqft,
      floor: p.floor,
      parking: p.parking,
      laundry: p.laundry,
      air_conditioning: p.air_conditioning,
      balcony: p.balcony,
      furnished: p.furnished,
      pet_friendly: p.pet_friendly,
      pets_cats: p.pets_cats,
      pets_dogs: p.pets_dogs,
      pets_dog_size: p.pets_dog_size,
      pets_notes: p.pets_notes,
      heat_included: p.heat_included,
      hydro_included: p.hydro_included,
      water_included: p.water_included,
      lease_term: p.lease_term,
      smoking: p.smoking,
      ac_type: p.ac_type,
      on_site_management: p.on_site_management,
    },
    policyProfile,
  );

  // 5) Tracked link — identical rule to page.tsx: a per-post tracked link when
  // the page is live AND the item already has a listing_post_id; else the bare
  // public URL when live; else null (the script surfaces a "publish first"
  // blocker, unchanged).
  const linkIsLive = isPublicBookable(normalizePropertyStatus(p.status ?? ""));
  const trackedUrl =
    linkIsLive && item.listing_post_id
      ? buildTrackedLink(publicUrl, item.listing_post_id)
      : linkIsLive
        ? publicUrl
        : null;

  const script = buildCopilotScript({
    channel,
    copy: {
      businessName: org?.name ?? null,
      address: p.address ?? "",
      rentCents: p.rent_cents,
      beds: p.beds,
      baths: p.baths,
      description: p.description,
      features: effectiveFeatures,
    },
    trackedUrl,
    publicPageLive: linkIsLive,
  });
  if (!script) return null;

  const channelLabel = publishChannelMeta(channel)?.label ?? script.channelLabel;

  return { propertyId, itemId, channel, channelLabel, script };
}
