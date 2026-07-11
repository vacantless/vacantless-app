// ===========================================================================
// lib/renewal.ts — renewal check-in engine (renewal & rent-increase autopilot
// Slice A, S460).
//
// The tenant "are you planning to stay or leave?" check-in that runs ~90 days
// before a lease's first-year completion (the fixed-term end if there is one,
// else move-in + 12 months) and BRANCHES the autopilot:
//   * staying / unsure -> proceed to the annual rent increase (N1 flow);
//   * leaving          -> hand off to the turnover / leasing pipeline, skip the
//                         increase.
//
// Pure: same inputs -> same output, no DB, so it unit-tests offline and the
// per-tenancy card matches the cron sweep exactly (the same rule everywhere).
// Mirrors lib/rent-increase.ts deriveRentIncrease: UTC-anchored date math,
// null only on unparseable dates. NO PII lives here — the tenant only ever
// records one of three enum choices.
// ===========================================================================

// Open the check-in this far before the lease's completion date. 90 days lines
// the check-in up with the N1 serve window (NOTICE_DAYS), so a "staying" answer
// flows straight into serving the increase with runway to spare.
export const CHECKIN_LEAD_DAYS = 90;

export type RenewalIntent = "staying" | "leaving" | "unsure";

export const RENEWAL_INTENTS: readonly RenewalIntent[] = [
  "staying",
  "leaving",
  "unsure",
] as const;

export function isRenewalIntent(v: unknown): v is RenewalIntent {
  return v === "staying" || v === "leaving" || v === "unsure";
}

export type RenewalCheckinStatus =
  | "not_ready" // completion is further out than the lead window
  | "due" //       inside the window, tenant hasn't answered yet
  | "answered" //  tenant recorded an intent
  | "passed"; //   completion date has passed with no answer

export type RenewalBranch =
  | "proceed_increase" //  staying / unsure -> advance to the rent increase
  | "handoff_turnover"; // leaving -> hand to the leasing / turnover pipeline

export type RenewalCheckinInput = {
  /** tenancies.start_date (YYYY-MM-DD). */
  startDate: string | null;
  /** Fixed-term end (tenancies.end_date), if any. */
  endDate?: string | null;
  /** tenancies.renewal_intent, if the tenant has already answered. */
  intent?: RenewalIntent | null;
  /** Override CHECKIN_LEAD_DAYS (tests). */
  leadDays?: number;
};

export type RenewalCheckin = {
  status: RenewalCheckinStatus;
  /** The anchor: end_date if present, else start + 12 months. */
  completionDate: string;
  /** completionDate - leadDays: the day the check-in becomes actionable. */
  checkinOpensDate: string;
  /** Days from today to the completion date (negative once past). */
  daysUntilCompletion: number;
  intent: RenewalIntent | null;
  /** Set once an intent is recorded; null while unanswered. */
  branch: RenewalBranch | null;
};

/** staying / unsure -> proceed; leaving -> turnover. Null while unanswered. */
export function branchForIntent(
  intent: RenewalIntent | null | undefined,
): RenewalBranch | null {
  if (!intent) return null;
  return intent === "leaving" ? "handoff_turnover" : "proceed_increase";
}

/**
 * Derive the renewal check-in picture for one tenancy as of `today`.
 * Pure: same inputs -> same output. Returns null only on unparseable start/today.
 */
export function deriveRenewalCheckin(
  input: RenewalCheckinInput,
  today: string,
): RenewalCheckin | null {
  const todayParts = parseISODate(today);
  const startParts = parseISODate(input.startDate);
  if (!todayParts || !startParts) return null;

  const todayMs = toUTC(todayParts);
  const startMs = toUTC(startParts);
  const leadDays = input.leadDays ?? CHECKIN_LEAD_DAYS;

  // Completion anchor: the fixed-term end if we can parse one, else the
  // first-year completion (move-in + 12 months). An unparseable end_date falls
  // back to the anniversary rather than voiding the whole check-in.
  const endParts = parseISODate(input.endDate ?? null);
  const completionMs = endParts ? toUTC(endParts) : addMonthsUTC(startMs, 12);
  const checkinOpensMs = addDaysUTC(completionMs, -leadDays);
  const daysUntilCompletion = diffDays(todayMs, completionMs);

  const intent = input.intent ?? null;
  const branch = branchForIntent(intent);

  let status: RenewalCheckinStatus;
  if (intent) {
    status = "answered";
  } else if (todayMs < checkinOpensMs) {
    status = "not_ready";
  } else if (todayMs <= completionMs) {
    status = "due";
  } else {
    status = "passed";
  }

  return {
    status,
    completionDate: isoFromUTC(completionMs),
    checkinOpensDate: isoFromUTC(checkinOpensMs),
    daysUntilCompletion,
    intent,
    branch,
  };
}

// --- pure UTC date helpers (mirror lib/rent-increase.ts) --------------------

function parseISODate(
  s: string | null | undefined,
): { y: number; m: number; d: number } | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, m: mo, d };
}

function toUTC(p: { y: number; m: number; d: number }): number {
  return Date.UTC(p.y, p.m - 1, p.d);
}

function isoFromUTC(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => (n < 10 ? "0" + n : String(n));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addMonthsUTC(ms: number, months: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate());
}

function addDaysUTC(ms: number, days: number): number {
  return ms + days * 86_400_000;
}

function diffDays(fromMs: number, toMs: number): number {
  return Math.round((toMs - fromMs) / 86_400_000);
}

// ============================================================================
// S460d (Codex P2): the N1 serve-state is per-CYCLE, not one-shot. recordRentIncrease
// rolls the anchor forward but leaves n1_served_at/n1_snapshot in place, so next
// year the served UI + the Stripe snapshot are STALE (belong to last cycle). A
// serve counts for the CURRENT cycle only when its frozen snapshot effective date
// equals the currently-derived effective date; otherwise treat it as unserved so
// the operator can serve a fresh N1 and the stale Stripe snapshot is ignored.
// ============================================================================
export function n1ServedForCurrentCycle(
  servedAt: string | null | undefined,
  snapshotEffectiveDate: string | null | undefined,
  currentEffectiveDate: string | null | undefined,
): boolean {
  return (
    servedAt != null &&
    snapshotEffectiveDate != null &&
    currentEffectiveDate != null &&
    snapshotEffectiveDate === currentEffectiveDate
  );
}
