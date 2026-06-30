// Pure repair-scheduling matcher (no I/O) so it can be unit-tested in isolation.
//
// THE PROBLEM (Noam, S385): a repair visit has TWO timing constraints — the
// supplier offers fixed ARRIVAL windows (e.g. Enercare 8-12 / 1-4 / 5-9, which
// vary in start/length day to day) AND the tenant has their own availability.
// Today the operator is the human go-between. This module collects both sides'
// windows and computes where they line up, so the operator stops relaying.
//
// KEY SEMANTIC (why this is NOT a naive intersection): a supplier arrival window
// means "we'll arrive sometime in this block" — arrival is unpredictable within
// it — so a window is only safely BOOKABLE when the tenant is available for the
// WHOLE block (containment), not merely for some overlap. We therefore classify
// each supplier window as available / partial / unavailable against the tenant's
// availability, and expose the gaps so the operator can ask the tenant to extend.
// A generic overlap helper is also provided for the case where a supplier gives
// an exact-time visit (not an arrival block) and the operator wants any common
// slot.
//
// All times are wall-clock minutes-from-local-midnight on a given calendar date
// in the org's timezone. Converting a chosen (date, start_minute) to a UTC
// instant for reminders is the reminder slice's job (it reuses lib/booking's
// tz-aware helpers); this module stays timezone-free and fully deterministic.

// --- Window model -----------------------------------------------------------

/** A time-of-day window on a single local date. */
export type DayWindow = {
  date: string; // YYYY-MM-DD, org-local
  start_minute: number; // minutes from local midnight, 0..1440
  end_minute: number; // > start_minute, <= 1440
  label?: string; // optional supplier label, e.g. "Morning (8-12)"
};

/** A start/end pair within one (implicit) date. */
export type Interval = { start_minute: number; end_minute: number };

export const MINUTES_PER_DAY = 1440;

/**
 * A partial match must cover at least this many minutes to be worth surfacing
 * (so a 10-minute sliver of overlap isn't offered as a near-miss).
 */
export const DEFAULT_MIN_PARTIAL_MINUTES = 60;

// Common arrival-window presets an operator can drop in then EDIT per job. These
// are convenience defaults only — Noam was explicit that real supplier blocks
// vary day to day, so the operator always adjusts them; nothing here is a fixed
// rule the matcher relies on.
export const COMMON_ARRIVAL_WINDOW_PRESETS: ReadonlyArray<{
  label: string;
  start_minute: number;
  end_minute: number;
}> = [
  { label: "Morning (8 AM - 12 PM)", start_minute: 8 * 60, end_minute: 12 * 60 },
  { label: "Afternoon (1 PM - 4 PM)", start_minute: 13 * 60, end_minute: 16 * 60 },
  { label: "Evening (5 PM - 9 PM)", start_minute: 17 * 60, end_minute: 21 * 60 },
];

// --- Date + validation ------------------------------------------------------

/** True for a real "YYYY-MM-DD" calendar date (round-trips through Date.UTC). */
export function isValidIsoDate(s: string | null | undefined): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? "").trim());
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === mo - 1 &&
    dt.getUTCDate() === d
  );
}

export type WindowValidation =
  | { ok: true; value: DayWindow }
  | { ok: false; code: string };

/**
 * Validate one window: a real date, integer minutes in [0, 1440], and
 * start strictly before end. Label is trimmed (optional). Codes: date / range /
 * order.
 */
export function validateDayWindow(w: {
  date: string;
  start_minute: number;
  end_minute: number;
  label?: string | null;
}): WindowValidation {
  if (!isValidIsoDate(w.date)) return { ok: false, code: "date" };
  const s = w.start_minute;
  const e = w.end_minute;
  if (
    !Number.isInteger(s) ||
    !Number.isInteger(e) ||
    s < 0 ||
    e < 0 ||
    s > MINUTES_PER_DAY ||
    e > MINUTES_PER_DAY
  ) {
    return { ok: false, code: "range" };
  }
  if (s >= e) return { ok: false, code: "order" };
  const label = (w.label ?? "").trim();
  return {
    ok: true,
    value: { date: w.date.trim(), start_minute: s, end_minute: e, ...(label ? { label } : {}) },
  };
}

