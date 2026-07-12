// Server-only by convention (imported by server actions + server components,
// never a client component) - matches lib/stripe.ts / lib/supabase/admin.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { guidelineForYear } from "@/lib/rent-increase";

// Server-side rent-increase guideline lookup (S465). Backs deriveRentIncrease's
// `guideline` injection point with the rent_guidelines table (0135), falling back
// to the shipped code constant (guidelineForYear) for any year the table lacks,
// then null. Lets a superadmin add future years with no redeploy while the
// constant stays a safety net: a table read failure NEVER blocks a legal derive.

export type GuidelineLookup = (year: number) => number | null;

/** Build a merged lookup: DB row (override) ?? code constant ?? null. Reads once. */
export async function loadGuidelineLookup(
  supabase: SupabaseClient,
): Promise<GuidelineLookup> {
  const map = mergeGuidelineRows(await readGuidelineRows(supabase));
  return (year: number) => {
    const v = map.get(year);
    return v != null ? v : guidelineForYear(year);
  };
}

async function readGuidelineRows(
  supabase: SupabaseClient,
): Promise<Array<{ year: unknown; percent: unknown }>> {
  try {
    const { data, error } = await supabase
      .from("rent_guidelines")
      .select("year, percent");
    if (error) return [];
    return (data ?? []) as Array<{ year: unknown; percent: unknown }>;
  } catch {
    return [];
  }
}

/** Pure: coerce DB rows (numeric may arrive as string) into a year->percent map. */
export function mergeGuidelineRows(
  rows: Array<{ year: unknown; percent: unknown }>,
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of rows) {
    const year = typeof r.year === "string" ? parseInt(r.year, 10) : Number(r.year);
    const pct = typeof r.percent === "string" ? parseFloat(r.percent) : Number(r.percent);
    if (Number.isInteger(year) && Number.isFinite(pct) && pct >= 0) map.set(year, pct);
  }
  return map;
}
