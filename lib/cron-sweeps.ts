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
] as const;

export type SweepResult = { path: string; status: number | null; ms: number; error?: string };

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