/** Keep only the valid windows from a raw list (invalid ones are dropped). */
export function normalizeWindows(
  raw: ReadonlyArray<{ date: string; start_minute: number; end_minute: number; label?: string | null }>,
): DayWindow[] {
  const out: DayWindow[] = [];
  for (const w of raw) {
    const v = validateDayWindow(w);
    if (v.ok) out.push(v.value);
  }
  return out;
}

// --- Remembered supplier rules (Noam, S386) ---------------------------------
//
// "It should REMEMBER a supplier's preferred booking rules, although understand
// these change." A supplier (trade contact) carries a saved set of weekday-based
// preferred windows — the starting point the operator drops onto a job. Because
// the real offered blocks shift day to day, the rule set is only a DEFAULT: we
// expand it onto the job's concrete dates, then the operator EDITS the resulting
// windows per job. The saved rules persist on the trade contact (Slice 2); this
// pure layer just defines them + the expansion. Weekday convention matches
// lib/booking: 0=Sunday .. 6=Saturday — so WEEKENDS are first-class. A rule is
// NOT necessarily tied to a weekday (Noam, S386): `weekday: null` means the rule
// applies to EVERY date in play (a supplier who offers the same blocks any day),
// while a 0..6 value scopes it to that day (incl. Sat/Sun).

export type SupplierWindowRule = {
  weekday: number | null; // 0=Sun .. 6=Sat, or null = applies every day
  start_minute: number;
  end_minute: number;
  label?: string;
};

/** Weekday (0=Sun..6=Sat) of a "YYYY-MM-DD", UTC-pinned. Null on a bad date. */
export function weekdayOfIsoDate(date: string): number | null {
  if (!isValidIsoDate(date)) return null;
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function isValidSupplierRule(r: {
  weekday: number | null;
  start_minute: number;
  end_minute: number;
}): boolean {
  const weekdayOk =
    r.weekday === null || (Number.isInteger(r.weekday) && r.weekday >= 0 && r.weekday <= 6);
  return (
    weekdayOk &&
    Number.isInteger(r.start_minute) &&
    Number.isInteger(r.end_minute) &&
    r.start_minute >= 0 &&
    r.end_minute <= MINUTES_PER_DAY &&
    r.start_minute < r.end_minute
  );
}

/**
 * Expand a supplier's saved weekday rules onto a concrete list of dates → the
 * editable DayWindow set the operator starts a job from. Invalid rules/dates are
 * skipped; the result is normalized + sorted. This is a DEFAULT to edit, never a
 * commitment (the supplier's real blocks vary, so the operator adjusts).
 */
export function expandRulesToDates(
  rules: ReadonlyArray<SupplierWindowRule>,
  dates: ReadonlyArray<string>,
): DayWindow[] {
  const out: DayWindow[] = [];
  for (const date of dates) {
    const wd = weekdayOfIsoDate(date);
    if (wd === null) continue;
    for (const r of rules) {
      if (!isValidSupplierRule(r)) continue;
      // null weekday = every day; a 0..6 value scopes to that day (incl. weekends).
      if (r.weekday !== null && r.weekday !== wd) continue;
      out.push({
        date,
        start_minute: r.start_minute,
        end_minute: r.end_minute,
        ...(r.label && r.label.trim() ? { label: r.label.trim() } : {}),
      });
    }
  }
  return normalizeWindows(out).sort(
    (a, b) => a.date.localeCompare(b.date) || a.start_minute - b.start_minute,
  );
}

// --- Window-list maintenance (used by the server actions) -------------------

/** Stable identity of a window for add/remove/dedupe (date + minutes). */
export function windowKey(w: DayWindow): string {
  return `${w.date}|${w.start_minute}|${w.end_minute}`;
}

/** Sort windows by date then start (stable order for display + storage). */
export function sortWindows(list: ReadonlyArray<DayWindow>): DayWindow[] {
  return list
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.start_minute - b.start_minute);
}

