import type { SupabaseClient } from "@supabase/supabase-js";
import type { BuildingDayRow } from "@/lib/booking";

// S709: viewing days per building, loaded once for the crons that judge an
// org's viewing calendar (reminder, snapshot, tripwire, reopened notify).
// The pure rules live in lib/booking (buildingOpenWeekdays,
// unionBuildingWeekdays, limitAvailabilityToWeekdays); this only reads.

type Admin = SupabaseClient;

export type BuildingDayScope = {
  rows: BuildingDayRow[];
  /** building_key of each available, unarchived unit (null when it has none). */
  availableBuildingKeys: Array<string | null>;
};

export async function loadBuildingDayScope(
  admin: Admin,
  orgId: string,
): Promise<BuildingDayScope> {
  const [{ data: dayRows, error: dayErr }, { data: propRows, error: propErr }] =
    await Promise.all([
      admin
        .from("availability_building_days")
        .select("building_key, weekday")
        .eq("organization_id", orgId),
      admin
        .from("properties")
        .select("building_key")
        .eq("organization_id", orgId)
        .eq("status", "available")
        .is("archived_at", null),
    ]);
  if (dayErr) throw new Error(`building_days:${dayErr.message}`);
  if (propErr) throw new Error(`building_days_props:${propErr.message}`);
  return {
    rows: ((dayRows ?? []) as { building_key: string; weekday: number }[]).map((r) => ({
      building_key: String(r.building_key),
      weekday: Number(r.weekday),
    })),
    availableBuildingKeys: ((propRows ?? []) as { building_key: string | null }[]).map(
      (p) => p.building_key ?? null,
    ),
  };
}
