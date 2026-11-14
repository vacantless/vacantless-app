// S790a: each rental's latest unit progress stage, for the stage chip on the
// Rentals list and the rental page. Works with the signed-in client (RLS
// limits rows to the landlord's own account) or the service-role client.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isStage, type LatestStage } from "@/lib/unit-progress";

export async function latestStages(
  client: SupabaseClient,
  organizationId: string,
  propertyIds: readonly string[],
): Promise<Map<string, LatestStage>> {
  const out = new Map<string, LatestStage>();
  if (propertyIds.length === 0) return out;
  const { data } = await client
    .from("unit_progress_events")
    .select("property_id, stage, created_at, due_date, crew:crew_members(name)")
    .eq("organization_id", organizationId)
    .in("property_id", propertyIds as string[])
    .order("created_at", { ascending: false })
    .limit(2000);
  for (const e of (data ?? []) as Array<{
    property_id: string;
    stage: string;
    created_at: string;
    due_date: string | null;
    crew: { name: string | null } | Array<{ name: string | null }> | null;
  }>) {
    if (out.has(e.property_id) || !isStage(e.stage)) continue;
    const crew = Array.isArray(e.crew) ? e.crew[0] : e.crew;
    out.set(e.property_id, { stage: e.stage, at: e.created_at, date: e.due_date ?? null, by: crew?.name ?? null });
  }
  return out;
}
