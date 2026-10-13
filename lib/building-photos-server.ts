import type { SupabaseClient } from "@supabase/supabase-js";
import { buildingKey } from "@/lib/booking";

// S712: building photos. A photo the landlord marks as a building photo is
// copied (same stored file, a new row with copied_from) into every unit of the
// same building that has no photos of its own, and into new units as they are
// added. A unit that already has photos is never touched. Runs with the
// caller's RLS client plus explicit org filters.

type BuildingPhoto = { id: string; storage_path: string; url: string; sort_order: number };

async function buildingPhotosFor(
  supabase: SupabaseClient,
  orgId: string,
  key: string,
): Promise<BuildingPhoto[]> {
  if (!key) return [];
  const { data } = await supabase
    .from("property_photos")
    .select("id, storage_path, url, sort_order, copied_from, property:properties(address)")
    .eq("organization_id", orgId)
    .eq("building_photo", true)
    .is("copied_from", null);
  const rows = (data ?? []) as unknown as (BuildingPhoto & {
    property: { address: string | null } | null;
  })[];
  const seen = new Set<string>();
  return rows
    .filter((r) => buildingKey(r.property?.address) === key)
    .filter((r) => (seen.has(r.storage_path) ? false : (seen.add(r.storage_path), true)))
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Give one unit its building's photos when it has none. Returns how many were added. */
export async function copyBuildingPhotosTo(
  supabase: SupabaseClient,
  input: { orgId: string; propertyId: string; address: string | null },
): Promise<number> {
  const key = buildingKey(input.address);
  if (!key) return 0;
  const { count } = await supabase
    .from("property_photos")
    .select("id", { count: "exact", head: true })
    .eq("property_id", input.propertyId);
  if ((count ?? 0) > 0) return 0;
  const photos = await buildingPhotosFor(supabase, input.orgId, key);
  if (photos.length === 0) return 0;
  const { error } = await supabase.from("property_photos").insert(
    photos.map((p, i) => ({
      organization_id: input.orgId,
      property_id: input.propertyId,
      storage_path: p.storage_path,
      url: p.url,
      sort_order: i,
      is_cover: i === 0,
      copied_from: p.id,
    })),
  );
  return error ? 0 : photos.length;
}

/** After a photo is marked as a building photo, fill every same-building unit with no photos. */
export async function spreadBuildingPhotos(
  supabase: SupabaseClient,
  input: { orgId: string; address: string | null; excludePropertyId: string },
): Promise<number> {
  const key = buildingKey(input.address);
  if (!key) return 0;
  const { data } = await supabase
    .from("properties")
    .select("id, address")
    .eq("organization_id", input.orgId)
    .neq("id", input.excludePropertyId);
  let filled = 0;
  for (const p of (data ?? []) as { id: string; address: string | null }[]) {
    if (buildingKey(p.address) !== key) continue;
    if ((await copyBuildingPhotosTo(supabase, { orgId: input.orgId, propertyId: p.id, address: p.address })) > 0) {
      filled++;
    }
  }
  return filled;
}
