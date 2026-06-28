// Pure end-of-life math for the per-unit smoke/CO detector inventory (S359).
// NO DB / env / I/O so it unit-tests cleanly via `npx tsx scripts/test-detector-eol.ts`.
// The impure pieces (per-org queries, the once-per-lifecycle stamp, the send)
// live in app/api/cron/detector-eol/route.ts; copy/recipients/branding ride the
// notification substrate (lib/notifications*) exactly like the rent-increase
// autopilot. The nudge SELECTION + idempotency live in lib/detector-eol-sweep.ts.
//
// Service-life basis (verified S359): smoke alarms replace ~10 years from
// manufacture, CO alarms ~5-10 (commonly 7), combination smoke+CO ~10, per
// manufacturer end-of-life / NFPA guidance. Owner can override per detector.
// We frame the reminder as MANUFACTURER end-of-life ("confirm your unit's date
// and your local fire code"); we do NOT assert a specific regulation as the
// trigger — the legal-duty citation stays on the generic landlord_fire_safety
// event.

export type DetectorType = "smoke" | "co" | "combo";

// Per-type default manufacturer service life, in years. Owner-overridable per
// detector via unit_detectors.service_life_years.
export const TYPE_SERVICE_LIFE_YEARS: Record<DetectorType, number> = {
  smoke: 10,
  co: 7,
  combo: 10,
};

// How far before the end-of-life date the reminder starts firing — enough lead
// to order the RIGHT type and combine the trip rather than react to a beep.
export const DETECTOR_LEAD_DAYS = 90;

export type DetectorStatus = "unknown" | "ok" | "due_soon" | "overdue";

// The statuses that warrant a proactive reminder (the actionable band). `unknown`
// (no install date/year) and `ok` (more than the lead window away) are excluded.
export const DETECTOR_ACTIONABLE_STATUSES: readonly DetectorStatus[] = [
  "due_soon",
  "overdue",
] as const;

// Most-urgent first, for ordering due detectors in the per-unit email + summary.
export const DETECTOR_URGENCY: Record<string, number> = {
  overdue: 0,
  due_soon: 1,
};

export function detectorTypeLabel(type: DetectorType): string {
  switch (type) {
    case "smoke":
      return "Smoke";
    case "co":
      return "Carbon monoxide";
    case "combo":
      return "Smoke + CO (combo)";
  }
}

/** The minimal detector shape the EOL math needs (a subset of the DB row). */
export type DetectorInput = {
  detector_type: DetectorType;
  install_date?: string | null; // 'YYYY-MM-DD'
  install_year?: number | null;
  service_life_years?: number | null;
};

/** The service life to use: the owner override if set + sane, else the type default. */
export function effectiveServiceLifeYears(d: DetectorInput): number {
  const override = d.service_life_years;
  if (override != null && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  return TYPE_SERVICE_LIFE_YEARS[d.detector_type];
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
  // Clamp Feb 29 in a non-leap target year.
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
export function detectorInstallAnchor(d: DetectorInput): string | null {
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
export function computeEolDate(d: DetectorInput): string | null {
  const anchor = detectorInstallAnchor(d);
  if (anchor == null) return null;
  return addYears(anchor, effectiveServiceLifeYears(d));
}

/**
 * The reminder status of a detector relative to `today` ('YYYY-MM-DD'):
 *   - unknown  : no EOL date (install unknown)
 *   - overdue  : today is at/after the EOL date
 *   - due_soon : within DETECTOR_LEAD_DAYS before the EOL date
 *   - ok       : more than the lead window away
 * Pure; `today` is supplied by the caller (org-local in the cron).
 */
export function detectorStatus(
  eolDate: string | null,
  today: string,
  leadDays: number = DETECTOR_LEAD_DAYS,
): DetectorStatus {
  if (eolDate == null) return "unknown";
  const daysToEol = daysBetween(today, eolDate);
  if (daysToEol == null) return "unknown";
  if (daysToEol <= 0) return "overdue";
  if (daysToEol <= leadDays) return "due_soon";
  return "ok";
}

/** True when a status is in the actionable band (worth an email). */
export function isActionableDetectorStatus(status: DetectorStatus): boolean {
  return (DETECTOR_ACTIONABLE_STATUSES as readonly string[]).includes(status);
}
