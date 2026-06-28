// Pure care math for the per-unit appliance inventory (S362) — the sibling of
// lib/detector-eol.ts (one-shot end-of-life) and lib/equipment-eol.ts (one-shot,
// per-type lead). Appliances add the genuinely-new RECURRING reminder primitive
// on top of a one-shot warranty reminder. NO DB / env / I/O so it unit-tests
// cleanly via `npx tsx scripts/test-appliance-care.ts`. The impure pieces
// (per-org queries, the stamps, the send) live in app/api/cron/appliance-care/
// route.ts; copy/recipients/branding ride the notification substrate
// (lib/notifications*). The nudge SELECTION + idempotency live in
// lib/appliance-care-sweep.ts.
//
// Two independent reminders per appliance, each opt-in/dark on its own event:
//   1. WARRANTY (one-shot): purchase anchor + warranty_months => expiry date.
//      Fires once when it enters WARRANTY_LEAD_DAYS before expiry, so the landlord
//      registers / uses the warranty before it lapses. Identical shape to the
//      detector/equipment EOL one-shot (stamp the stable expiry date).
//   2. CONSUMABLE (RECURRING): a labelled consumable (e.g. "Water filter") with
//      an interval in months, anchored to the last time it was replaced. The next
//      due date = anchor + interval; fires once when it enters CONSUMABLE_LEAD_DAYS
//      before that date. A one-tap "Mark replaced" rolls the anchor to today, so
//      the next due date advances one cycle and the reminder re-arms. This is the
//      recurrence the once-per-lifecycle detector/equipment sweep does NOT cover.

export type ApplianceType =
  | "fridge"
  | "stove"
  | "dishwasher"
  | "washer"
  | "dryer"
  | "microwave"
  | "other";

export const APPLIANCE_TYPES: readonly ApplianceType[] = [
  "fridge",
  "stove",
  "dishwasher",
  "washer",
  "dryer",
  "microwave",
  "other",
] as const;

export function applianceTypeLabel(type: ApplianceType): string {
  switch (type) {
    case "fridge":
      return "Refrigerator";
    case "stove":
      return "Stove / range";
    case "dishwasher":
      return "Dishwasher";
    case "washer":
      return "Washer";
    case "dryer":
      return "Dryer";
    case "microwave":
      return "Microwave";
    case "other":
      return "Appliance";
  }
}

// Lead windows (days before the target date to start nudging).
//   * warranty 45d (~6wk): time to find the receipt, register, or file a claim
//     before the manufacturer warranty lapses.
//   * consumable 21d (~3wk): time to order the right filter/part and swap it.
export const WARRANTY_LEAD_DAYS = 45;
export const CONSUMABLE_LEAD_DAYS = 21;

export type ApplianceStatus = "unknown" | "ok" | "due_soon" | "overdue";

// The statuses that warrant a reminder (the actionable band). `unknown` (no
// target date) and `ok` (more than the lead window away) are excluded.
export const APPLIANCE_ACTIONABLE_STATUSES: readonly ApplianceStatus[] = [
  "due_soon",
  "overdue",
] as const;

// Most-urgent first, for ordering due items in the per-unit email + summary.
export const APPLIANCE_URGENCY: Record<string, number> = {
  overdue: 0,
  due_soon: 1,
};

export function isActionableApplianceStatus(status: ApplianceStatus): boolean {
  return (APPLIANCE_ACTIONABLE_STATUSES as readonly string[]).includes(status);
}

/** The minimal appliance shape the care math needs (a subset of the DB row). */
export type ApplianceInput = {
  purchase_date?: string | null; // 'YYYY-MM-DD'
  install_year?: number | null;
  warranty_months?: number | null;
  consumable_label?: string | null;
  consumable_interval_months?: number | null;
  consumable_anchor_date?: string | null; // 'YYYY-MM-DD'
};

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

