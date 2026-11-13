// S788d: when to remind the crew to update unit progress (Noam's cadence,
// 2026-11-13). Pure: no DB, no env. Only nudge when something is waiting,
// at most one email per person per day, and only in working hours where the
// account is.
//   manager, leasing  Monday from 9 AM: units with no update in 7+ days.
//                     7 days before a move-out: book the key handover or walkthrough.
//                     On and after move-out day: tap Under construction.
//   leasing           3 days in Waiting for deposit; 2 days in Deposit clearing.
//                     (managers get these when the account has no leasing person.)
//   contractor, cleaner  the day after a ready-by date passes; every 5 days in
//                     reno or cleaning with no ready-by date.
// The landlord gets one copy when a reminder sat 3 days with no update.
import { STAGE_LABEL, type CrewRole, type Stage } from "@/lib/unit-progress";

export const REMINDER_REASONS = [
  "weekly_stale",
  "past_ready_by",
  "reno_no_date",
  "deposit_waiting",
  "deposit_clearing",
  "moveout_soon",
  "moveout_today",
] as const;
export type ReminderReason = (typeof REMINDER_REASONS)[number];

const DAY = 24 * 3600 * 1000;

/** How long before the same reminder about the same unit can go again. */
export const REPEAT_DAYS: Record<ReminderReason, number> = {
  weekly_stale: 6,
  past_ready_by: 5,
  reno_no_date: 5,
  deposit_waiting: 3,
  deposit_clearing: 2,
  moveout_soon: 365,
  moveout_today: 3,
};

export const ESCALATE_AFTER_DAYS = 3;
export const SEND_START_HOUR = 9;
export const SEND_END_HOUR = 17;

export type UnitState = {
  id: string;
  address: string;
  status: string | null;
  stage: Stage | null;
  stageAt: string | null;
  stageDate: string | null;
};
export type CrewLite = { id: string; name: string; role: CrewRole; email: string | null };
export type SentRow = { crew_member_id: string; property_id: string | null; reason: string; sent_at: string };
export type ReminderItem = { propertyId: string; reason: ReminderReason; line: string };
export type CrewReminder = { crewId: string; items: ReminderItem[] };

/** The first email address in a free-text contact field, or null. */
export function emailFromContact(contact: string | null | undefined): string | null {
  const m = String(contact ?? "").match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return m ? m[0].toLowerCase() : null;
}

function localParts(now: Date, tz: string): { date: string; weekday: string; hour: number } {
  const safe = (zone: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return { date: `${get("year")}-${get("month")}-${get("day")}`, weekday: get("weekday"), hour: Number(get("hour")) };
  };
  try {
    return safe(tz || "America/Toronto");
  } catch {
    return safe("America/Toronto");
  }
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T12:00:00Z`) - Date.parse(`${fromDate}T12:00:00Z`)) / DAY);
}

function fmtDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00Z`));
}

function ageDays(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.floor((nowMs - t) / DAY) : null;
}

