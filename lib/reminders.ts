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
