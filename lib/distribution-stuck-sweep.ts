// ============================================================================
// The stuck-item sweep (S681). Pure selection logic, no IO.
//
// THE GAP THIS CLOSES. `leasing.distribution_job_needs_action` is a good event,
// active, enabled by default, with real copy. It only ever fired at the INSTANT
// the distribution-worker cron moved an item to its gate. Nothing looked at an
// item that was already parked, so an item that reached a gate by any other
// path, or before that code shipped, was never mentioned again.
//
// Measured 2026-09-05: nine items parked, oldest 54 days. Two Agile concierge
// items at needs_operator for 43 days. And a real landlord org's concierge
// request `queued` for 48 days that could NEVER be picked up, because that org
// has no distribution_channel_accounts row, so automation_authorized is false
// and every cron run returned no_authorized_job and wrote nothing.
//
// That last case is why "queued too long" is swept as its own kind. An item
// nobody can claim is the single most important thing to say out loud: it is
// what a new signup asking for done-for-you posting actually experiences, and
// silence makes it look like it worked.
//
// WHAT THIS IS NOT. Telling you an item is stuck does not post it. The sweep is
// a smoke alarm, not a fire brigade.
// ============================================================================

/** Human gates the worker parks an item at, plus the never-picked-up case. */
export type StuckKind =
  | "needs_login"
  | "needs_payment"
  | "needs_operator"
  | "unclaimed_concierge";

export type StuckCandidate = {
  id: string;
  organization_id: string;
  run_id: string;
  channel: string;
  publish_status: string | null;
  mode: string | null;
  created_at: string;
  updated_at: string | null;
  last_stuck_alerted_at: string | null;
};

/** Parked this long before it counts as stuck. Below this it is just in flight. */
export const STUCK_AFTER_HOURS = 24;
/** Nag once, then at most this often. Never daily. */
export const RENAG_AFTER_DAYS = 7;
/** Hard cap per sweep so one run can never blast an inbox. */
export const MAX_ALERTS_PER_SWEEP = 5;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** What kind of stuck this row is, or null if it is not stuck-eligible at all. */
export function stuckKind(row: StuckCandidate): StuckKind | null {
  const status = row.publish_status;
  if (status === "needs_login") return "needs_login";
  if (status === "needs_payment") return "needs_payment";
  if (status === "needs_operator") return "needs_operator";
  // Only a CONCIERGE queued item is a promise to the operator that someone will
  // act. A queued item in any other mode is ordinary pipeline state.
  if (status === "queued" && row.mode === "concierge") return "unclaimed_concierge";
  return null;
}

function parsedMs(value: string | null): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** When the item last moved. Falls back to creation for a row never updated. */
export function parkedSinceMs(row: StuckCandidate): number | null {
  return parsedMs(row.updated_at) ?? parsedMs(row.created_at);
}

/** Has it been parked long enough, and are we past the re-nag interval? */
export function shouldAlert(row: StuckCandidate, nowMs: number): boolean {
  if (stuckKind(row) === null) return false;

  const since = parkedSinceMs(row);
  if (since === null) return false;
  if (nowMs - since < STUCK_AFTER_HOURS * HOUR_MS) return false;

  const alerted = parsedMs(row.last_stuck_alerted_at);
  if (alerted === null) return true; // never alerted: say it once
  return nowMs - alerted >= RENAG_AFTER_DAYS * DAY_MS;
}

/**
 * The items to alert on this sweep: oldest parked first, ONE PER ORG, capped.
 *
 * Oldest-first matters. The backlog is weeks deep, so a newest-first sweep would
 * keep re-reporting fresh items while the 54-day ones stayed silent, which is
 * the exact failure being fixed.
 *
 * ONE PER ORG matters just as much, and only showed up when the real backlog was
 * measured (2026-09-06). The nine oldest due items ALL belonged to a single QA
 * org, so oldest-first with a cap of five would have spent three daily runs on
 * that one org before naming the first real customer and four before Agile. One
 * org's backlog must never crowd out another org's first mention. Alerting on
 * each org's oldest item surfaces every affected org on the very first run,
 * and needs no notion of which orgs are "real", which is not knowable here.
 */
export function selectStuckToAlert(
  rows: readonly StuckCandidate[],
  nowMs: number,
  max: number = MAX_ALERTS_PER_SWEEP,
): StuckCandidate[] {
  const due = rows
    .filter((row) => shouldAlert(row, nowMs))
    .sort((a, b) => (parkedSinceMs(a) ?? 0) - (parkedSinceMs(b) ?? 0));

  const seenOrgs = new Set<string>();
  const oldestPerOrg: StuckCandidate[] = [];
  for (const row of due) {
    if (seenOrgs.has(row.organization_id)) continue;
    seenOrgs.add(row.organization_id);
    oldestPerOrg.push(row);
  }
  return oldestPerOrg.slice(0, Math.max(0, max));
}

/** Operator-facing "what is left to do", reusing the worker's gate wording. */
export const STUCK_NEXT_STEP: Record<StuckKind, string> = {
  needs_login:
    "log in to the channel (and clear any CAPTCHA), then review and submit the post",
  needs_payment:
    "complete the channel's payment, then review and submit the post",
  needs_operator:
    "review the prepared post and click submit, then paste the live URL",
  unclaimed_concierge:
    "nobody has picked this up. Check that the channel is set up and authorized for this organization, then re-run it",
};

/** Short label for the gate token in the email. */
export const STUCK_GATE_LABEL: Record<StuckKind, string> = {
  needs_login: "needs login",
  needs_payment: "needs payment",
  needs_operator: "needs review and submit",
  unclaimed_concierge: "waiting, unclaimed",
};

/** Whole days parked, for the email copy. */
export function daysParked(row: StuckCandidate, nowMs: number): number {
  const since = parkedSinceMs(row);
  if (since === null) return 0;
  return Math.max(0, Math.floor((nowMs - since) / DAY_MS));
}
