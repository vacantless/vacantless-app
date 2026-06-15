// Shared, pure booking helpers (no "use server" — safe to import from both
// server components and server actions). Generates open showing slots from an
// org's weekly availability rules, doing IANA-timezone-aware wall-clock math so
// "Tuesday 2:00 PM" means 2 PM in the operator's timezone regardless of where
// the server runs.

export type AvailabilityRule = {
  weekday: number; // 0=Sunday .. 6=Saturday (local to `timezone`)
  start_minute: number; // minutes from local midnight
  end_minute: number;
};

export type Availability = {
  timezone: string;
  slot_minutes: number;
  lead_hours: number;
  horizon_days: number;
  rules: AvailabilityRule[];
  booked: string[]; // ISO timestamps already taken
};

export type Slot = {
  iso: string; // exact instant, ISO 8601 (UTC)
  label: string; // e.g. "2:30 PM"
};

export type DaySlots = {
  dayKey: string; // YYYY-MM-DD in the org timezone
  dayLabel: string; // e.g. "Tue, Jul 1"
  slots: Slot[];
};

// Offset (ms) of `timeZone` at the given UTC instant. Positive = ahead of UTC.
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  let hour = Number(map.hour);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const asIfUTC = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return asIfUTC - utcMs;
}

// Convert a wall-clock time in `timeZone` to the exact UTC instant.
function zonedWallTimeToUtc(
  year: number,
  month1: number, // 1-12
  day: number,
  minutesOfDay: number,
  timeZone: string,
): Date {
  const hour = Math.floor(minutesOfDay / 60);
  const minute = minutesOfDay % 60;
  const guess = Date.UTC(year, month1 - 1, day, hour, minute, 0);
  // Correct using the offset that the zone reports at the guessed instant.
  const offset = tzOffsetMs(guess, timeZone);
  return new Date(guess - offset);
}

// The Y/M/D and weekday of a UTC instant *as seen in* `timeZone`.
function ymdInTz(utcMs: number, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(map.year),
    month: Number(map.month), // 1-12
    day: Number(map.day),
    weekday: weekdayMap[map.weekday] ?? 0,
  };
}

function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));
}

function fmtDay(dayAnchorUtcMs: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(dayAnchorUtcMs));
}

/**
 * Generate open slots grouped by day, in the org's timezone, from `now`.
 * Excludes slots earlier than now + lead_hours and any already-booked instant.
 */
export function generateSlots(av: Availability, now: Date = new Date()): DaySlots[] {
  const tz = av.timezone || "America/Toronto";
  const slotMin = av.slot_minutes > 0 ? av.slot_minutes : 30;
  const horizon = av.horizon_days > 0 ? av.horizon_days : 14;
  const earliest = now.getTime() + av.lead_hours * 3600_000;
  const booked = new Set(
    (av.booked || []).map((b) => new Date(b).getTime()),
  );

  // Rules grouped by weekday for quick lookup.
  const byWeekday = new Map<number, AvailabilityRule[]>();
  for (const r of av.rules || []) {
    const list = byWeekday.get(r.weekday) ?? [];
    list.push(r);
    byWeekday.set(r.weekday, list);
  }
  if (byWeekday.size === 0) return [];

  const days: DaySlots[] = [];

  // Walk calendar days 0..horizon as seen in the org timezone. Anchor each day
  // at local noon to read its Y/M/D/weekday safely (avoids DST midnight edges).
  for (let d = 0; d <= horizon; d++) {
    const anchorMs = now.getTime() + d * 86_400_000;
    const { year, month, day, weekday } = ymdInTz(anchorMs, tz);
    const rules = byWeekday.get(weekday);
    if (!rules || rules.length === 0) continue;

    const slots: Slot[] = [];
    for (const rule of rules) {
      for (let m = rule.start_minute; m + slotMin <= rule.end_minute; m += slotMin) {
        const instant = zonedWallTimeToUtc(year, month, day, m, tz);
        const t = instant.getTime();
        if (t < earliest) continue;
        if (booked.has(t)) continue;
        const iso = instant.toISOString();
        slots.push({ iso, label: fmtTime(iso, tz) });
      }
    }
    if (slots.length === 0) continue;

    // De-dupe + sort (overlapping rules could collide).
    const seen = new Set<string>();
    const unique = slots
      .filter((s) => (seen.has(s.iso) ? false : (seen.add(s.iso), true)))
      .sort((a, b) => a.iso.localeCompare(b.iso));

    days.push({
      dayKey: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      dayLabel: fmtDay(anchorMs, tz),
      slots: unique,
    });
  }

  return days;
}

/** True if `iso` is one of the currently-bookable slots. Server-side guard. */
export function isValidSlot(av: Availability, iso: string, now: Date = new Date()): boolean {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return false;
  for (const day of generateSlots(av, now)) {
    for (const s of day.slots) {
      if (new Date(s.iso).getTime() === target) return true;
    }
  }
  return false;
}

/** Long human label for a booked slot, e.g. "Tuesday, July 1 at 2:30 PM EDT". */
export function formatSlotLong(iso: string, timeZone: string): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).format(new Date(iso));
  return `${date} at ${time}`;
}

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function minutesToTimeStr(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function timeStrToMinutes(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 24 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

export function minutesToLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
