import type { SupabaseClient } from "@supabase/supabase-js";
import { generateSlots, type Availability } from "@/lib/booking";
import { sortPhotos } from "@/lib/photos";
import { buildReplyKitCards, longDayLabel, nextTimesLabel, type ReplyKitCard, type ReplyKitPost, type ReplyKitProperty } from "@/lib/reply-kit";
import type { UnitFeatures } from "@/lib/property-features";
import {
  POLICY_PROFILE_COLUMNS,
  policyProfileFromRow,
  resolveBuildingProfile,
  resolveEffectiveFeatures,
  type PolicyProfile,
} from "@/lib/policy-profile";

// S817b: the Quick replies cards, loaded once for both the Quick replies page
// and "Send to Vacantless" (which copies the same reply the page would). The
// page passes the signed-in client (RLS); the Shortcut route passes the
// service client, so every read here is scoped to orgId on its own.
export async function loadReplyKitCards(
  supabase: SupabaseClient,
  rpcClient: SupabaseClient,
  orgId: string,
  appUrl: string,
  opts: { propertyIds?: string[] } = {},
): Promise<ReplyKitCard[]> {
  let propQuery = supabase
    .from("properties")
    .select("id, address, rent_cents, beds, baths, status, archived_at, unit_type")
    .eq("organization_id", orgId)
    .is("archived_at", null);
  if (opts.propertyIds) propQuery = propQuery.in("id", opts.propertyIds);
  const { data: propRows } = await propQuery.limit(200);
  const properties = (propRows ?? []) as ReplyKitProperty[];

  const { data: postRows } = await supabase
    .from("listing_posts")
    .select("id, property_id, portal, status")
    .eq("organization_id", orgId)
    .eq("status", "live")
    .limit(500);
  const posts = (postRows ?? []) as ReplyKitPost[];

  const timesByProperty = new Map<string, { hasViewingTimes: boolean; nextTimes: string | null }>();
  await Promise.all(
    properties
      .filter((p) => p.status === "available")
      .map(async (p) => {
        try {
          const { data, error } = await rpcClient.rpc("get_public_availability", { p_property_id: p.id });
          if (error || !data) return;
          const days = generateSlots(data as Availability);
          timesByProperty.set(p.id, {
            hasViewingTimes: days.some((d) => d.slots.length > 0),
            nextTimes: nextTimesLabel(days, longDayLabel),
          });
        } catch {
          // Keep the default wording when times can't be read.
        }
      }),
  );

  // S750: the chat shows the ad's first photo, so each card shows the cover.
  const propIds = properties.map((p) => p.id);
  const { data: photoRows } = propIds.length
    ? await supabase
        .from("property_photos")
        .select("id, property_id, url, sort_order, is_cover")
        .in("property_id", propIds)
        .limit(2000)
    : { data: [] };
  const photosByProperty = new Map<string, string[]>();
  const grouped = new Map<string, { id: string; url: string; sort_order: number; is_cover: boolean }[]>();
  for (const r of (photoRows ?? []) as { id: string; property_id: string; url: string; sort_order: number; is_cover: boolean }[]) {
    const list = grouped.get(r.property_id) ?? [];
    list.push(r);
    grouped.set(r.property_id, list);
  }
  for (const [id, list] of Array.from(grouped.entries())) {
    photosByProperty.set(id, sortPhotos(list).map((ph) => ph.url).filter(Boolean).slice(0, 3));
  }

  // S812: the facts behind "Answer a question". Each rental's own details with
  // the account and building defaults filled in (the same merge as the rental
  // page). Read on its own so a failed read only hides the answers.
  const featuresByProperty = new Map<string, UnitFeatures>();
  const availableIds = properties.filter((p) => p.status === "available").map((p) => p.id);
  if (availableIds.length) {
    try {
      const [{ data: factRows, error: factErr }, { data: orgRow }, { data: buildingRows }] = await Promise.all([
        supabase
          .from("properties")
          .select(
            "id, building_key, available_date, pets_cats, pets_dogs, pets_dog_size, pets_notes, heat_included, hydro_included, water_included, internet_included, cable_included, laundry, parking, parking_type, parking_count, parking_fee_cents, appliances, ac_type, ac_notes, lease_term, smoking, on_site_management",
          )
          .eq("organization_id", orgId)
          .in("id", availableIds),
        supabase.from("organizations").select(POLICY_PROFILE_COLUMNS).eq("id", orgId).maybeSingle(),
        supabase.from("org_building_policies").select(`building_key, ${POLICY_PROFILE_COLUMNS}`).eq("organization_id", orgId),
      ]);
      if (factErr) console.warn(`[replies] rental details read failed: ${factErr.message}`);
      const orgProfile = policyProfileFromRow(orgRow as Record<string, unknown> | null);
      const buildingByKey = new Map<string, PolicyProfile | null>();
      for (const b of (buildingRows ?? []) as unknown as ({ building_key: string | null } & Record<string, unknown>)[]) {
        if (b.building_key) buildingByKey.set(b.building_key, policyProfileFromRow(b));
      }
      for (const row of (factRows ?? []) as unknown as ({ id: string; building_key: string | null } & UnitFeatures)[]) {
        const building = row.building_key ? buildingByKey.get(row.building_key) ?? null : null;
        featuresByProperty.set(row.id, resolveEffectiveFeatures(row, resolveBuildingProfile(building, orgProfile)).features);
      }
    } catch (e) {
      console.warn(`[replies] answers skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return buildReplyKitCards({ appUrl, properties, posts, timesByProperty, photosByProperty, featuresByProperty });
}

/**
 * S817d: the "Answer renters from your phone" step is done once a renter was
 * saved from the phone: the Shortcut's note or Quick replies' Copy note
 * (lib/send-shortcut-server, lib/chat-leads chatLeadNoteManual).
 */
export const PHONE_REPLY_NOTE_MARKS = ["Added from Quick replies", "Sent from the iPhone share menu", "Sent from the Android share menu"] as const;
export async function hasPhoneReplyRenter(supabase: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const { count } = await supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .or(PHONE_REPLY_NOTE_MARKS.map((m) => `notes.ilike."*${m}*"`).join(","));
    return (count ?? 0) > 0;
  } catch {
    return false;
  }
}
