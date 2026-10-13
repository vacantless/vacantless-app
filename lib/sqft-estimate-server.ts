import type { SupabaseClient } from "@supabase/supabase-js";
import { buildingKey } from "@/lib/booking";
import { estimateSqft } from "@/lib/sqft-estimate";

// S712: the size to save for a rental. A size the landlord typed always wins
// and is not an estimate. A blank size with known bedrooms is estimated from
// the org's own real sizes (same building first). Org-scoped by the caller's
// client and an explicit org filter.
export async function sqftToSave(
  supabase: SupabaseClient,
  input: {
    orgId: string;
    address: string | null;
    beds: number | null;
    typedSqft: number | null;
    excludePropertyId?: string | null;
  },
): Promise<{ sqft: number | null; sqft_estimated: boolean }> {
  if (input.typedSqft != null && input.typedSqft > 0) {
    return { sqft: input.typedSqft, sqft_estimated: false };
  }
  if (input.beds == null) return { sqft: null, sqft_estimated: false };
  let rows: { id: string; address: string | null; sqft: number | null }[] = [];
  try {
    const { data } = await supabase
      .from("properties")
      .select("id, address, sqft")
      .eq("organization_id", input.orgId)
      .eq("beds", input.beds)
      .eq("sqft_estimated", false)
      .not("sqft", "is", null)
      .limit(200);
    rows = (data ?? []) as typeof rows;
  } catch {
    rows = [];
  }
  const key = buildingKey(input.address);
  const others = rows.filter((r) => r.id !== input.excludePropertyId);
  const est = estimateSqft({
    beds: input.beds,
    sameBuilding: others.filter((r) => key && buildingKey(r.address) === key).map((r) => r.sqft as number),
    sameOrg: others.map((r) => r.sqft as number),
  });
  return est ? { sqft: est.sqft, sqft_estimated: true } : { sqft: null, sqft_estimated: false };
}
