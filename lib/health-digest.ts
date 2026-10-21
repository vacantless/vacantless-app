// S720: the daily health email to Noam. Pure rules only; the route
// (app/api/cron/health-digest) gathers the facts and calls buildHealthDigest.
//
// Why it exists: before this, a failure was found only when someone happened
// to look. The Kijiji reader dropped every renter's message for weeks
// (2026-09-22 to 2026-10-15) and nothing said so. One email a day either lists
// what broke in the last 24 hours or says all clear. It always sends, so a
// missing email is itself a sign that the timer stopped.

export const SWEEP_STALE_MINUTES = 60;
export const DIGEST_LOCAL_HOUR = 8; // 8 AM Toronto
export const DIGEST_TIMEZONE = "America/Toronto";

import { disabledSweeps } from "@/lib/cron-sweeps";

export type SweepRunRow = {
  ran_at: string;
  ok: boolean;
  ran: number;
  failed: string[] | null;
  /** S728: per-sweep answers (reason, sent). */
  details?: Record<string, { status?: number | null; reason?: string; sent?: number }> | null;
};
export type EmailProblem = { event: string; email: string; subject: string | null; reason: string | null };
export type PortalOutcome = { org: string; outcome: string; count: number };
export type ParserNoteLead = { org: string; name: string | null; notes: string };
export type RobotProblem = { org: string; channel: string; status: string | null; error: string | null };
export type SignInProblem = { org: string; channel: string; code: string | null };

export type HealthInput = {
  now: Date;
  sweeps: SweepRunRow[]; // last 24 hours
  lastSweepAt: string | null; // newest sweep_runs row, any age
  emails: { checked: boolean; note?: string; problems: EmailProblem[] };
  portal: PortalOutcome[]; // outcomes other than lead_created / duplicate
  parserNotes: ParserNoteLead[];
  robot: RobotProblem[];
  signIns: SignInProblem[];
};

const PORTAL_OK = new Set(["lead_created", "duplicate"]);
export function portalOutcomeIsProblem(outcome: string): boolean {
  return !PORTAL_OK.has(outcome);
}

const EVENT_WORDS: Record<string, string> = {
  hardBounces: "bounced (address does not exist)",
  hard_bounce: "bounced (address does not exist)",
  softBounces: "bounced (inbox full or down)",
  soft_bounce: "bounced (inbox full or down)",
  blocked: "blocked by the email service",
  invalid: "invalid address",
  error: "failed to send",
  spam: "marked as spam",
};

function clip(s: string | null | undefined, n = 140): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}

function minutesAgo(iso: string, now: Date): number {
  return Math.round((now.getTime() - Date.parse(iso)) / 60_000);
}

export type HealthSection = { title: string; lines: string[] };

