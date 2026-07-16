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

export type AvailabilityOverride = {
  day: string; // YYYY-MM-DD in the org timezone
  start_minute: number;
  end_minute: number;
};

// A future scheduled showing somewhere in the org, used to derive a building's
// implicit anchor window (the "Hero block"). Only currently-listed properties
// are surfaced by the RPC.
export type ClusterCandidate = {
  id?: string | null;
  address: string | null;
  scheduled_at: string; // ISO instant
};

export type Availability = {
  timezone: string;
  slot_minutes: number;
  lead_hours: number;
  horizon_days: number;
  rules: AvailabilityRule[];
  booked: string[]; // ISO timestamps already taken
  // Operator days off (date-specific blackouts), YYYY-MM-DD in the org tz. Any
  // calendar day whose key is in this set produces no slots — the recurring
  // weekly rules still stand, this just subtracts specific dates (e.g. a
  // rotating day off). Absent/empty = no dates blocked.
  days_off?: string[];
  // Date-specific custom windows, YYYY-MM-DD in the org tz. When a day has one
  // or more overrides, those windows replace the weekly rule for that date.
  // Precedence: days_off > overrides > weekly rules.
  overrides?: AvailabilityOverride[];
  // --- Showing clustering ("Hero blocks"), all optional / opt-in ---
  clustering_enabled?: boolean;
  clustering_buffer_minutes?: number; // how far adjacent slots may extend an anchor
  showing_block_capacity?: number; // max showings to cluster into one building+day
  cluster_candidates?: ClusterCandidate[]; // org's future scheduled showings
  target_address?: string | null; // the listing being booked (its building anchors)
};

export type Slot = {
  iso: string; // exact instant, ISO 8601 (UTC)
  label: string; // e.g. "2:30 PM"
  clustered?: boolean; // true when this slot falls inside a building anchor window
};

export type DaySlots = {
  dayKey: string; // YYYY-MM-DD in the org timezone
  dayLabel: string; // e.g. "Tue, Jul 1"
  slots: Slot[];
};

export type SlotGenerationOptions = {
  excludeShowingId?: string | null;
  relaxLeadForAnchoredDays?: boolean;
};

// How many days the renter booking form shows before "More times" is expanded.
export const COLLAPSED_DAY_COUNT = 3;

// The subset of days whose slot radios are actually rendered. When collapsed we
// only render the first COLLAPSED_DAY_COUNT days.
export function visibleBookingDays(
  days: DaySlots[],
  showAll: boolean,
): DaySlots[] {
  return showAll ? days : days.slice(0, COLLAPSED_DAY_COUNT);
}

