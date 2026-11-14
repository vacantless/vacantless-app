// S788b: unit progress links, server side (PLAN-S788-UNIT-PROGRESS).
// The crew page (/crew/<token>) has no Vacantless session: the token is the
// handle. Every read and write here uses the service-role client on the
// server and re-derives the org from the token, so a wrong token sees and
// changes nothing. A "Rented" tap runs the same takedown a landlord's
// "Leased" save runs (app/dashboard/properties/actions.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORG_COLUMNS, type Org } from "@/lib/org";
import { canAddUnit, canTap, cleanDate, cleanNote, cleanUnitNumber, composeUnitAddress, isCrewRole, isStage, stageTakesDate, takesAdsDown, tenancyEffect, type CrewRole, type Stage, type TenancyEffect, type TenancyLite } from "@/lib/unit-progress";
import { splitAddressUnit } from "@/lib/address-unit";
import { paidRentalLimitReached } from "@/lib/billing";
import { copyBuildingPhotosTo } from "@/lib/building-photos-server";
import { takeDownFacebookPagePosts } from "@/lib/facebook-page-takedown";
import { queueRobotTakedowns } from "@/lib/robot-takedown";
import { notifyAdsStillUp } from "@/lib/ads-still-up-server";
import { handleLeaseupAdLifecycle } from "@/lib/leaseup-takedown";
import { notifyWaitingRentersRented } from "@/lib/rented-notice-server";
import { closeStaleConciergeItems } from "@/lib/concierge-stale-close-server";
import { cleanPhotoFolderUrl, photoSourceOf, pullsFrom, type DrivePullResult } from "@/lib/drive-import";
import { pullFolderPhotos } from "@/lib/photo-folder-pull-server";
import { createShootLink, openShootLinks } from "@/lib/photo-shoot-server";

