// S791a: the photographer's one-time link (PLAN-S788-UNIT-PROGRESS step 7).
// A "Photographer booked" stage makes a link for that one shoot. The
// photographer opens /crew/shoot/<token> with no sign in, pastes the link to
// the photos and taps "Photos are in"; the link is then used up. The public
// page reads and writes through the service-role client and re-derives the
// org and the unit from the token, so a wrong token sees and changes nothing.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanPersonName, photographerLabel, shootLinkExpiry, shootLinkState, type ShootLinkState } from "@/lib/unit-progress";
import { cleanPhotoFolderUrl, photoSourceOf, type DrivePullResult } from "@/lib/drive-import";
import { pullDrivePhotos } from "@/lib/drive-import-server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Make the shoot link for a unit and switch off any earlier open one for it.
 * Works with the landlord's signed-in client (RLS) or the service role.
 * Returns the token, or null when it could not be made. Never throws.
 */
export async function createShootLink(args: {
  client: SupabaseClient;
  organizationId: string;
  propertyId: string;
  shootDate: string | null;
  photographerName?: unknown;
  crewMemberId?: string | null;
  actorUserId?: string | null;
}): Promise<string | null> {
  const { client, organizationId, propertyId } = args;
  try {
    const nowIso = new Date().toISOString();
    await client
      .from("photo_shoot_links")
      .update({ revoked_at: nowIso })
      .eq("organization_id", organizationId)
      .eq("property_id", propertyId)
      .is("used_at", null)
      .is("revoked_at", null);
    const { data, error } = await client
      .from("photo_shoot_links")
      .insert({
        organization_id: organizationId,
        property_id: propertyId,
        photographer_name: cleanPersonName(args.photographerName),
        shoot_date: args.shootDate,
        created_by_crew_member_id: args.crewMemberId ?? null,
        actor_user_id: args.actorUserId ?? null,
        expires_at: shootLinkExpiry(args.shootDate).toISOString(),
      })
      .select("token")
      .single();
    if (error || !data) {
      console.error("[photo-shoot] link not made", error?.message ?? "no row");
      return null;
    }
    return (data as { token: string }).token;
  } catch (err) {
    console.error("[photo-shoot] link failed", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/** Switch a unit's open shoot link off (landlord side, RLS). */
export async function revokeShootLink(client: SupabaseClient, organizationId: string, linkId: string): Promise<void> {
  await client
    .from("photo_shoot_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .eq("organization_id", organizationId)
    .is("used_at", null);
}

export type OpenShootLink = { id: string; token: string; photographerName: string | null; shootDate: string | null };

/** The open shoot link per unit for an account, keyed by property id. */
export async function openShootLinks(client: SupabaseClient, organizationId: string): Promise<Map<string, OpenShootLink>> {
  const out = new Map<string, OpenShootLink>();
  const { data } = await client
    .from("photo_shoot_links")
    .select("id, property_id, token, photographer_name, shoot_date, created_at")
    .eq("organization_id", organizationId)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(500);
  for (const r of (data ?? []) as Array<{ id: string; property_id: string; token: string; photographer_name: string | null; shoot_date: string | null }>) {
    if (out.has(r.property_id)) continue;
    out.set(r.property_id, { id: r.id, token: r.token, photographerName: r.photographer_name, shootDate: r.shoot_date });
  }
  return out;
}

export type Shoot = {
  id: string;
  organizationId: string;
  propertyId: string;
  address: string;
  photographerName: string | null;
  shootDate: string | null;
  state: ShootLinkState;
  propertyHasFolder: boolean;
};

/** The shoot a link belongs to (any state), or null for an unknown token or archived unit. */
export async function shootFromToken(admin: SupabaseClient, token: string): Promise<Shoot | null> {
  if (!UUID.test(token)) return null;
  const { data } = await admin
    .from("photo_shoot_links")
    .select("id, organization_id, property_id, photographer_name, shoot_date, expires_at, used_at, revoked_at")
    .eq("token", token)
    .maybeSingle();
  const row = data as {
    id: string;
    organization_id: string;
    property_id: string;
    photographer_name: string | null;
    shoot_date: string | null;
    expires_at: string;
    used_at: string | null;
    revoked_at: string | null;
  } | null;
  if (!row) return null;
  const { data: prop } = await admin
    .from("properties")
    .select("address, photo_source_url")
    .eq("id", row.property_id)
    .eq("organization_id", row.organization_id)
    .is("archived_at", null)
    .maybeSingle();
  const p = prop as { address: string | null; photo_source_url: string | null } | null;
  if (!p) return null;
  return {
    id: row.id,
    organizationId: row.organization_id,
    propertyId: row.property_id,
    address: p.address ?? "The unit",
    photographerName: row.photographer_name,
    shootDate: row.shoot_date,
    state: shootLinkState(row),
    propertyHasFolder: !!p.photo_source_url,
  };
}

export type ShootResult =
  | { ok: true; photos?: DrivePullResult }
  | { ok: false; reason: "no_link" | "closed" | "error" };

/**
 * The photographer's "Photos are in". Uses the link up first (so a double
 * tap records once), then logs the stage, pulls a Google Drive folder with no
 * touch-up, keeps the link for the landlord and emails them. A link is needed
 * unless the unit already has a photo folder.
 */
export async function recordShootPhotosIn(args: { admin: SupabaseClient; shoot: Shoot; folder: unknown }): Promise<ShootResult> {
  const { admin, shoot } = args;
  if (shoot.state !== "open") return { ok: false, reason: "closed" };
  const sent = cleanPhotoFolderUrl(args.folder);
  if (!sent && !shoot.propertyHasFolder) return { ok: false, reason: "no_link" };

  const { data: claimed } = await admin
    .from("photo_shoot_links")
    .update({ used_at: new Date().toISOString(), delivery_url: sent })
    .eq("id", shoot.id)
    .is("used_at", null)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("id");
  if (!claimed || claimed.length === 0) return { ok: false, reason: "closed" };

  const { error } = await admin.from("unit_progress_events").insert({
    organization_id: shoot.organizationId,
    property_id: shoot.propertyId,
    stage: "photos_in",
    crew_member_id: null,
    note: shoot.photographerName ? `Photographer: ${shoot.photographerName}` : "Photographer",
  });
  if (error) {
    console.error("[photo-shoot] stage not saved", error.message);
    return { ok: false, reason: "error" };
  }

  // The unit's folder link is filled only when it has none: the crew's own
  // folder is never replaced by a photographer's delivery link.
  const { data: prop } = await admin
    .from("properties")
    .select("photo_source_url")
    .eq("id", shoot.propertyId)
    .eq("organization_id", shoot.organizationId)
    .maybeSingle();
  let folder = (prop as { photo_source_url: string | null } | null)?.photo_source_url ?? null;
  if (sent && !folder) {
    const { error: linkErr } = await admin
      .from("properties")
      .update({ photo_source_url: sent })
      .eq("id", shoot.propertyId)
      .eq("organization_id", shoot.organizationId)
      .is("photo_source_url", null);
    if (!linkErr) folder = sent;
  }
  const pullFrom = sent ?? folder;
  let photos: DrivePullResult | undefined;
  if (pullFrom && photoSourceOf(pullFrom) === "gdrive") {
    try {
      photos = await pullDrivePhotos({
        admin,
        organizationId: shoot.organizationId,
        propertyId: shoot.propertyId,
        folderUrl: pullFrom,
        touchUp: false,
      });
    } catch (err) {
      console.error("[photo-shoot] photo pull failed", err instanceof Error ? err.message : String(err));
      photos = { ok: false, reason: "failed" };
    }
  }

  const { notifyLandlordOfTap } = await import("@/lib/unit-progress-notify");
  await notifyLandlordOfTap({
    admin,
    organizationId: shoot.organizationId,
    propertyId: shoot.propertyId,
    crewName: photographerLabel(shoot.photographerName),
    stage: "photos_in",
    dueDate: null,
    photos,
    hasPhotoFolder: !!folder,
    deliveryUrl: sent,
  });
  return { ok: true, photos };
}
