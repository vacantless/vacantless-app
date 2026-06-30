// Pure reminder-scheduling logic (no I/O) so it can be unit-tested in isolation.
//
// Two reminders per showing, modelled on ShowingHero's appointment reminders:
// one ~24 hours before and one ~2 hours before. The decision below is
// idempotent + catch-up safe — given a showing's scheduled time, the current
// time, and which reminders have already been sent, it returns the single
// reminder that is due now (or null). The cron route stamps a sent-at column
// after each successful send, so re-running the sweep never double-sends.

export type ReminderKind = "24h" | "2h";

export const HOUR_MS = 3_600_000;

export type ReminderDueInput = {
  scheduledAtMs: number;
  nowMs: number;
  sent24h: boolean;
  sent2h: boolean;
};

/**
 * Which reminder (if any) should fire for this showing right now.
 *
 * Windows (msUntil = scheduledAt - now):
 *   - msUntil <= 0          → null (past; never remind)
 *   - 0 < msUntil <= 2h     → "2h"  (unless already sent)
 *   - 2h < msUntil <= 24h   → "24h" (unless already sent)
 *   - msUntil > 24h         → null (too early)
 *
 * The 2h window takes priority, so a last-minute booking (<2h out) gets only
 * the 2h reminder and never a spurious "24h" one. Because the windows are
 * upper-bounded by elapsed time (not a narrow band), a late or infrequent
 * cron run still catches a pending reminder rather than skipping it.
 */
export function reminderDue(input: ReminderDueInput): ReminderKind | null {
  const { scheduledAtMs, nowMs, sent24h, sent2h } = input;
  const msUntil = scheduledAtMs - nowMs;

  if (msUntil <= 0) return null;

  if (msUntil <= 2 * HOUR_MS) {
    return sent2h ? null : "2h";
  }

  if (msUntil <= 24 * HOUR_MS) {
    return sent24h ? null : "24h";
  }

  return null;
}

export const REMINDER_SENT_COLUMN: Record<ReminderKind, string> = {
  "24h": "reminder_24h_sent_at",
  "2h": "reminder_2h_sent_at",
};

// ---------------------------------------------------------------------------
// Repair-appointment reminders (S387, Slice 4)
//
// A confirmed repair appointment (work_order_appointments.chosen_date +
// chosen_start_minute) gets two reminders to the tenant so they're home for the
// supplier's arrival window: one the DAY BEFORE and one the SAME DAY. Unlike the
// showing reminders above (hour-window bands, because a viewing is a precise
// instant), a repair is an ARRIVAL WINDOW the tenant plans their whole day
// around, so these are CALENDAR-DAY reminders: "tomorrow" and "today".
//
// The decision is pure + catch-up safe. The cron resolves the appointment's
// start instant (date + start_minute in the org tz, via lib/booking's
// zonedWallTimeToUtc) and the calendar-day gap between today and the appointment
// date (both in the org tz), then asks which reminder is due. Same-day takes
// priority over 1-day, so a late/infrequent cron run (or a same-day booking)
// still sends exactly one reminder rather than a stale "tomorrow" one. Each kind
// stamps its own column so re-runs never double-send.
// ---------------------------------------------------------------------------

export type ApptReminderKind = "1d" | "sameday";

export type ApptReminderDueInput = {
  apptStartMs: number; // UTC instant of the appointment window start
  nowMs: number;
  daysUntilAppt: number; // calendar days (org tz) from today to the appointment date
  sent1d: boolean;
  sentSameday: boolean;
};

/**
 * Which appointment reminder (if any) should fire right now.
 *
 *   - apptStart already passed   → null (the window has begun; never remind late)
 *   - appointment is TODAY (0)   → "sameday" (unless already sent)
 *   - appointment is TOMORROW (1)→ "1d"      (unless already sent)
 *   - 2+ days out                → null (too early)
 *   - in the past (<0)           → null
 *
 * Same-day wins when the appointment is today: if the 1-day reminder was missed
 * (cron didn't run yesterday) the tenant still gets the same-day one. Bounded by
 * the calendar gap (not a narrow time band), so an infrequent cron still catches
 * a pending reminder.
 */
export function appointmentReminderDue(input: ApptReminderDueInput): ApptReminderKind | null {
  const { apptStartMs, nowMs, daysUntilAppt, sent1d, sentSameday } = input;
  if (apptStartMs <= nowMs) return null; // window started / past
  if (daysUntilAppt < 0) return null; // appointment date already passed
  if (daysUntilAppt === 0) return sentSameday ? null : "sameday";
  if (daysUntilAppt === 1) return sent1d ? null : "1d";
  return null; // 2+ days out
}

export const APPOINTMENT_REMINDER_SENT_COLUMN: Record<ApptReminderKind, string> = {
  "1d": "reminder_1d_sent_at",
  sameday: "reminder_sameday_sent_at",
};

export const APPOINTMENT_REMINDER_SMS_SENT_COLUMN: Record<ApptReminderKind, string> = {
  "1d": "reminder_1d_sms_sent_at",
  sameday: "reminder_sameday_sms_sent_at",
};

/**
 * Whole-calendar-day difference between two "YYYY-MM-DD" dates (toIso - fromIso),
 * UTC-pinned so the server (UTC) and any browser agree. Returns null if either
 * date is malformed. Used to turn (today, appointment date) — both already
 * resolved in the org tz — into the daysUntilAppt the decision takes.
 */
export function isoDaysBetween(fromIso: string, toIso: string): number | null {
  const parse = (s: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((s ?? "").trim());
    if (!m) return null;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = Date.UTC(y, mo - 1, d);
    const back = new Date(dt);
    if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
      return null;
    }
    return dt;
  };
  const a = parse(fromIso);
  const b = parse(toIso);
  if (a === null || b === null) return null;
  return Math.round((b - a) / 86_400_000);
}