// True when the selected slot's radio is currently mounted. When it is NOT (the
// slot was chosen from a day that is now collapsed out of view), the booking
// form must submit a hidden fallback so the choice is not silently dropped and
// the booking downgraded to an inquiry.
export function selectedSlotIsRendered(
  days: DaySlots[],
  showAll: boolean,
  selectedSlotIso: string,
): boolean {
  if (!selectedSlotIso) return false;
  return visibleBookingDays(days, showAll).some((d) =>
    d.slots.some((s) => s.iso === selectedSlotIso),
  );
}

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
// Exported (S387) so the repair-appointment reminder cron can turn a confirmed
// appointment's (chosen_date, chosen_start_minute) into a UTC instant in the
// org's timezone, reusing this DST-correct conversion rather than duplicating it.
export function zonedWallTimeToUtc(
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
export function generateSlots(
  av: Availability,
  now: Date = new Date(),
  options: SlotGenerationOptions = {},
): DaySlots[] {
  const tz = av.timezone || "America/Toronto";
  const slotMin = av.slot_minutes > 0 ? av.slot_minutes : 30;
  const horizon = av.horizon_days > 0 ? av.horizon_days : 14;
  const earliest = now.getTime() + av.lead_hours * 3600_000;
  const booked = new Set(
    (av.booked || []).map((b) => new Date(b).getTime()),
  );
  // Date-specific operator days off (YYYY-MM-DD in the org tz). A day whose key
  // is here is skipped entirely, no matter what the weekly rules offer.
  const daysOff = new Set(av.days_off || []);

  // Rules grouped by weekday for quick lookup.
  const byWeekday = new Map<number, AvailabilityRule[]>();
  for (const r of av.rules || []) {
    const list = byWeekday.get(r.weekday) ?? [];
    list.push(r);
    byWeekday.set(r.weekday, list);
  }
  const byDate = new Map<string, AvailabilityOverride[]>();
  for (const o of av.overrides || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.day)) continue;
    const list = byDate.get(o.day) ?? [];
    list.push(o);
    byDate.set(o.day, list);
  }

  const targetKey =
    av.clustering_enabled ? buildingKey(av.target_address) : "";
  const anchorInstantsMs: number[] = [];
  const anchorsByDay = new Map<string, number[]>();
  if (targetKey) {
    for (const c of av.cluster_candidates || []) {
      if (options.excludeShowingId && c.id === options.excludeShowingId) {
        continue;
      }
      if (buildingKey(c.address) !== targetKey) continue;
      const t = new Date(c.scheduled_at).getTime();
      if (Number.isNaN(t) || t < now.getTime()) continue;
      anchorInstantsMs.push(t);
      const { year, month, day } = ymdInTz(t, tz);
      const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const list = anchorsByDay.get(key) ?? [];
      list.push(t);
      anchorsByDay.set(key, list);
    }
  }

  if (byWeekday.size === 0 && byDate.size === 0 && anchorsByDay.size === 0) {
    return [];
  }

  const days: DaySlots[] = [];
  const bufferMs = Math.max(0, av.clustering_buffer_minutes ?? 60) * 60_000;
  const cap =
    av.showing_block_capacity != null && av.showing_block_capacity > 0
      ? av.showing_block_capacity
      : 6;

  // Walk calendar days 0..horizon as seen in the org timezone. Anchor each day
  // at local noon to read its Y/M/D/weekday safely (avoids DST midnight edges).
  for (let d = 0; d <= horizon; d++) {
    const anchorMs = now.getTime() + d * 86_400_000;
    const { year, month, day, weekday } = ymdInTz(anchorMs, tz);
    const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (daysOff.has(dayKey)) continue; // operator blocked this specific date
    const overrideRules = byDate.get(dayKey);
    const rules =
      overrideRules && overrideRules.length > 0
        ? overrideRules
        : byWeekday.get(weekday);
    const anchors = anchorsByDay.get(dayKey);
    const isAnchored =
      anchors != null && anchors.length >= 1 && anchors.length < cap;
    const relaxLead =
      options.relaxLeadForAnchoredDays === true && isAnchored;

    const slots: Slot[] = [];
    if (!rules || rules.length === 0) {
      continue;
    } else {
      for (const rule of rules) {
        for (let m = rule.start_minute; m + slotMin <= rule.end_minute; m += slotMin) {
          const instant = zonedWallTimeToUtc(year, month, day, m, tz);
          const t = instant.getTime();
          if (relaxLead ? t <= now.getTime() : t < earliest) continue;
          if (booked.has(t)) continue;
          const iso = instant.toISOString();
          slots.push({ iso, label: fmtTime(iso, tz) });
        }
      }
    }
    if (slots.length === 0) continue;

    // De-dupe + sort (overlapping rules could collide).
    const seen = new Set<string>();
    const unique = slots
      .filter((s) => (seen.has(s.iso) ? false : (seen.add(s.iso), true)))
      .sort((a, b) => a.iso.localeCompare(b.iso));

    days.push({
      dayKey,
      dayLabel: fmtDay(anchorMs, tz),
      slots: unique,
    });
  }

  // Showing clustering ("Hero blocks"): opt-in per org. When enabled, restrict
  // each day that already has a showing for THIS building to slots near that
  // building's anchor window; days with no anchor keep full availability (they
  // can start a new anchor). Disabled (the default) = identical to before.
  if (av.clustering_enabled) {
    if (targetKey) {
      return clusterDays(days, anchorInstantsMs, {
        timeZone: tz,
        bufferMinutes: av.clustering_buffer_minutes ?? 60,
        capacity: av.showing_block_capacity ?? 6,
      });
    }
  }

  return days;
}

