// Pure status math for the per-tenancy lease violation / notice log (S383) — the
// tenancy-scoped sibling of the renter's-insurance tracker (lib/tenancy-
// insurance.ts). NO DB / env / I/O so it unit-tests cleanly via
// `npx tsx scripts/test-lease-violations.ts`. The impure pieces (per-org
// queries, the once-per-deadline stamp, the send) live in
// app/api/cron/violation-followup/route.ts; the nudge SELECTION + idempotency
// live in lib/lease-violations-sweep.ts. Copy/recipients/branding ride the
// notification substrate (lib/notifications*) exactly like every other reminder.
//
// A violation carries an OPTIONAL remedy deadline (remedy_due_on). When set, and
// while the record is still open, the deadline drives a follow-up reminder: a
// short lead before it, plus an overdue fire once it passes, so the operator is
// prompted to verify-and-close-or-escalate before the window to act on a notice
// slips. A violation with no remedy deadline is simply a logged record (no
// reminder); the breach history still feeds the file.

// Default lead window: start nudging this many days before a remedy deadline. A
// few days is enough of a heads-up; the key fire is the overdue one (the moment
// to check whether the tenant actually remedied).
export const FOLLOWUP_LEAD_DAYS = 3;

// --- Breach types -----------------------------------------------------------
// Mirrors the DB CHECK on tenancy_violations.violation_type. 'other' is the
// catch-all (detail goes in the description).
export const VIOLATION_TYPES = [
  "late_rent",
  "noise",
  "property_damage",
  "unauthorized_occupant",
  "smoking",
  "pet",
  "cleanliness",
  "safety",
  "illegal_activity",
  "other",
] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

const VIOLATION_TYPE_LABELS: Record<ViolationType, string> = {
  late_rent: "Late / missed rent",
  noise: "Noise / disturbance",
  property_damage: "Property damage",
  unauthorized_occupant: "Unauthorized occupant",
  smoking: "Smoking",
  pet: "Unauthorized pet",
  cleanliness: "Cleanliness / hoarding",
  safety: "Health & safety",
  illegal_activity: "Illegal activity",
  other: "Other",
};

export function isViolationType(v: string): v is ViolationType {
  return (VIOLATION_TYPES as readonly string[]).includes(v);
}

/** Human label for a violation type; unknown/blank falls back to "Other". */
export function violationTypeLabel(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return isViolationType(t) ? VIOLATION_TYPE_LABELS[t] : VIOLATION_TYPE_LABELS.other;
}

// --- Lifecycle --------------------------------------------------------------
// Mirrors the DB CHECK on tenancy_violations.status. Only 'open' is acted on by
// the reminder; the rest are terminal/parked states that silence the nudge.
export const VIOLATION_STATUSES = ["open", "remedied", "escalated", "closed"] as const;
export type ViolationLifecycle = (typeof VIOLATION_STATUSES)[number];

const LIFECYCLE_LABELS: Record<ViolationLifecycle, string> = {
  open: "Open",
  remedied: "Remedied",
  escalated: "Escalated",
  closed: "Closed",
};

export function isViolationLifecycle(v: string): v is ViolationLifecycle {
  return (VIOLATION_STATUSES as readonly string[]).includes(v);
}

export function violationLifecycleLabel(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  return isViolationLifecycle(t) ? LIFECYCLE_LABELS[t] : LIFECYCLE_LABELS.open;
}

// --- Follow-up reminder band ------------------------------------------------
// The COMPUTED state of a record relative to its remedy deadline + lifecycle —
// distinct from the stored lifecycle status above.
export type FollowupStatus = "none" | "ok" | "approaching" | "overdue";

// The statuses that warrant a reminder (the actionable band).
export const FOLLOWUP_ACTIONABLE_STATUSES: readonly FollowupStatus[] = [
  "approaching",
  "overdue",
] as const;

// Most-urgent first, for ordering due items in the per-tenancy email + summary.
export const FOLLOWUP_URGENCY: Record<string, number> = {
  overdue: 0,
  approaching: 1,
};

/** The minimal record shape the status math needs (a subset of the DB row). */
export type ViolationInput = {
  status?: string | null;
  remedy_due_on?: string | null; // 'YYYY-MM-DD'
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
 * The remedy-deadline anchor for the follow-up clock as 'YYYY-MM-DD': the
 * record's remedy_due_on if present + well-formed AND the record is still open,
 * else null (no anchor => no reminder). A non-open record never reminds.
 */
export function followupAnchor(d: ViolationInput): string | null {
  const lifecycle = (d.status ?? "open").trim() || "open";
  if (lifecycle !== "open") return null;
  if (d.remedy_due_on && parseYmd(d.remedy_due_on) != null) return d.remedy_due_on.trim();
  return null;
}

/**
 * The follow-up status of a record relative to `today` ('YYYY-MM-DD'):
 *   - none        : not open, or no remedy deadline on file (no reminder)
 *   - overdue     : today is at/after the remedy deadline (verify + close/escalate)
 *   - approaching : within `leadDays` before the deadline
 *   - ok          : more than the lead window away
 * Pure; both `today` and `leadDays` are supplied by the caller.
 */
export function followupStatus(
  remedyDueOn: string | null,
  today: string,
  leadDays: number = FOLLOWUP_LEAD_DAYS,
): FollowupStatus {
  if (remedyDueOn == null) return "none";
  const daysToDue = daysBetween(today, remedyDueOn);
  if (daysToDue == null) return "none";
  if (daysToDue <= 0) return "overdue";
  if (daysToDue <= leadDays) return "approaching";
  return "ok";
}

/** Convenience: compute the follow-up status straight from a record + today. */
export function followupStatusFor(
  d: ViolationInput,
  today: string,
  leadDays: number = FOLLOWUP_LEAD_DAYS,
): FollowupStatus {
  return followupStatus(followupAnchor(d), today, leadDays);
}

/** True when a follow-up status is in the actionable band (worth an email). */
export function isActionableFollowupStatus(status: FollowupStatus): boolean {
  return (FOLLOWUP_ACTIONABLE_STATUSES as readonly string[]).includes(status);
}
