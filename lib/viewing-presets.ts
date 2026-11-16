// S742i: the second move when nobody can book. Agile ran ten days with four
// live rentals, 116 waiting renters and no viewing time, while Today said the
// right thing and offered only a form. These presets open sensible windows in
// one tap from the Today card; the existing "new viewing times opened" sweep
// then emails every waiting renter whose building has a time (lib/availability-reopen).
// Pure.

export type PresetWindow = { weekday: number; start_minute: number; end_minute: number };

export const VIEWING_PRESETS = [
  {
    key: "weekday_evenings",
    label: "Weekday evenings",
    detail: "Monday to Friday, 5 to 7 pm",
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 17 * 60, end_minute: 19 * 60 })),
  },
  {
    key: "weekday_daytime",
    label: "Weekdays in the day",
    detail: "Monday to Friday, 10 am to 4 pm",
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_minute: 10 * 60, end_minute: 16 * 60 })),
  },
  {
    key: "saturday_mornings",
    label: "Saturday mornings",
    detail: "Saturday, 10 am to 1 pm",
    windows: [{ weekday: 6, start_minute: 10 * 60, end_minute: 13 * 60 }],
  },
] as const;

export type ViewingPresetKey = (typeof VIEWING_PRESETS)[number]["key"];

export function isViewingPresetKey(v: unknown): v is ViewingPresetKey {
  return VIEWING_PRESETS.some((p) => p.key === v);
}

export function viewingPreset(key: ViewingPresetKey) {
  return VIEWING_PRESETS.find((p) => p.key === key)!;
}

/**
 * The preset's windows minus any that already overlap an existing weekly
 * window on the same weekday (the landlord may have one Tuesday open). Pure.
 */
export function presetWindowsToAdd(key: ViewingPresetKey, existing: PresetWindow[]): PresetWindow[] {
  return viewingPreset(key).windows.filter(
    (w) => !existing.some((e) => e.weekday === w.weekday && e.start_minute < w.end_minute && e.end_minute > w.start_minute),
  );
}

// S804: "Same as last week". Landlords who open times a day at a time (Agile's
// Aaliyah: weekday evenings, the odd lunchtime) are not served by fixed presets.
// This repeats the account's own most recent week of day-by-day times over the
// next 7 days, starting today. Pure.

export type DayWindow = { day: string; start_minute: number; end_minute: number };

export const LAST_WEEK_KEY = "last_week";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function dayIndex(day: string): number {
  return new Date(`${day}T00:00:00Z`).getUTCDay();
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Past day-by-day times (any order) -> the same weekdays and hours over the
 * next 7 days from today. Uses only the most recent 7 days that had times
 * (ending on the latest one), skips days off and exact repeats. Pure.
 */
export function repeatLastWeek(past: DayWindow[], todayKey: string, daysOff: string[] = []): DayWindow[] {
  const before = past.filter((w) => w.day < todayKey && w.end_minute > w.start_minute);
  if (before.length === 0) return [];
  const latest = before.reduce((m, w) => (w.day > m ? w.day : m), before[0].day);
  const from = addDays(latest, -6);
  const todayDow = dayIndex(todayKey);
  const off = new Set(daysOff);
  const seen = new Set<string>();
  const out: DayWindow[] = [];
  for (const w of before) {
    if (w.day < from) continue;
    const target = addDays(todayKey, (dayIndex(w.day) - todayDow + 7) % 7);
    if (off.has(target)) continue;
    const k = `${target}|${w.start_minute}|${w.end_minute}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ day: target, start_minute: w.start_minute, end_minute: w.end_minute });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.start_minute - b.start_minute);
}

/** 1020 -> "5", 1110 -> "6:30", 720 -> "12" (am/pm added by the caller). Pure. */
function clock(min: number): { t: string; pm: boolean } {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return { t: m ? `${h}:${String(m).padStart(2, "0")}` : `${h}`, pm: h24 >= 12 };
}

/** "5 to 7 pm", "11 am to 1 pm". Pure. */
export function timeRange(start: number, end: number): string {
  const a = clock(start);
  const b = clock(end);
  return a.pm === b.pm ? `${a.t} to ${b.t} ${b.pm ? "pm" : "am"}` : `${a.t} ${a.pm ? "pm" : "am"} to ${b.t} ${b.pm ? "pm" : "am"}`;
}

export type BuildingDay = { weekday: number; building_key: string };

/** "1551 assumption st, windsor, on n9a 3e2" -> "1551 Assumption St". Pure. */
export function buildingShortName(key: string): string {
  const first = (key ?? "").split(",")[0].trim();
  return first.replace(/\b([a-z])/g, (c) => c.toUpperCase());
}

/**
 * "Mon, Tue, Thu and Fri 5 to 7 pm; Wed 11 am to 1 pm". With building days
 * (weekly, so they carry over), each group names its building:
 * "Mon and Tue 5 to 7 pm at 1551 Assumption St; Thu and Fri 5 to 7 pm at
 * 833 Pillette Rd". Pure.
 */
export function repeatSummary(windows: DayWindow[], buildingDays: BuildingDay[] = []): string {
  const groups = new Map<string, string[]>();
  for (const w of windows) {
    const dow = dayIndex(w.day);
    const buildings = [...new Set(buildingDays.filter((b) => b.weekday === dow).map((b) => buildingShortName(b.building_key)))].sort();
    const where = buildings.length ? ` at ${buildings.length > 1 ? `${buildings.slice(0, -1).join(", ")} and ${buildings[buildings.length - 1]}` : buildings[0]}` : "";
    const k = `${timeRange(w.start_minute, w.end_minute)}${where}`;
    const days = groups.get(k) ?? [];
    const name = WEEKDAY_SHORT[dow];
    if (!days.includes(name)) days.push(name);
    groups.set(k, days);
  }
  return [...groups.entries()]
    .map(([range, days]) => {
      const list = days.length > 1 ? `${days.slice(0, -1).join(", ")} and ${days[days.length - 1]}` : days[0];
      return `${list} ${range}`;
    })
    .join("; ");
}

/** What Today says after a preset opened. Pure. */
export function presetOpenedNotice(key: string | null | undefined, added: number | null): string | null {
  if (key === LAST_WEEK_KEY) {
    if (added === 0) return "Last week's times were already open. Nothing changed.";
    return "Last week's times are open again for the next 7 days. Renters waiting on a rental get an email with the new times within 15 minutes.";
  }
  if (!isViewingPresetKey(key)) return null;
  const p = viewingPreset(key);
  if (added === 0) return `${p.label} were already open (${p.detail}). Nothing changed.`;
  return `${p.label} are open (${p.detail}). Renters waiting on a rental in a building that shows on those days get an email with the new times within 15 minutes.`;
}
