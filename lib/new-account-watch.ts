// new-account-watch.ts (S702). The pure rules for the daily new-account email.
//
// Vacantless goes on sale without a test phase. Instead, Noam gets one email a
// day listing every account that signed up in the last 14 days and how far it
// got: signed up, rental added, live, viewing times set, first enquiry, first
// booking. An account that stalls is flagged so he can email that landlord the
// same day. The cron route only gathers counts; everything it decides is here
// so it can be unit tested.

export const WATCH_WINDOW_DAYS = 14;

export type AccountCounts = {
  id: string;
  name: string | null;
  createdAt: string; // ISO
  plan: string | null;
  subscriptionStatus: string | null;
  closedAt: string | null;
  rentals: number;
  liveRentals: number; // rentals that are not drafts
  viewingTimes: number; // availability rules + overrides
  enquiries: number;
  bookings: number;
};

export const STAGES = [
  "signed_up",
  "rental_added",
  "live",
  "viewing_times",
  "first_enquiry",
  "first_booking",
] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABELS: Record<Stage, string> = {
  signed_up: "Signed up",
  rental_added: "Rental added",
  live: "Rental live",
  viewing_times: "Viewing times set",
  first_enquiry: "First enquiry",
  first_booking: "First booking",
};

/** What to tell the landlord when they are stuck before the next stage. */
export const NEXT_STEP: Record<Stage, string> = {
  signed_up: "has not added a rental yet",
  rental_added: "added a rental but has not put it live",
  live: "is live but has no viewing times, so renters cannot book",
  viewing_times: "is live with viewing times but no enquiry yet",
  first_enquiry: "has enquiries but no booking yet",
  first_booking: "has a booking",
};

export function stageOf(a: AccountCounts): Stage {
  if (a.rentals === 0) return "signed_up";
  if (a.liveRentals === 0) return "rental_added";
  if (a.viewingTimes === 0 && a.bookings === 0) return "live";
  if (a.enquiries === 0 && a.bookings === 0) return "viewing_times";
  if (a.bookings === 0) return "first_enquiry";
  return "first_booking";
}

export function daysSince(iso: string, now: Date): number {
  const ms = now.getTime() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/**
 * Stalled means the account needs a nudge from Noam today. Setup steps get two
 * days; waiting for a first enquiry gets seven, because that depends on renters.
 */
export function isStalled(stage: Stage, days: number): boolean {
  if (stage === "first_booking") return false;
  if (stage === "viewing_times" || stage === "first_enquiry") return days >= 7;
  return days >= 2;
}

export type WatchRow = {
  id: string;
  name: string;
  days: number;
  stage: Stage;
  stalled: boolean;
  paid: boolean;
  closed: boolean;
  line: string;
};

function isPaid(a: AccountCounts): boolean {
  return (
    (a.plan ?? "free") !== "free" &&
    (a.subscriptionStatus === "active" || a.subscriptionStatus === "trialing")
  );
}

function dayWord(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "1 day ago";
  return `${n} days ago`;
}

export function buildWatchRows(
  accounts: AccountCounts[],
  now: Date,
  excludeIds: ReadonlySet<string>,
): WatchRow[] {
  const rows: WatchRow[] = [];
  for (const a of accounts) {
    if (excludeIds.has(a.id)) continue;
    const days = daysSince(a.createdAt, now);
    if (days > WATCH_WINDOW_DAYS) continue;
    const stage = stageOf(a);
    const closed = !!a.closedAt;
    const paid = isPaid(a);
    const stalled = !closed && isStalled(stage, days);
    const name = (a.name ?? "").trim() || "Unnamed account";
    const plan = paid ? "Growth" : (a.plan ?? "free") !== "free" ? "Growth, not paying" : "Free";
    let line = `${name} (${plan}, signed up ${dayWord(days)}): `;
    if (closed) line += "closed the account.";
    else line += `${STAGE_LABELS[stage]}. It ${NEXT_STEP[stage]}.`;
    if (stalled) line = `NEEDS A NUDGE. ${line}`;
    rows.push({ id: a.id, name, days, stage, stalled, paid, closed, line });
  }
  // Stalled first, then paid, then newest.
  rows.sort(
    (x, y) =>
      Number(y.stalled) - Number(x.stalled) ||
      Number(y.paid) - Number(x.paid) ||
      x.days - y.days,
  );
  return rows;
}

export function buildWatchEmail(rows: WatchRow[]): { subject: string; body: string } | null {
  if (rows.length === 0) return null;
  const stalled = rows.filter((r) => r.stalled).length;
  const n = rows.length;
  const subject =
    stalled > 0
      ? `New accounts: ${n}, ${stalled} need a nudge`
      : `New accounts: ${n}, all moving`;
  const intro =
    stalled > 0
      ? "These accounts signed up in the last two weeks. The ones marked NEEDS A NUDGE are stuck. Send them a short email today."
      : "These accounts signed up in the last two weeks. None of them are stuck.";
  const body = [intro, rows.map((r) => r.line).join("\n")].join("\n\n");
  return { subject, body };
}