// ---------------------------------------------------------------------------
// Building identity + clustering. buildingKey() is the SINGLE SOURCE OF TRUTH
// for "same building" — the public RPC returns raw addresses and this groups
// them; the operator Showings view uses the same function. Normalizes the
// pre-comma street portion, drops unit/apt/suite/# designators, and folds a
// few common street-type abbreviations so "Rd" and "Road" match.
// ---------------------------------------------------------------------------
// Known drift: SQL public.building_key in 0049 does not fold street-type abbreviations until the deferred recompute migration ships.
const STREET_ABBR: Record<string, string> = {
  road: "rd",
  street: "st",
  avenue: "ave",
  av: "ave",
  drive: "dr",
  boulevard: "blvd",
  court: "ct",
  crt: "ct",
  crescent: "cres",
  cr: "cres",
  lane: "ln",
  place: "pl",
  terrace: "ter",
  parkway: "pkwy",
  highway: "hwy",
  circle: "cir",
  square: "sq",
  trail: "trl",
};

export function buildingKey(address: string | null | undefined): string {
  const base = (address ?? "").split(",")[0].toLowerCase();
  const cleaned = base
    .replace(/\b(?:unit|apt|apartment|suite|ste)\b\.?\s*\S+/g, " ")
    .replace(/#\s*\S+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned
    .split(" ")
    .map((t) => STREET_ABBR[t] ?? t)
    .join(" ");
}

/**
 * Apply building clustering to pre-generated days. For each day:
 *  - no anchor for this building → keep the day as-is (a new anchor can form);
 *  - anchors at/over capacity → drop the day (building+day is full);
 *  - otherwise → keep only slots within [min(anchor), max(anchor)] expanded by
 *    the buffer on each side, tagged `clustered`.
 * Pure; `anchorInstantsMs` are this building's existing showing instants (UTC ms).
 */
export function clusterDays(
  days: DaySlots[],
  anchorInstantsMs: number[],
  opts: { timeZone: string; bufferMinutes: number; capacity: number },
): DaySlots[] {
  const bufferMs = Math.max(0, opts.bufferMinutes) * 60_000;
  const cap = opts.capacity > 0 ? opts.capacity : 6;

  const byDay = new Map<string, number[]>();
  for (const ms of anchorInstantsMs) {
    if (Number.isNaN(ms)) continue;
    const { year, month, day } = ymdInTz(ms, opts.timeZone);
    const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const list = byDay.get(key) ?? [];
    list.push(ms);
    byDay.set(key, list);
  }

  const out: DaySlots[] = [];
  for (const day of days) {
    const anchors = byDay.get(day.dayKey);
    if (!anchors || anchors.length === 0) {
      out.push(day); // new-anchor day → full availability
      continue;
    }
    if (anchors.length >= cap) continue; // building+day full → no slots
    const lo = Math.min(...anchors) - bufferMs;
    const hi = Math.max(...anchors) + bufferMs;
    const slots = day.slots
      .filter((s) => {
        const t = new Date(s.iso).getTime();
        return t >= lo && t <= hi;
      })
      .map((s) => ({ ...s, clustered: true }));
    if (slots.length === 0) continue;
    out.push({ ...day, slots });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Operator view: group an org's showings into building+day "blocks" so the
// agent sees a clustered route ("833 Pillette Rd — 3 showings, 2:00–3:30 PM").
// ---------------------------------------------------------------------------
export type ShowingForBlock = {
  scheduled_at: string | null;
  address: string | null;
};

export type ShowingBlock = {
  key: string; // buildingKey + dayKey
  buildingKey: string;
  buildingLabel: string; // representative address (pre-comma)
  dayKey: string; // YYYY-MM-DD in org tz
  startIso: string;
  endIso: string;
  count: number;
};

export function groupShowingsIntoBlocks(
  rows: ShowingForBlock[],
  timeZone: string,
): ShowingBlock[] {
  const groups = new Map<
    string,
    { bk: string; label: string; dayKey: string; instants: string[] }
  >();
  for (const r of rows) {
    if (!r.scheduled_at) continue;
    const ms = new Date(r.scheduled_at).getTime();
    if (Number.isNaN(ms)) continue;
    const bk = buildingKey(r.address);
    const { year, month, day } = ymdInTz(ms, timeZone);
    const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const key = `${bk}|${dayKey}`;
    const label = (r.address ?? "").split(",")[0].trim() || "Unknown address";
    const g = groups.get(key) ?? { bk, label, dayKey, instants: [] };
    g.instants.push(r.scheduled_at);
    groups.set(key, g);
  }

  const blocks: ShowingBlock[] = [];
  for (const [key, g] of groups) {
    const sorted = [...g.instants].sort((a, b) => a.localeCompare(b));
    blocks.push({
      key,
      buildingKey: g.bk,
      buildingLabel: g.label,
      dayKey: g.dayKey,
      startIso: sorted[0],
      endIso: sorted[sorted.length - 1],
      count: sorted.length,
    });
  }
  return blocks.sort((a, b) => a.startIso.localeCompare(b.startIso));
}

/** True if `iso` is one of the currently-bookable slots. Server-side guard. */
export function isValidSlot(
  av: Availability,
  iso: string,
  now: Date = new Date(),
  options: SlotGenerationOptions = {},
): boolean {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return false;
  for (const day of generateSlots(av, now, options)) {
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

/**
 * The slot START minutes a single availability window produces for a given slot
 * length. PURE preview helper for the "what renters will see" panel on the
 * Showing-times page: it mirrors generateSlots' per-window stepping EXACTLY
 * (`m + slot <= end`, so a trailing partial slot is dropped), without any
 * timezone/date/booked logic. A non-positive slot length falls back to 30, and
 * an empty/invalid window yields [].
 */
export function previewSlotStarts(
  startMinute: number,
  endMinute: number,
  slotMinutes: number,
): number[] {
  const slot = slotMinutes > 0 ? slotMinutes : 30;
  const out: number[] = [];
  for (let m = startMinute; m + slot <= endMinute; m += slot) {
    out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// datetime-local <-> UTC instant, interpreted in the org's booking timezone.
// Used by the operator RESCHEDULE control (S442): the <input type="datetime-local">
// yields a bare wall-clock string with NO offset, which the operator means in the
// org's booking timezone. These two helpers are exact inverses (modulo the DST
// "spring-forward" gap) and DST-correct because they route through
// zonedWallTimeToUtc / the same Intl offset math generateSlots uses — so we never
// hand-roll a timezone offset. Kept PURE + here (not in the action) so they can be
// unit-tested without a DB.
// ---------------------------------------------------------------------------

// Parse a datetime-local value ("YYYY-MM-DDTHH:mm", optionally ":ss") as a wall
// time in `timeZone` and return the exact UTC instant. Returns null on any
// malformed input so the caller can reject rather than book a garbage time.
export function parseLocalInputToUtc(
  value: string,
  timeZone: string,
): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim(),
  );
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]); // 1-12
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  // The optional seconds group is validated even though we schedule at minute
  // granularity (Codex S442 P3): otherwise a forged value like "...T18:00:99"
  // slips through the malformed/out-of-range guard. Present-but-out-of-range
  // seconds are rejected; a valid value is dropped to :00 (slots are minute-aligned).
  const second = m[6] != null ? Number(m[6]) : 0;
  if (month1 < 1 || month1 > 12) return null;
  if (day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = zonedWallTimeToUtc(year, month1, day, hour * 60 + minute, timeZone);
  // Reject a wall time that the calendar rolled over (e.g. Feb 30 -> Mar 2): the
  // UTC instant, read back in the zone, must land on the same Y/M/D.
  const seen = ymdInTz(utc.getTime(), timeZone);
  if (seen.year !== year || seen.month !== month1 || seen.day !== day) {
    return null;
  }
  return utc;
}

// Format a UTC instant as the "YYYY-MM-DDTHH:mm" wall-clock string that a
// datetime-local input expects, in `timeZone`. Used to pre-fill the reschedule
// input with the viewing's current time.
export function utcToLocalInputValue(iso: string, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(iso));
  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;
  // en-CA renders "24" for midnight in some engines; normalize to "00".
  const hour = map.hour === "24" ? "00" : map.hour;
  return `${map.year}-${map.month}-${map.day}T${hour}:${map.minute}`;
}