export function healthSections(input: HealthInput): HealthSection[] {
  const out: HealthSection[] = [];

  // 1. Background sweeps (reminders, posting, snapshots, follow-ups).
  const sweepLines: string[] = [];
  if (!input.lastSweepAt) {
    sweepLines.push("No background sweep has ever been recorded. Reminders and posting may not be running.");
  } else {
    const age = minutesAgo(input.lastSweepAt, input.now);
    if (age > SWEEP_STALE_MINUTES) {
      sweepLines.push(
        `The background sweeps last ran ${age} minutes ago (they should run every 15). Reminders, posting and snapshots are paused until they run again.`,
      );
    }
  }
  const failedByPath = new Map<string, number>();
  for (const r of input.sweeps) {
    for (const f of r.failed ?? []) {
      const path = f.split(":")[0].replace("/api/cron/", "");
      failedByPath.set(path, (failedByPath.get(path) ?? 0) + 1);
    }
  }
  for (const [path, n] of [...failedByPath.entries()].sort((a, b) => b[1] - a[1])) {
    sweepLines.push(`${path} failed in ${n} of ${input.sweeps.length} runs.`);
  }
  // S728: a sweep switched off by a flag answers 200 "disabled" and used to
  // be invisible here. Name them once, from the newest run.
  const newest = [...input.sweeps].sort((a, b) => Date.parse(b.ran_at) - Date.parse(a.ran_at))[0];
  const off = disabledSweeps(newest?.details ?? null);
  if (off.length) sweepLines.push(`Switched off by a flag (not running): ${off.join(", ")}.`);
  if (sweepLines.length) out.push({ title: "Background sweeps", lines: sweepLines });

  // 2. Emails that did not arrive.
  const emailLines: string[] = [];
  if (!input.emails.checked) {
    emailLines.push(`Could not check email delivery${input.emails.note ? ` (${input.emails.note})` : ""}.`);
  }
  for (const p of input.emails.problems.slice(0, 15)) {
    const what = EVENT_WORDS[p.event] ?? p.event;
    const subj = p.subject ? ` "${clip(p.subject, 70)}"` : "";
    const why = p.reason ? ` Reason: ${clip(p.reason, 90)}` : "";
    emailLines.push(`To ${p.email}${subj}: ${what}.${why}`);
  }
  if (input.emails.problems.length > 15) {
    emailLines.push(`...and ${input.emails.problems.length - 15} more.`);
  }
  if (emailLines.length) out.push({ title: "Emails", lines: emailLines });

  // 3. Renter enquiries from listing sites.
  const portalLines: string[] = [];
  for (const p of input.portal) {
    portalLines.push(`${p.org}: ${p.count} site email${p.count === 1 ? "" : "s"} not filed as a renter (${p.outcome.replace(/_/g, " ")}).`);
  }
  for (const l of input.parserNotes) {
    const note = /Parser notes:\s*([\s\S]*)$/.exec(l.notes)?.[1] ?? "";
    portalLines.push(`${l.org}: ${l.name ?? "a renter"} was filed with gaps (${clip(note, 120)}).`);
  }
  if (portalLines.length) out.push({ title: "Renter enquiries from sites", lines: portalLines });

  // 4. Robot posting.
  const robotLines: string[] = [];
  for (const r of input.robot) {
    const status = (r.status ?? "error").replace(/_/g, " ");
    const err = r.error ? ` ${clip(r.error, 100)}` : "";
    robotLines.push(`${r.org}, ${r.channel}: ${status}.${err}`);
  }
  for (const s of input.signIns) {
    robotLines.push(`${s.org}, ${s.channel}: signed out (${(s.code ?? "unknown").replace(/_/g, " ")}). Posting there stops until they sign in again.`);
  }
  if (robotLines.length) out.push({ title: "Posting to sites", lines: robotLines });

  return out;
}

export function buildHealthDigest(input: HealthInput): { subject: string; body: string; problems: number } {
  const sections = healthSections(input);
  const problems = sections.reduce((n, s) => n + s.lines.length, 0);
  const runs = input.sweeps.length;
  const okRuns = input.sweeps.filter((r) => r.ok).length;
  const subject =
    problems === 0
      ? "Vacantless health: all clear"
      : `Vacantless health: ${problems} ${problems === 1 ? "problem" : "problems"}`;
  const head =
    problems === 0
      ? "Nothing failed in the last 24 hours."
      : "These failed or need a look from the last 24 hours.";
  const parts = [head];
  for (const s of sections) {
    parts.push(`${s.title.toUpperCase()}\n${s.lines.map((l) => `- ${l}`).join("\n")}`);
  }
  parts.push(
    `Checked: ${okRuns} of ${runs} background sweeps clean, email delivery${input.emails.checked ? "" : " (not checked)"}, renter emails from sites, robot posts and site sign-ins. Not checked here: app errors in Vercel's logs.`,
  );
  return { subject, body: parts.join("\n\n"), problems };
}

/** The Toronto calendar date and hour for `now`, for the once-a-day gate. */
export function torontoDateHour(now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DIGEST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}