export type CrewMember = {
  id: string;
  organization_id: string;
  name: string;
  role: CrewRole;
  active: boolean;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The active crew member a link belongs to, or null. */
export async function crewFromToken(admin: SupabaseClient, token: string): Promise<CrewMember | null> {
  if (!UUID.test(token)) return null;
  const { data } = await admin
    .from("crew_members")
    .select("id, organization_id, name, role, active")
    .eq("link_token", token)
    .maybeSingle();
  const row = data as CrewMember | null;
  if (!row || !row.active || !isCrewRole(row.role)) return null;
  return row;
}

export type TapResult = { ok: true; stage: Stage; photos?: DrivePullResult; shootToken?: string | null } | { ok: false; reason: "not_allowed" | "not_found" | "error" };

/** Record a tap from a crew link; a Rented tap also takes the ads down. */
export async function recordCrewTap(args: {
  admin: SupabaseClient;
  crew: CrewMember;
  propertyId: string;
  stage: string;
  note?: unknown;
  dueDate?: unknown;
  /** S789b: the unit's photo folder link, sent with a "Photos are in" tap. */
  photoFolder?: unknown;
  /** S791a: the photographer's name, sent with a "Photographer booked" tap. */
  photographerName?: unknown;
}): Promise<TapResult> {
  const { admin, crew } = args;
  if (!isStage(args.stage) || !canTap(crew.role, args.stage)) return { ok: false, reason: "not_allowed" };
  const stage = args.stage;
  const { data: prop } = await admin
    .from("properties")
    .select("id, status, photo_source_url")
    .eq("id", args.propertyId)
    .eq("organization_id", crew.organization_id)
    .is("archived_at", null)
    .maybeSingle();
  if (!prop) return { ok: false, reason: "not_found" };
  let photoFolder = (prop as { photo_source_url: string | null }).photo_source_url ?? null;

  const dueDate = stageTakesDate(stage) ? cleanDate(args.dueDate) : null;
  const { error } = await admin.from("unit_progress_events").insert({
    organization_id: crew.organization_id,
    property_id: args.propertyId,
    stage,
    crew_member_id: crew.id,
    note: cleanNote(args.note),
    due_date: dueDate,
  });
  if (error) return { ok: false, reason: "error" };

  // S791a: a booked shoot gets its own one-time link for the photographer.
  let shootToken: string | null | undefined;
  if (stage === "photographer_booked") {
    shootToken = await createShootLink({
      client: admin,
      organizationId: crew.organization_id,
      propertyId: args.propertyId,
      shootDate: dueDate,
      photographerName: args.photographerName,
      crewMemberId: crew.id,
    });
  }

  // S789: Tenant gave notice and Moved in reach the tenancy.
  const effect = await applyTenancyEffect({ admin, organizationId: crew.organization_id, propertyId: args.propertyId, stage, dueDate });

  // S789b: "Photos are in" pulls the photos from the unit's Drive folder. A
  // link sent with the tap is saved on the rental first.
  let photos: DrivePullResult | undefined;
  if (stage === "photos_in") {
    const sent = cleanPhotoFolderUrl(args.photoFolder);
    if (sent && sent !== photoFolder) {
      const { error: linkErr } = await admin
        .from("properties")
        .update({ photo_source_url: sent })
        .eq("id", args.propertyId)
        .eq("organization_id", crew.organization_id);
      if (!linkErr) photoFolder = sent;
    }
    if (photoFolder && pullsFrom(photoSourceOf(photoFolder))) {
      try {
        // S789e: crew shots are touched up; a photographer's (their link, or a
        // shoot booked for this unit) are left as they are.
        const { data: booked } = await admin
          .from("unit_progress_events")
          .select("id")
          .eq("organization_id", crew.organization_id)
          .eq("property_id", args.propertyId)
          .eq("stage", "photographer_booked")
          .gte("created_at", new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString())
          .limit(1);
        const proShoot = crew.role === "photographer" || (booked ?? []).length > 0;
        photos = (await pullFolderPhotos({
          admin,
          organizationId: crew.organization_id,
          propertyId: args.propertyId,
          folderUrl: photoFolder,
          touchUp: !proShoot,
        })) ?? undefined;
      } catch (err) {
        console.error("[unit-progress] photo pull failed", err instanceof Error ? err.message : String(err));
        photos = { ok: false, reason: "failed" };
      }
    }
  }

  if (takesAdsDown(stage) && (prop as { status: string | null }).status !== "leased") {
    await markRentedAndTakeDown({ admin, organizationId: crew.organization_id, propertyId: args.propertyId });
  }
  // S788d: the landlord hears about the taps that need them.
  const { notifyLandlordOfTap } = await import("@/lib/unit-progress-notify");
  await notifyLandlordOfTap({
    admin,
    organizationId: crew.organization_id,
    propertyId: args.propertyId,
    crewName: crew.name,
    stage,
    dueDate,
    effect,
    photos,
    hasPhotoFolder: !!photoFolder,
  });
  return { ok: true, stage, photos, shootToken };
}

/**
 * S789: write what a tap means for the unit's tenancy (lib/unit-progress
 * tenancyEffect). Only ever fills an empty move-out date or turns an upcoming
 * tenancy active; never overwrites what the landlord recorded. Never throws.
 */
async function applyTenancyEffect(args: {
  admin: SupabaseClient;
  organizationId: string;
  propertyId: string;
  stage: Stage;
  dueDate: string | null;
}): Promise<TenancyEffect> {
  const { admin, organizationId, propertyId, stage, dueDate } = args;
  if (stage !== "notice_given" && stage !== "moved_in") return { kind: "none" };
  try {
    const { data } = await admin
      .from("tenancies")
      .select("id, status, move_out_date")
      .eq("organization_id", organizationId)
      .eq("property_id", propertyId)
      .in("status", ["active", "upcoming"])
      .limit(10);
    const effect = tenancyEffect(stage, dueDate, (data ?? []) as TenancyLite[]);
    if (effect.kind === "set_move_out") {
      const { data: done } = await admin
        .from("tenancies")
        .update({ move_out_date: effect.date })
        .eq("id", effect.tenancyId)
        .eq("organization_id", organizationId)
        .is("move_out_date", null)
        .select("id");
      if (!done || done.length === 0) return { kind: "none" };
    } else if (effect.kind === "activate") {
      const { data: done } = await admin
        .from("tenancies")
        .update({ status: "active" })
        .eq("id", effect.tenancyId)
        .eq("organization_id", organizationId)
        .eq("status", "upcoming")
        .select("id");
      if (!done || done.length === 0) return { kind: "none" };
    }
    return effect;
  } catch (err) {
    console.error("[unit-progress] tenancy effect failed", err instanceof Error ? err.message : String(err));
    return { kind: "none" };
  }
}

/** Mark the unit leased and run the landlord's lease-up takedown. Never throws. */
async function markRentedAndTakeDown(args: { admin: SupabaseClient; organizationId: string; propertyId: string }): Promise<void> {
  const { admin, organizationId, propertyId } = args;
  try {
    const { data: updated } = await admin
      .from("properties")
      .update({ status: "leased" })
      .eq("id", propertyId)
      .eq("organization_id", organizationId)
      .neq("status", "leased")
      .select("id");
    if (!updated || updated.length === 0) return;
    const { data: orgRow } = await admin.from("organizations").select(ORG_COLUMNS).eq("id", organizationId).maybeSingle();
    const org = orgRow as Org | null;
    if (!org) return;
    const steps: Array<() => Promise<unknown>> = [
      () => takeDownFacebookPagePosts({ supabase: admin, organizationId, propertyId }),
      () => queueRobotTakedowns({ supabase: admin, organizationId, propertyId }),
      () => notifyAdsStillUp({ supabase: admin, org, propertyId }),
      () => handleLeaseupAdLifecycle({ supabase: admin, org, propertyId }),
      () => notifyWaitingRentersRented({ client: admin, org, propertyId }),
      () => closeStaleConciergeItems(admin, { organizationId, propertyId, trigger: "leased" }),
    ];
    for (const step of steps) {
      try {
        await step();
      } catch (err) {
        console.error("[unit-progress] rented step failed", err instanceof Error ? err.message : String(err));
      }
    }
  } catch (err) {
    console.error("[unit-progress] rented failed", err instanceof Error ? err.message : String(err));
  }
}

export type UnitCard = {
  id: string;
  address: string;
  status: string | null;
  stage: Stage | null;
  stageAt: string | null;
  stageBy: string | null;
  stageDate: string | null;
  /** S789b: the unit has a photo folder link saved. */
  hasPhotoFolder: boolean;
  /** S791a: the unit's open photographer link, if a shoot is booked. */
  shootLinkId: string | null;
  shootToken: string | null;
  shootPhotographer: string | null;
};

/** The units a crew link shows: every rental in the account not archived, newest stage first. */
export async function unitCardsForOrg(admin: SupabaseClient, organizationId: string): Promise<UnitCard[]> {
  const { data: props } = await admin
    .from("properties")
    .select("id, address, status, photo_source_url")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("address", { ascending: true })
    .limit(300);
  const rows = (props ?? []) as Array<{ id: string; address: string | null; status: string | null; photo_source_url: string | null }>;
  if (rows.length === 0) return [];
  const { data: evs } = await admin
    .from("unit_progress_events")
    .select("property_id, stage, created_at, due_date, crew:crew_members(name)")
    .eq("organization_id", organizationId)
    .in("property_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false })
    .limit(2000);
  let shoots = new Map<string, { id: string; token: string; photographerName: string | null }>();
  try {
    shoots = await openShootLinks(admin, organizationId);
  } catch {
    // a missing shoot list never hides the units
  }
  const latest = new Map<string, { stage: string; created_at: string; by: string | null; due: string | null }>();
  for (const e of (evs ?? []) as Array<{ property_id: string; stage: string; created_at: string; due_date: string | null; crew: { name: string | null } | Array<{ name: string | null }> | null }>) {
    if (latest.has(e.property_id) || !isStage(e.stage)) continue;
    const crew = Array.isArray(e.crew) ? e.crew[0] : e.crew;
    latest.set(e.property_id, { stage: e.stage, created_at: e.created_at, by: crew?.name ?? null, due: e.due_date ?? null });
  }
  return rows.map((r) => {
    const l = latest.get(r.id);
    return {
      id: r.id,
      address: r.address ?? "Unnamed rental",
      status: r.status,
      stage: l ? (l.stage as Stage) : null,
      stageAt: l?.created_at ?? null,
      stageBy: l?.by ?? null,
      stageDate: l?.due ?? null,
      hasPhotoFolder: !!r.photo_source_url,
      shootLinkId: shoots.get(r.id)?.id ?? null,
      shootToken: shoots.get(r.id)?.token ?? null,
      shootPhotographer: shoots.get(r.id)?.photographerName ?? null,
    };
  });
}

/** The account's buildings (street without the unit), for the add-a-unit form. */
export async function buildingsForOrg(admin: SupabaseClient, organizationId: string): Promise<string[]> {
  const { data } = await admin
    .from("properties")
    .select("address")
    .eq("organization_id", organizationId)
    .limit(1000);
  const set = new Set<string>();
  for (const r of (data ?? []) as Array<{ address: string | null }>) {
    const street = splitAddressUnit(r.address).street;
    if (street) set.add(street);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export type AddUnitResult =
  | { ok: true; propertyId: string; existed: boolean }
  | { ok: false; reason: "not_allowed" | "bad_unit" | "bad_building" | "plan_full" | "archived" | "error" };

/**
 * S788e: the manager or leasing person adds a unit from their link, with an
 * optional first stage. It lands as a private draft (never public) with its
 * building's photos, and counts toward a paid plan's rental limit like any
 * rental the landlord adds.
 */
export async function addUnitFromCrew(args: {
  admin: SupabaseClient;
  crew: CrewMember;
  street: string;
  unit: unknown;
  stage?: string;
  dueDate?: unknown;
}): Promise<AddUnitResult> {
  const { admin, crew } = args;
  if (!canAddUnit(crew.role)) return { ok: false, reason: "not_allowed" };
  const unit = cleanUnitNumber(args.unit);
  if (!unit) return { ok: false, reason: "bad_unit" };
  const buildings = await buildingsForOrg(admin, crew.organization_id);
  if (!buildings.includes(args.street)) return { ok: false, reason: "bad_building" };
  const address = composeUnitAddress(args.street, unit);

  const { data: same } = await admin
    .from("properties")
    .select("id, address, archived_at")
    .eq("organization_id", crew.organization_id)
    .ilike("address", address)
    .limit(1);
  const existing = ((same ?? []) as Array<{ id: string; archived_at: string | null }>)[0];
  let propertyId: string;
  let existed = false;
  if (existing) {
    if (existing.archived_at) return { ok: false, reason: "archived" };
    propertyId = existing.id;
    existed = true;
  } else {
    const { data: org } = await admin
      .from("organizations")
      .select("plan, rental_cap")
      .eq("id", crew.organization_id)
      .maybeSingle();
    const o = org as { plan: string | null; rental_cap: number | null } | null;
    if (o?.rental_cap != null) {
      const { count } = await admin
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", crew.organization_id)
        .is("archived_at", null);
      if (paidRentalLimitReached({ plan: o.plan, rentalCap: o.rental_cap, rentals: count ?? 0 })) return { ok: false, reason: "plan_full" };
    }
    const { data: inserted, error } = await admin
      .from("properties")
      .insert({ organization_id: crew.organization_id, status: "draft", address })
      .select("id")
      .single();
    if (error || !inserted) return { ok: false, reason: "error" };
    propertyId = (inserted as { id: string }).id;
    try {
      await copyBuildingPhotosTo(admin, { orgId: crew.organization_id, propertyId, address });
    } catch {
      // best effort: a unit without its building's photos is still added
    }
  }
  if (args.stage && isStage(args.stage) && canTap(crew.role, args.stage) && !takesAdsDown(args.stage)) {
    await recordCrewTap({ admin, crew, propertyId, stage: args.stage, dueDate: args.dueDate });
  }
  return { ok: true, propertyId, existed };
}
