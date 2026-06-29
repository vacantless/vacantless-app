// Pure status math for the per-tenancy renter's-insurance tracker (S382) — the
// tenancy-scoped sibling of the unit asset records (lib/detector-eol.ts,
// lib/equipment-eol.ts). NO DB / env / I/O so it unit-tests cleanly via
// `npx tsx scripts/test-tenancy-insurance.ts`. The impure pieces (per-org
// queries, the once-per-term stamp, the send) live in
// app/api/cron/tenancy-insurance/route.ts; the nudge SELECTION + idempotency
// live in lib/tenancy-insurance-sweep.ts. Copy/recipients/branding ride the
// notification substrate (lib/notifications*) exactly like every other reminder.
//
// Unlike the equipment/detector EOL clocks (install date + service life =>
// computed end-of-life), an insurance policy carries its EXPIRY date directly,
// so the "anchor" is just the supplied expiry_date — no compute step. The lead
// window is the renewal runway: a landlord wants a few weeks' warning to ask the
// tenant for renewed proof before the policy lapses and leaves a liability gap.

// Default lead window: start nudging this many days before expiry. A month gives
// the tenant time to renew and re-send their certificate before any gap.
export const INSURANCE_LEAD_DAYS = 30;

export type InsuranceStatus = "unknown" | "ok" | "expiring_soon" | "lapsed";

// The statuses that warrant a proactive reminder (the actionable band). `unknown`
// (no expiry date) and `ok` (more than the lead window away) are excluded.
export const INSURANCE_ACTIONABLE_STATUSES: readonly InsuranceStatus[] = [
  "expiring_soon",
  "lapsed",
] as const;

// Most-urgent first, for ordering due items in the per-tenancy email + summary.
export const INSURANCE_URGENCY: Record<string, number> = {
  lapsed: 0,
  expiring_soon: 1,
};

/** The minimal policy shape the status math needs (a subset of the DB row). */
export type InsuranceInput = {
  provider?: string | null;
  policy_number?: string | null;
  effective_date?: string | null; // 'YYYY-MM-DD'
  expiry_date?: string | null; // 'YYYY-MM-DD'
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
 * The expiry anchor for the lapse clock as 'YYYY-MM-DD': the policy's expiry
 * date if present + well-formed, else null (no expiry => no reminder).
 */
export function insuranceExpiryAnchor(d: InsuranceInput): string | null {
  if (d.expiry_date && parseYmd(d.expiry_date) != null) return d.expiry_date.trim();
  return null;
}

/**
 * The reminder status of a policy relative to `today` ('YYYY-MM-DD'):
 *   - unknown       : no expiry date on file
 *   - lapsed        : today is at/after the expiry date (coverage gap)
 *   - expiring_soon : within `leadDays` before expiry (renewal runway)
 *   - ok            : more than the lead window away
 * Pure; both `today` and `leadDays` are supplied by the caller.
 */
export function insuranceStatus(
  expiryDate: string | null,
  today: string,
  leadDays: number = INSURANCE_LEAD_DAYS,
): InsuranceStatus {
  if (expiryDate == null) return "unknown";
  const daysToExpiry = daysBetween(today, expiryDate);
  if (daysToExpiry == null) return "unknown";
  if (daysToExpiry <= 0) return "lapsed";
  if (daysToExpiry <= leadDays) return "expiring_soon";
  return "ok";
}

/** Convenience: compute the status straight from a policy + today. */
export function insuranceStatusFor(
  d: InsuranceInput,
  today: string,
  leadDays: number = INSURANCE_LEAD_DAYS,
): InsuranceStatus {
  return insuranceStatus(insuranceExpiryAnchor(d), today, leadDays);
}

/** True when a status is in the actionable band (worth an email). */
export function isActionableInsuranceStatus(status: InsuranceStatus): boolean {
  return (INSURANCE_ACTIONABLE_STATUSES as readonly string[]).includes(status);
}

/** Human-friendly coverage amount from cents, e.g. 100000000 -> "$1,000,000". */
export function formatCoverageCents(cents: number | null | undefined): string | null {
  if (cents == null || !Number.isFinite(cents) || cents < 0) return null;
  const dollars = Math.round(cents / 100);
  return `$${dollars.toLocaleString("en-CA")}`;
}
