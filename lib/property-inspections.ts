// Pure status math for the per-tenancy property inspection log (S385) — the
// tenancy-scoped sibling of the lease-violation log (lib/lease-violations.ts)
// and the renter's-insurance tracker (lib/tenancy-insurance.ts). NO DB / env /
// I/O so it unit-tests cleanly via `npx tsx scripts/test-property-inspections.ts`.
// The impure pieces (per-org queries, the once-per-date stamp, the send) live in
// app/api/cron/inspection-reminder/route.ts; the nudge SELECTION + idempotency
// live in lib/property-inspections-sweep.ts. Copy/recipients/branding ride the
// notification substrate (lib/notifications*) exactly like every other reminder.
//
// An inspection carries an OPTIONAL planned date (scheduled_for). When set, and
// while the record is still 'scheduled', the date drives a reminder: a lead
// before it, plus an overdue fire once it passes, so the move-in / move-out /
// periodic inspection (and the written notice the landlord must give the tenant)
// doesn't get forgotten. An inspection with no planned date is simply a logged
// record (no reminder); a completed/skipped/canceled one stops reminding.

// Default lead window: start nudging this many days before a planned inspection.
// A week's heads-up is enough to give the tenant the required written notice and
// book a time; the overdue fire then catches a date that slipped.
export const INSPECTION_LEAD_DAYS = 7;

// --- Inspection types -------------------------------------------------------
// Mirrors the DB CHECK on tenancy_inspections.inspection_type. 'other' is the
// catch-all (detail goes in notes).
export const INSPECTION_TYPES = [
  "move_in",
  "move_out",
  "periodic",
  "other",
] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];

const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  move_in: "Move-in inspection",
  move_out: "Move-out inspection",
  periodic: "Periodic inspection",
  other: "Other inspection",
};

export function isInspectionType(v: string): v is InspectionType {
  return (INSPECTION_TYPES as readonly string[]).includes(v);
}

/** Human label for an inspection type; unknown/blank falls back to "Other". */
export function inspectionTypeLabel(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return isInspectionType(t) ? INSPECTION_TYPE_LABELS[t] : INSPECTION_TYPE_LABELS.other;
}

// --- Lifecycle --------------------------------------------------------------
// Mirrors the DB CHECK on tenancy_inspections.status. Only 'scheduled' is acted
// on by the reminder; the rest are terminal/parked states that silence the nudge.
export const INSPECTION_STATUSES = [
  "scheduled",
  "completed",
  "skipped",
  "canceled",
] as const;
export type InspectionLifecycle = (typeof INSPECTION_STATUSES)[number];

const LIFECYCLE_LABELS: Record<InspectionLifecycle, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  skipped: "Skipped",
  canceled: "Canceled",
};

export function isInspectionLifecycle(v: string): v is InspectionLifecycle {
  return (INSPECTION_STATUSES as readonly string[]).includes(v);
}

export function inspectionLifecycleLabel(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return isInspectionLifecycle(t) ? LIFECYCLE_LABELS[t] : LIFECYCLE_LABELS.scheduled;
}

// --- Reminder band ----------------------------------------------------------
// The COMPUTED state of a record relative to its planned date + lifecycle —
// distinct from the stored lifecycle status above.
export type InspectionDueStatus = "none" | "ok" | "approaching" | "overdue";

// The statuses that warrant a reminder (the actionable band).
export const INSPECTION_DUE_ACTIONABLE_STATUSES: readonly InspectionDueStatus[] = [
  "approaching",
  "overdue",
] as const;

// Most-urgent first, for ordering due items in the per-tenancy email + summary.
export const INSPECTION_URGENCY: Record<string, number> = {
  overdue: 0,
  approaching: 1,
};

/** The minimal record shape the status math needs (a subset of the DB row). */
export type InspectionInput = {
  status?: string | null;
  scheduled_for?: string | null; // 'YYYY-MM-DD'
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

/** Whole days from `a` to `b` ('YYYY-MM-DD'); positive when b is after a. */
export function daysBetween(a: string, b: string): number | null {
  const ma = parseYmd(a);
  const mb = parseYmd(b);
  if (ma == null || mb == null) return null;
  return Math.round((mb - ma) / 86_400_000);
}

/**
 * The planned-date anchor for the reminder clock as 'YYYY-MM-DD': the record's
 * scheduled_for if present + well-formed AND the record is still scheduled, else
 * null (no anchor => no reminder). A non-scheduled record never reminds.
 */
export function reminderAnchor(d: InspectionInput): string | null {
  const lifecycle = (d.status ?? "scheduled").trim() || "scheduled";
  if (lifecycle !== "scheduled") return null;
  if (d.scheduled_for && parseYmd(d.scheduled_for) != null) return d.scheduled_for.trim();
  return null;
}

/**
 * The due status of a record relative to `today` ('YYYY-MM-DD'):
 *   - none        : not scheduled, or no planned date on file (no reminder)
 *   - overdue     : today is at/after the planned date (it hasn't been done)
 *   - approaching : within `leadDays` before the planned date
 *   - ok          : more than the lead window away
 * Pure; both `today` and `leadDays` are supplied by the caller.
 */
export function dueStatus(
  scheduledFor: string | null,
  today: string,
  leadDays: number = INSPECTION_LEAD_DAYS,
): InspectionDueStatus {
  if (scheduledFor == null) return "none";
  const daysToDue = daysBetween(today, scheduledFor);
  if (daysToDue == null) return "none";
  if (daysToDue <= 0) return "overdue";
  if (daysToDue <= leadDays) return "approaching";
  return "ok";
}

/** Convenience: compute the due status straight from a record + today. */
export function dueStatusFor(
  d: InspectionInput,
  today: string,
  leadDays: number = INSPECTION_LEAD_DAYS,
): InspectionDueStatus {
  return dueStatus(reminderAnchor(d), today, leadDays);
}

/** True when a due status is in the actionable band (worth an email). */
export function isActionableInspectionDueStatus(status: InspectionDueStatus): boolean {
  return (INSPECTION_DUE_ACTIONABLE_STATUSES as readonly string[]).includes(status);
}