/** The reminders due now, one email per person. */
export function remindersDue(args: {
  units: UnitState[];
  crew: CrewLite[];
  sent: SentRow[];
  now: Date;
  timeZone: string;
}): CrewReminder[] {
  const { units, crew, sent, now } = args;
  const nowMs = now.getTime();
  const local = localParts(now, args.timeZone);
  if (local.hour < SEND_START_HOUR || local.hour >= SEND_END_HOUR) return [];
  const hasLeasing = crew.some((c) => c.role === "leasing" && c.email);

  const lastSent = (crewId: string, propertyId: string | null, reason: ReminderReason): number => {
    let best = 0;
    for (const s of sent) {
      if (s.crew_member_id !== crewId || s.property_id !== propertyId || s.reason !== reason) continue;
      best = Math.max(best, Date.parse(s.sent_at) || 0);
    }
    return best;
  };
  const sentToday = (crewId: string): boolean =>
    sent.some((s) => s.crew_member_id === crewId && nowMs - (Date.parse(s.sent_at) || 0) < 20 * 3600 * 1000);
  const due = (crewId: string, u: UnitState, reason: ReminderReason): boolean => {
    const last = lastSent(crewId, u.id, reason);
    if (!last) return true;
    const stageMs = u.stageAt ? Date.parse(u.stageAt) || 0 : 0;
    if (stageMs > last) return true; // the unit moved since; a new reminder may go
    return nowMs - last >= REPEAT_DAYS[reason] * DAY;
  };

  const out: CrewReminder[] = [];
  for (const c of crew) {
    if (!c.email || sentToday(c.id)) continue;
    const items: ReminderItem[] = [];
    const add = (u: UnitState, reason: ReminderReason, line: string) => {
      if (due(c.id, u, reason)) items.push({ propertyId: u.id, reason, line });
    };
    for (const u of units) {
      const age = ageDays(u.stageAt, nowMs);
      if (c.role === "manager" || c.role === "leasing") {
        if (u.stage === "notice_given" && u.stageDate) {
          const until = daysBetween(local.date, u.stageDate);
          if (until > 0 && until <= 7) add(u, "moveout_soon", `${u.address}: the tenant moves out ${fmtDate(u.stageDate)}. Book the key handover or a walkthrough.`);
          if (until <= 0) add(u, "moveout_today", `${u.address}: move-out day was ${fmtDate(u.stageDate)}. Tap Under construction when work starts.`);
        }
        const depositPerson = c.role === "leasing" || !hasLeasing;
        if (depositPerson && u.stage === "waiting_deposit" && age !== null && age >= 3)
          add(u, "deposit_waiting", `${u.address}: waiting for the deposit for ${age} days.`);
        if (depositPerson && u.stage === "deposit_clearing" && age !== null && age >= 2)
          add(u, "deposit_clearing", `${u.address}: the deposit has been clearing for ${age} days.`);
        if (local.weekday === "Mon" && u.status !== "leased" && u.stage !== "on_hold" && (age === null || age >= 7)) {
          add(u, "weekly_stale", age === null ? `${u.address}: no stage yet.` : `${u.address}: no update in ${age} days. Still ${STAGE_LABEL[u.stage as Stage].toLowerCase()}?`);
        }
      }
      if (c.role === "contractor" || c.role === "cleaner") {
        if (u.stage === "under_construction" || u.stage === "being_cleaned") {
          if (u.stageDate && daysBetween(u.stageDate, local.date) >= 1) {
            add(u, "past_ready_by", `${u.address}: it was to be ready by ${fmtDate(u.stageDate)}. Is it ready, or is there a new date?`);
          } else if (!u.stageDate && age !== null && age >= 5) {
            add(u, "reno_no_date", `${u.address}: ${STAGE_LABEL[u.stage].toLowerCase()} for ${age} days. Please add a ready-by date.`);
          }
        }
      }
    }
    if (items.length > 0) out.push({ crewId: c.id, items });
  }
  return out;
}

export type EscalationRow = { id: string; crew_member_id: string; property_id: string | null; reason: string; sent_at: string; escalated_at: string | null };

/** Reminders that sat 3 days with no change on their unit: the landlord gets a copy. */
export function escalationsDue(rows: EscalationRow[], units: UnitState[], now: Date): EscalationRow[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const nowMs = now.getTime();
  return rows.filter((r) => {
    if (r.escalated_at || !r.property_id) return false;
    const sentMs = Date.parse(r.sent_at) || 0;
    if (nowMs - sentMs < ESCALATE_AFTER_DAYS * DAY) return false;
    const u = byId.get(r.property_id);
    if (!u || u.status === "leased") return false;
    const stageMs = u.stageAt ? Date.parse(u.stageAt) || 0 : 0;
    return stageMs <= sentMs;
  });
}
