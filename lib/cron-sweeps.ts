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
] as const;

export type SweepResult = {
  path: string;
  status: number | null;
  ms: number;
  error?: string;
  /** S728: what the sweep answered ("disabled" when its flag is off). */
  reason?: string | null;
  sent?: number | null;
};

/** S728: the per-path answers worth keeping on the sweep_runs row. Pure. */
export function sweepDetails(results: SweepResult[]): Record<string, { status: number | null; reason?: string; sent?: number }> {
  const out: Record<string, { status: number | null; reason?: string; sent?: number }> = {};
  for (const r of results) {
    const key = r.path.replace("/api/cron/", "");
    const d: { status: number | null; reason?: string; sent?: number } = { status: r.status };
    if (typeof r.reason === "string" && r.reason) d.reason = r.reason.slice(0, 80);
    if (typeof r.sent === "number") d.sent = r.sent;
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
} {
  const failed = results
    .filter((r) => r.status == null || r.status >= 400)
    .map((r) => `${r.path}:${r.status ?? r.error ?? "error"}`);
  return { ran: results.length, succeeded: results.length - failed.length, failed };
}
