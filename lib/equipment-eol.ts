// Pure end-of-life math for the per-unit major-equipment inventory (S361) —
// water heaters + furnaces, the sibling of the detector inventory (lib/detector-
// eol.ts). NO DB / env / I/O so it unit-tests cleanly via
// `npx tsx scripts/test-equipment-eol.ts`. The impure pieces (per-org queries,
// the once-per-lifecycle stamp, the send) live in app/api/cron/equipment-eol/
// route.ts; copy/recipients/branding ride the notification substrate
// (lib/notifications*) exactly like the rent-increase autopilot. The nudge
// SELECTION + idempotency live in lib/equipment-eol-sweep.ts.
//
// Service-life basis (verified S361): tank water heaters last ~8-12 years (gas) /
// 10-15 (electric); gas furnaces ~15-20 (electric 20-30). We default to the
// PROACTIVE-replace age, not the failure age: ~60-70% of water-heater failures
// after year 10 cause water damage (Consumer Reports recommends replacing at 10),
// and a furnace is best replaced in the off-season before the next heating season.
// Owner can override per item (covers tankless ~20 / electric furnace ~25). We
// frame the reminder as MANUFACTURER end-of-life ("confirm your unit's date");
// we assert no specific regulation as the trigger.

export type EquipmentType = "water_heater" | "furnace";

// Per-type default manufacturer service life, in years. Owner-overridable per
// item via unit_equipment.service_life_years.
export const TYPE_SERVICE_LIFE_YEARS: Record<EquipmentType, number> = {
  water_heater: 10,
  furnace: 15,
};

// Per-type reminder lead window (days before the EOL date to start nudging).
// Unlike detectors (one flat 90-day window), major equipment's runway is set by
// its failure mode:
//   * water_heater 120d (~4mo): budget + a business-hours replacement before the
//     post-10-year flood-failure cliff — an emergency swap runs 30-50% more and
//     risks thousands in water damage.
//   * furnace 180d (~6mo): plan an off-season (spring/early-summer) install
//     before the next heating season, not a mid-winter emergency at peak pricing
//     (and, in Ontario, a heat-habitability obligation).
export const TYPE_LEAD_DAYS: Record<EquipmentType, number> = {
  water_heater: 120,
  furnace: 180,
};

// Fallback lead window if a type ever lacks an explicit entry (defensive).
export const EQUIPMENT_LEAD_DAYS_FALLBACK = 120;

export type EquipmentStatus = "unknown" | "ok" | "due_soon" | "overdue";

// The statuses that warrant a proactive reminder (the actionable band). `unknown`
// (no install date/year) and `ok` (more than the lead window away) are excluded.
export const EQUIPMENT_ACTIONABLE_STATUSES: readonly EquipmentStatus[] = [
  "due_soon",
  "overdue",
] as const;

// Most-urgent first, for ordering due items in the per-unit email + summary.
export const EQUIPMENT_URGENCY: Record<string, number> = {
  overdue: 0,
  due_soon: 1,
};

export function equipmentTypeLabel(type: EquipmentType): string {
  switch (type) {
    case "water_heater":
      return "Water heater";
    case "furnace":
      return "Furnace";
  }
}

/** The minimal equipment shape the EOL math needs (a subset of the DB row). */
export type EquipmentInput = {
  equipment_type: EquipmentType;
  install_date?: string | null; // 'YYYY-MM-DD'
  install_year?: number | null;
  service_life_years?: number | null;
};

/** The service life to use: the owner override if set + sane, else the type default. */
export function effectiveServiceLifeYears(d: EquipmentInput): number {
  const override = d.service_life_years;
  if (override != null && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return TYPE_SERVICE_LIFE_YEARS[d.equipment_type];
}

/** The lead window (days) to use for a given equipment type. */
export function equipmentLeadDays(type: EquipmentType): number {
  return TYPE_LEAD_DAYS[type] ?? EQUIPMENT_LEAD_DAYS_FALLBACK;
}

// --- Pure date helpers on 'YYYY-MM-DD' strings (no Date tz pitfalls) ---------

/** Parse 'YYYY-MM-DD' to a UTC-midnight ms, or null if malformed. */
function parseYmd(ymd: string | null | undefined): number | null {
  if (!ymd) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return Date.UTC(y, mo - 1, d);
}

/** Format a {y,m,d} back to 'YYYY-MM-DD'. */
function fmt(y: number, m1: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m1)}-${p(d)}`;
}

/** Add whole years to a 'YYYY-MM-DD' string, clamping Feb 29 -> Feb 28. */
function addYears(ymd: string, years: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)!;
  let y = Number(m[1]) + years;
  let mo = Number(m[2]);
  let d = Number(m[3]);
  if (mo === 2 && d === 29) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (!leap) d = 28;
  }
  return fmt(y, mo, d);
}

/** Whole days from `a` to `b` ('YYYY-MM-DD'); positive when b is after a. */
export function daysBetween(a: string, b: string): number | null {
  const ma = parseYmd(a);
  const mb = parseYmd(b);
  if (ma == null || mb == null) return null;
  return Math.round((mb - ma) / 86_400_000);
}

/**
 * The install anchor for the EOL clock as 'YYYY-MM-DD': the exact install_date
 * if present, else Jan 1 of install_year (conservative — treating a bare year as
 * its START means we warn early, never late). Null when neither is known.
 */
export function equipmentInstallAnchor(d: EquipmentInput): string | null {
  if (d.install_date && parseYmd(d.install_date) != null) return d.install_date.trim();
  if (d.install_year != null && Number.isFinite(d.install_year)) {
    return fmt(Math.floor(d.install_year), 1, 1);
  }
  return null;
}

/**
 * The computed end-of-life date as 'YYYY-MM-DD' = install anchor + the effective
 * service life. Null when the install date/year is unknown. Computed (not stored)
 * so changing a type default or an override never needs a backfill.
 */
export function computeEolDate(d: EquipmentInput): string | null {
  const anchor = equipmentInstallAnchor(d);
  if (anchor == null) return null;
  return addYears(anchor, effectiveServiceLifeYears(d));
}

/**
 * The reminder status of an item relative to `today` ('YYYY-MM-DD'):
 *   - unknown  : no EOL date (install unknown)
 *   - overdue  : today is at/after the EOL date
 *   - due_soon : within `leadDays` before the EOL date
 *   - ok       : more than the lead window away
 * Pure; both `today` and `leadDays` are supplied by the caller (the cron/page
 * pass the per-type lead window via equipmentLeadDays()).
 */
export function equipmentStatus(
  eolDate: string | null,
  today: string,
  leadDays: number,
): EquipmentStatus {
  if (eolDate == null) return "unknown";
  const daysToEol = daysBetween(today, eolDate);
  if (daysToEol == null) return "unknown";
  if (daysToEol <= 0) return "overdue";
  if (daysToEol <= leadDays) return "due_soon";
  return "ok";
}

/** Convenience: compute the status straight from an item + today, using the
 *  item's per-type lead window. */
export function equipmentStatusFor(d: EquipmentInput, today: string): EquipmentStatus {
  return equipmentStatus(computeEolDate(d), today, equipmentLeadDays(d.equipment_type));
}

/** True when a status is in the actionable band (worth an email). */
export function isActionableEquipmentStatus(status: EquipmentStatus): boolean {
  return (EQUIPMENT_ACTIONABLE_STATUSES as readonly string[]).includes(status);
}