/** De-dupe by windowKey (keep the first seen) and sort. */
export function dedupeWindows(list: ReadonlyArray<DayWindow>): DayWindow[] {
  const seen = new Set<string>();
  const out: DayWindow[] = [];
  for (const w of list) {
    const k = windowKey(w);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return sortWindows(out);
}

/** Convert a set of concrete windows into remembered weekday rules (for "save as default"). */
export function windowsToRules(list: ReadonlyArray<DayWindow>): SupplierWindowRule[] {
  const seen = new Set<string>();
  const out: SupplierWindowRule[] = [];
  for (const w of list) {
    const wd = weekdayOfIsoDate(w.date);
    if (wd === null) continue;
    const k = `${wd}|${w.start_minute}|${w.end_minute}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      weekday: wd,
      start_minute: w.start_minute,
      end_minute: w.end_minute,
      ...(w.label ? { label: w.label } : {}),
    });
  }
  return out.sort(
    (a, b) => (a.weekday ?? -1) - (b.weekday ?? -1) || a.start_minute - b.start_minute,
  );
}

/** Distinct, sorted dates present across a window list (the dates "in play"). */
export function datesInPlay(list: ReadonlyArray<DayWindow>): string[] {
  return Array.from(new Set(list.map((w) => w.date))).sort((a, b) => a.localeCompare(b));
}

// --- Interval algebra (single-date) -----------------------------------------

/** Merge a set of intervals into a sorted, disjoint union. Adjacent (touching) intervals merge. */
export function mergeIntervals(intervals: ReadonlyArray<Interval>): Interval[] {
  const sorted = intervals
    .filter((i) => i.end_minute > i.start_minute)
    .slice()
    .sort((a, b) => a.start_minute - b.start_minute || a.end_minute - b.end_minute);
  const out: Interval[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (last && cur.start_minute <= last.end_minute) {
      // overlapping or touching → extend
      if (cur.end_minute > last.end_minute) last.end_minute = cur.end_minute;
    } else {
      out.push({ start_minute: cur.start_minute, end_minute: cur.end_minute });
    }
  }
  return out;
}

/** The parts of `window` that fall inside the union `avail` (clipped overlaps). */
export function intersectInterval(window: Interval, avail: ReadonlyArray<Interval>): Interval[] {
  const merged = mergeIntervals(avail);
  const out: Interval[] = [];
  for (const a of merged) {
    const lo = Math.max(window.start_minute, a.start_minute);
    const hi = Math.min(window.end_minute, a.end_minute);
    if (hi > lo) out.push({ start_minute: lo, end_minute: hi });
  }
  return out;
}

/** The parts of `window` NOT covered by `covered` (which must be sorted/disjoint within window). */
export function subtractCovered(window: Interval, covered: ReadonlyArray<Interval>): Interval[] {
  const within = mergeIntervals(
    covered
      .map((c) => ({
        start_minute: Math.max(window.start_minute, c.start_minute),
        end_minute: Math.min(window.end_minute, c.end_minute),
      }))
      .filter((c) => c.end_minute > c.start_minute),
  );
  const gaps: Interval[] = [];
  let cursor = window.start_minute;
  for (const c of within) {
    if (c.start_minute > cursor) gaps.push({ start_minute: cursor, end_minute: c.start_minute });
    cursor = Math.max(cursor, c.end_minute);
  }
  if (cursor < window.end_minute) gaps.push({ start_minute: cursor, end_minute: window.end_minute });
  return gaps;
}

export function intervalMinutes(intervals: ReadonlyArray<Interval>): number {
  return intervals.reduce((sum, i) => sum + Math.max(0, i.end_minute - i.start_minute), 0);
}

// --- The matcher (supplier arrival windows vs tenant availability) ----------

export type MatchStatus = "available" | "partial" | "unavailable";

export type SupplierWindowMatch = {
  window: DayWindow; // the supplier-offered arrival window
  status: MatchStatus;
  covered: Interval[]; // tenant-available sub-ranges within the window
  gaps: Interval[]; // sub-ranges the tenant is NOT available (what to ask them to extend)
  coveredMinutes: number;
};

/** Group windows by date into a union of intervals per date. */
function unionByDate(windows: ReadonlyArray<DayWindow>): Map<string, Interval[]> {
  const byDate = new Map<string, Interval[]>();
  for (const w of windows) {
    const list = byDate.get(w.date) ?? [];
    list.push({ start_minute: w.start_minute, end_minute: w.end_minute });
    byDate.set(w.date, list);
  }
  for (const [k, v] of byDate) byDate.set(k, mergeIntervals(v));
  return byDate;
}

/**
 * Classify each supplier window against the tenant's availability:
 *  - available   = the tenant is free for the WHOLE arrival window (no gaps);
 *  - partial     = covered for >= minPartialMinutes but with gaps;
 *  - unavailable = covered for less than that.
 * Sorted by date then start. The supplier windows are normalized first so
 * invalid rows are ignored. PURE.
 */
export function matchSupplierWindows(
  supplier: ReadonlyArray<DayWindow>,
  tenant: ReadonlyArray<DayWindow>,
  opts: { minPartialMinutes?: number } = {},
): SupplierWindowMatch[] {
  const minPartial = opts.minPartialMinutes ?? DEFAULT_MIN_PARTIAL_MINUTES;
  const tenantByDate = unionByDate(tenant);
  const out: SupplierWindowMatch[] = [];
  for (const w of supplier) {
    const avail = tenantByDate.get(w.date) ?? [];
    const covered = intersectInterval({ start_minute: w.start_minute, end_minute: w.end_minute }, avail);
    const gaps = subtractCovered({ start_minute: w.start_minute, end_minute: w.end_minute }, covered);
    const coveredMinutes = intervalMinutes(covered);
    const windowMinutes = w.end_minute - w.start_minute;
    let status: MatchStatus;
    if (gaps.length === 0 && coveredMinutes >= windowMinutes) status = "available";
    else if (coveredMinutes >= minPartial) status = "partial";
    else status = "unavailable";
    out.push({ window: w, status, covered, gaps, coveredMinutes });
  }
  return out.sort(
    (a, b) =>
      a.window.date.localeCompare(b.window.date) ||
      a.window.start_minute - b.window.start_minute,
  );
}

/** Just the directly-bookable supplier windows (tenant free for the whole block). */
export function availableSupplierWindows(
  supplier: ReadonlyArray<DayWindow>,
  tenant: ReadonlyArray<DayWindow>,
): SupplierWindowMatch[] {
  return matchSupplierWindows(supplier, tenant).filter((m) => m.status === "available");
}

/**
 * Generic common-time overlaps, for the case where a supplier gives an EXACT-time
 * visit (not an arrival block) and the operator just wants any window that suits
 * both. Returns merged overlap intervals per date with overlap >= minOverlap.
 * (For arrival blocks use matchSupplierWindows instead — see the module note.)
 */
export type OverlapCandidate = { date: string } & Interval;

export function intersectWindows(
  supplier: ReadonlyArray<DayWindow>,
  tenant: ReadonlyArray<DayWindow>,
  opts: { minOverlapMinutes?: number } = {},
): OverlapCandidate[] {
  const minOverlap = opts.minOverlapMinutes ?? 1;
  const supplierByDate = unionByDate(supplier);
  const tenantByDate = unionByDate(tenant);
  const out: OverlapCandidate[] = [];
  for (const [date, sIntervals] of supplierByDate) {
    const tIntervals = tenantByDate.get(date);
    if (!tIntervals) continue;
    for (const s of sIntervals) {
      for (const overlap of intersectInterval(s, tIntervals)) {
        if (overlap.end_minute - overlap.start_minute >= minOverlap) {
          out.push({ date, ...overlap });
        }
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.start_minute - b.start_minute);
}

// --- Formatting -------------------------------------------------------------

/** "8:00 AM" from minutes-of-day. 1440 → "12:00 AM" (midnight, next-day end). */
export function formatClock(minute: number): string {
  const m = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ampm}`;
}

/** "8:00 AM - 12:00 PM" (hyphen, house style). */
export function formatWindowClock(start: number, end: number): string {
  return `${formatClock(start)} - ${formatClock(end)}`;
}

/** A single window as "Jun 30: 8:00 AM - 12:00 PM" (date UTC-pinned, tz-safe). */
export function formatDayWindow(w: DayWindow): string {
  const day = formatIsoDateShort(w.date);
  return `${day}: ${formatWindowClock(w.start_minute, w.end_minute)}`;
}

/** "Jun 30" from "YYYY-MM-DD", UTC-pinned so server (UTC) and browser agree. */
export function formatIsoDateShort(date: string): string {
  if (!isValidIsoDate(date)) return "";
  const [y, m, d] = date.split("-").map((n) => parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  available: "Works for both",
  partial: "Partly available",
  unavailable: "Tenant not available",
};

export const MATCH_STATUS_TONES: Record<MatchStatus, "green" | "amber" | "gray"> = {
  available: "green",
  partial: "amber",
  unavailable: "gray",
};

export function matchStatusLabel(status: string): string {
  return (MATCH_STATUS_LABELS as Record<string, string>)[status] ?? status;
}
export function matchStatusTone(status: string): "green" | "amber" | "gray" {
  return (MATCH_STATUS_TONES as Record<string, "green" | "amber" | "gray">)[status] ?? "gray";
}
