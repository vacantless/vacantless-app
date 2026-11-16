// S804: load the account's last week of day-by-day viewing times, moved to
// the next 7 days (pure part in lib/viewing-presets repeatLastWeek). Server only.
import type { createClient } from "@/lib/supabase/server";
import { repeatLastWeek, type BuildingDay, type DayWindow } from "@/lib/viewing-presets";

export async function loadLastWeekTimes(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
  timeZone: string,
): Promise<DayWindow[]> {
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const from = new Date(`${todayKey}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 28);
  const [{ data: past }, { data: off }] = await Promise.all([
    supabase
      .from("availability_overrides")
      .select("day, start_minute, end_minute")
      .eq("organization_id", orgId)
      .gte("day", from.toISOString().slice(0, 10))
      .lt("day", todayKey),
    supabase
      .from("availability_days_off")
      .select("day")
      .eq("organization_id", orgId)
      .gte("day", todayKey),
  ]);
  return repeatLastWeek(
    (past ?? []) as DayWindow[],
    todayKey,
    ((off ?? []) as { day: string }[]).map((d) => d.day),
  );
}


/** The account's building days (weekly). Server only. */
export async function loadBuildingDays(
  supabase: ReturnType<typeof createClient>,
  orgId: string,
): Promise<BuildingDay[]> {
  const { data } = await supabase
    .from("availability_building_days")
    .select("weekday, building_key")
    .eq("organization_id", orgId);
  return (data ?? []) as BuildingDay[];
}
