// S713e: the background sweeps that run every 15 minutes, in one place.
//
// GitHub's scheduler (.github/workflows/reminders.yml) was the only 15-minute
// timer, and on 2026-10-12/13 it ran hours apart (8:54 PM, 3:16 AM, 11:10 AM),
// so a renter's 2-hour viewing reminder or an approved post could sit for
// hours. The database now calls /api/cron/sweep-all every 15 minutes (pg_cron,
// migration 0245), which runs this list. GitHub stays on as a backup; every
// sweep is idempotent, so a double run is safe.
//
// Keep this list equal to the curl list in reminders.yml
// (scripts/test-sweep-timer.ts checks it).
export const SWEEP_PATHS = [
  "/api/cron/reminders",
  "/api/cron/feedback",
  "/api/cron/nurture",
  "/api/cron/leasing-snapshot",
  "/api/cron/viewing-reminder",
  "/api/cron/availability-tripwire",
  "/api/cron/availability-reopened-notify",
  "/api/cron/reschedule-nudge",
  "/api/cron/rent-increase",
  "/api/cron/compliance-calendar",
  "/api/cron/document-retention",
  "/api/cron/detector-eol",
  "/api/cron/equipment-eol",
  "/api/cron/appliance-care",
  "/api/cron/smart-lock-battery",
  "/api/cron/tenant-message-outbox",
  "/api/cron/tenancy-insurance",
  "/api/cron/violation-followup",
  "/api/cron/inspection-reminder",
  "/api/cron/appointment-reminder",
  "/api/cron/showing-outcome-nudge",
  "/api/cron/showing-confirmation-nudge",
  "/api/cron/distribution-freshness",
  "/api/cron/distribution-worker",
  "/api/cron/landlord-campaign",
  // S715: the welcome email sat 84 minutes on GitHub's scheduler.
  "/api/cron/onboarding-emails",
  // S717: team addresses back off Brevo's blocklist after a stray unsubscribe.
  "/api/cron/team-unsubscribe-guard",
  // S720: the daily health email to Noam (sends once a day, 8 AM Toronto).
  "/api/cron/health-digest",
  // S736: the founding free-period job was in the GitHub backup only; the
  // test wants both lists the same, and the job is safe to run twice.
  "/api/cron/founding-trial",
  // S736: emails a landlord once when a site signs them out (lib/signin-lost).
  "/api/cron/signin-lost",
  // S736: buys and releases texting numbers (lib/texting-numbers).
  "/api/cron/texting-numbers",
  // S737: one "your ads are live" email per rental turn (lib/posted-results-email).
  "/api/cron/posted-results-email",
  // S761: posts an edited rental's new ad once the robot took the old one down.
  "/api/cron/ad-update-repost",
  // S771: a "New" renter we already answered, quiet for 3 days, becomes "Contacted".
  "/api/cron/quiet-new-leads",
  // S788d: unit progress reminders to the crew (lib/unit-progress-reminders).
  "/api/cron/unit-progress",
] as const;

export type SweepResult = {
  path: string;
  status: number | null;
  ms: number;
  error?: string;
  /** S728: what the sweep answered ("disabled" when its flag is off). */
  reason?: string | null;
  sent?: number | null;
  /** S748: the sweep's own "ok" answer. false means it hit an error even though it answered 200. */
  bodyOk?: boolean | null;
};

/** S748: a sweep slower than this is close to the 60 s platform limit. */
export const SLOW_SWEEP_MS = 40_000;

/** S748: did this sweep fail? A 200 that says ok:false is a failure too. Pure. */
export function sweepFailed(r: SweepResult): boolean {
  return r.status == null || r.status >= 400 || r.bodyOk === false;
}

/** S728: the per-path answers worth keeping on the sweep_runs row. Pure. */
export type SweepDetail = { status: number | null; reason?: string; sent?: number; ms?: number; ok?: false };
export function sweepDetails(results: SweepResult[]): Record<string, SweepDetail> {
  const out: Record<string, SweepDetail> = {};
  for (const r of results) {
    const key = r.path.replace("/api/cron/", "");
    const d: SweepDetail = { status: r.status };
    if (typeof r.reason === "string" && r.reason) d.reason = r.reason.slice(0, 160);
    else if (r.error) d.reason = r.error.slice(0, 160);
    if (typeof r.sent === "number") d.sent = r.sent;
    // S748: keep the time, so a sweep creeping toward the limit is visible.
    if (typeof r.ms === "number") d.ms = r.ms;
    if (sweepFailed(r)) d.ok = false;
    out[key] = d;
  }
  return out;
}

/** S728: sweeps a flag has switched off, from one run's details. Pure. */
export function disabledSweeps(details: Record<string, { reason?: string }> | null | undefined): string[] {
  if (!details) return [];
  return Object.entries(details)
    .filter(([, d]) => typeof d?.reason === "string" && /disabled|not_configured|not_enabled/.test(d.reason))
    .map(([k]) => k)
    .sort();
}

/** One line per sweep, for the route's JSON summary. Pure. */
export function summarizeSweeps(results: SweepResult[]): {
  ran: number;
  succeeded: number;
  failed: string[];
  slow: string[];
} {
  // S748: a sweep that answered 200 with ok:false used to count as a success,
  // so a query error inside it never reached the health email.
  const failed = results
    .filter(sweepFailed)
    .map((r) => `${r.path}:${r.status == null ? r.error ?? "error" : r.status >= 400 ? r.status : "not_ok"}`);
  const slow = results.filter((r) => r.ms >= SLOW_SWEEP_MS).map((r) => r.path);
  return { ran: results.length, succeeded: results.length - failed.length, failed, slow };
}

/** The path part of a "failed" entry ("/api/cron/x:500" -> "/api/cron/x"). Pure. */
export function failedPath(entry: string): string {
  const i = entry.indexOf(":");
  return i === -1 ? entry : entry.slice(0, i);
}

/**
 * S748: sweeps that failed in this run AND the run before. One failure can be
 * a blip (a timeout, a deploy); two in a row (30 minutes) is worth an email
 * now rather than in tomorrow's 8 AM digest. Pure.
 */
export function repeatFailures(current: string[], previous: string[] | null | undefined): string[] {
  const prev = new Set((previous ?? []).map(failedPath));
  return [...new Set(current.map(failedPath))].filter((p) => prev.has(p)).sort();
}