/** Format {y,m,d} back to 'YYYY-MM-DD'. */
function fmt(y: number, m1: number, d: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${y}-${p(m1)}-${p(d)}`;
}

/** Last valid day of a given (year, 1-based month). */
function lastDayOfMonth(y: number, m1: number): number {
  // Day 0 of next month = last day of this month.
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

/**
 * Add whole MONTHS to a 'YYYY-MM-DD' string, clamping the day to the last valid
 * day of the target month (e.g. Jan 31 + 1 month -> Feb 28/29). Returns a
 * 'YYYY-MM-DD' string; throws nothing (assumes a well-formed input).
 */
export function addMonths(ymd: string, months: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)!;
  const y0 = Number(m[1]);
  const mo0 = Number(m[2]); // 1-based
  const d0 = Number(m[3]);
  const total = (y0 * 12 + (mo0 - 1)) + months;
  const y = Math.floor(total / 12);
  const mo1 = (total % 12) + 1; // 1-based
  const d = Math.min(d0, lastDayOfMonth(y, mo1));
  return fmt(y, mo1, d);
}

/** Whole days from `a` to `b` ('YYYY-MM-DD'); positive when b is after a. */
export function daysBetween(a: string, b: string): number | null {
  const ma = parseYmd(a);
  const mb = parseYmd(b);
  if (ma == null || mb == null) return null;
  return Math.round((mb - ma) / 86_400_000);
}

/**
 * The purchase anchor as 'YYYY-MM-DD': the exact purchase_date if present, else
 * Jan 1 of install_year (conservative — a bare year treated as its START means we
 * warn early, never late). Null when neither is known.
 */
export function appliancePurchaseAnchor(d: ApplianceInput): string | null {
  if (d.purchase_date && parseYmd(d.purchase_date) != null) return d.purchase_date.trim();
  if (d.install_year != null && Number.isFinite(d.install_year)) {
    return fmt(Math.floor(d.install_year), 1, 1);
  }
  return null;
}

// --- Warranty (one-shot) -----------------------------------------------------

/**
 * The computed warranty-expiry date as 'YYYY-MM-DD' = purchase anchor +
 * warranty_months. Null when there's no warranty length or no purchase anchor.
 * Computed (not stored) so changing the purchase date or warranty length never
 * needs a backfill.
 */
export function warrantyExpiryDate(d: ApplianceInput): string | null {
  const months = d.warranty_months;
  if (months == null || !Number.isFinite(months) || months <= 0) return null;
  const anchor = appliancePurchaseAnchor(d);
  if (anchor == null) return null;
  return addMonths(anchor, Math.floor(months));
}

// --- Consumable (recurring) --------------------------------------------------

/** Whether a recurring consumable reminder is configured (label + interval). */
export function hasConsumable(d: ApplianceInput): boolean {
  const label = (d.consumable_label ?? "").trim();
  const interval = d.consumable_interval_months;
  return label.length > 0 && interval != null && Number.isFinite(interval) && interval > 0;
}

/**
 * The anchor for the recurring clock as 'YYYY-MM-DD': the explicit
 * consumable_anchor_date (the last time it was replaced) if present, else the
 * purchase anchor. Null when neither is known.
 */
export function consumableAnchor(d: ApplianceInput): string | null {
  if (d.consumable_anchor_date && parseYmd(d.consumable_anchor_date) != null) {
    return d.consumable_anchor_date.trim();
  }
  return appliancePurchaseAnchor(d);
}

/**
 * The next-due date for the recurring consumable as 'YYYY-MM-DD' = anchor + one
 * interval. Null when no consumable is configured or there's no anchor.
 *
 * Single-interval (not anchor + k*interval): the anchor is the LAST completed
 * replacement, so the next replacement is exactly one interval later. If the
 * landlord is overdue, the date sits in the past (a true "you're late" signal)
 * until they mark it replaced — which rolls the anchor to today and advances the
 * due date one cycle. This is what realises the recurrence (see the sweep).
 */
export function consumableDueDate(d: ApplianceInput): string | null {
  if (!hasConsumable(d)) return null;
  const anchor = consumableAnchor(d);
  if (anchor == null) return null;
  return addMonths(anchor, Math.floor(d.consumable_interval_months as number));
}

// --- Shared status banding ---------------------------------------------------

/**
 * The reminder status of a target date relative to `today` ('YYYY-MM-DD'):
 *   - unknown  : no target date
 *   - overdue  : today is at/after the target date
 *   - due_soon : within `leadDays` before the target date
 *   - ok       : more than the lead window away
 * Pure; `today` and `leadDays` are supplied by the caller.
 */
export function dateStatus(
  targetDate: string | null,
  today: string,
  leadDays: number,
): ApplianceStatus {
  if (targetDate == null) return "unknown";
  const daysToTarget = daysBetween(today, targetDate);
  if (daysToTarget == null) return "unknown";
  if (daysToTarget <= 0) return "overdue";
  if (daysToTarget <= leadDays) return "due_soon";
  return "ok";
}

/** Convenience: the warranty status straight from an appliance + today. */
export function warrantyStatusFor(d: ApplianceInput, today: string): ApplianceStatus {
  return dateStatus(warrantyExpiryDate(d), today, WARRANTY_LEAD_DAYS);
}

/** Convenience: the recurring-consumable status straight from an appliance + today. */
export function consumableStatusFor(d: ApplianceInput, today: string): ApplianceStatus {
  return dateStatus(consumableDueDate(d), today, CONSUMABLE_LEAD_DAYS);
}
