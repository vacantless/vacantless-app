// S788b: unit progress links, server side (PLAN-S788-UNIT-PROGRESS).
// The crew page (/crew/<token>) has no Vacantless session: the token is the
// handle. Every read and write here uses the service-role client on the
// server and re-derives the org from the token, so a wrong token sees and
// changes nothing. A "Rented" tap runs the same takedown a landlord's
// "Leased" save runs (app/dashboard/properties/actions.ts).
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORG_COLUMNS, type Org } from "@/lib/org";
import { canTap, cleanDate, cleanNote, isCrewRole, isStage, stageTakesDate, takesAdsDown, type CrewRole, type Stage } from "@/lib/unit-progress";
import { takeDownFacebookPagePosts } from "@/lib/facebook-page-takedown";
import { queueRobotTakedowns } from "@/lib/robot-takedown";
import { notifyAdsStillUp } from "@/lib/ads-still-up-server";
import { handleLeaseupAdLifecycle } from "@/lib/leaseup-takedown";
import { notifyWaitingRentersRented } from "@/lib/rented-notice-server";
import { closeStaleConciergeItems } from "@/lib/concierge-stale-close-server";

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

export type TapResult = { ok: true; stage: Stage } | { ok: false; reason: "not_allowed" | "not_found" | "error" };

/** Record a tap from a crew link; a Rented tap also takes the ads down. */
export async function recordCrewTap(args: {
  admin: SupabaseClient;
  crew: CrewMember;
  propertyId: string;
  stage: string;
  note?: unknown;
  dueDate?: unknown;
}): Promise<TapResult> {
  const { admin, crew } = args;
  if (!isStage(args.stage) || !canTap(crew.role, args.stage)) return { ok: false, reason: "not_allowed" };
  const stage = args.stage;
  const { data: prop } = await admin
    .from("properties")
    .select("id, status")
    .eq("id", args.propertyId)
    .eq("organization_id", crew.organization_id)
    .is("archived_at", null)
    .maybeSingle();
  if (!prop) return { ok: false, reason: "not_found" };

  const { error } = await admin.from("unit_progress_events").insert({
    organization_id: crew.organization_id,
    property_id: args.propertyId,
    stage,
    crew_member_id: crew.id,
    note: cleanNote(args.note),
    due_date: stageTakesDate(stage) ? cleanDate(args.dueDate) : null,
  });
  if (error) return { ok: false, reason: "error" };

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
    dueDate: stageTakesDate(stage) ? cleanDate(args.dueDate) : null,
  });
  return { ok: true, stage };
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
};

/** The units a crew link shows: every rental in the account not archived, newest stage first. */
export async function unitCardsForOrg(admin: SupabaseClient, organizationId: string): Promise<UnitCard[]> {
  const { data: props } = await admin
    .from("properties")
    .select("id, address, status")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .order("address", { ascending: true })
    .limit(300);
  const rows = (props ?? []) as Array<{ id: string; address: string | null; status: string | null }>;
  if (rows.length === 0) return [];
  const { data: evs } = await admin
    .from("unit_progress_events")
    .select("property_id, stage, created_at, due_date, crew:crew_members(name)")
    .eq("organization_id", organizationId)
    .in("property_id", rows.map((r) => r.id))
    .order("created_at", { ascending: false })
    .limit(2000);
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
    };
  });
}
