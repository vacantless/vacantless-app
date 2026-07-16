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

export type PendingRescheduleProposalRow = {
  showing_id: string | null;
  status?: string | null;
  responded_at?: string | null;
};

export function pendingRescheduleShowingIds(
  rows: PendingRescheduleProposalRow[],
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (
      row.showing_id &&
      row.status === "pending" &&
      row.responded_at == null
    ) {
      ids.add(row.showing_id);
    }
  }
  return ids;
}

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

// ---------------------------------------------------------------------------
// Post-showing outcome nudge (S391, Slice 1)
//
// 94 of our showings booked but only 1 ever had its outcome recorded: logging an
// outcome is a PULL nobody does, so the back half of the funnel is dark. This
// turns it into a PUSH — once a showing's time has passed with no outcome, the
// operator gets ONE "how did the viewing go?" email with a one-tap
// Attended/No-show/Cancelled link (mirroring the alert-email-link habit).
//
// The decision is pure + catch-up safe. A showing earns its single nudge when:
//   - it is actually over: now >= scheduled_at + GRACE (a viewing plus slack), and
//   - it is recent: now <= scheduled_at + MAX_AGE, so turning the flag on does
//     not blast months of historical blank showings, and
//   - no real outcome is recorded yet (null or the placeholder "scheduled"), and
//   - the nudge has not already been sent (one stamp, one nudge).
// The cron stamps outcome_nudge_sent_at after a successful send, so re-running
// the sweep never double-sends; an infrequent cron still catches it because the
// window is an elapsed-time band, not a narrow instant.
// ---------------------------------------------------------------------------

// A viewing is ~30 min; wait 2h after the start so it is genuinely over before
// asking how it went.
export const OUTCOME_NUDGE_GRACE_MS = 2 * HOUR_MS;
// Only nudge showings whose time passed within the last 7 days — bounds the
// first-enable backlog and avoids chasing stale showings forever.
export const OUTCOME_NUDGE_MAX_AGE_MS = 7 * 24 * HOUR_MS;

export type OutcomeNudgeDueInput = {
  scheduledAtMs: number;
  nowMs: number;
  outcome: string | null; // showings.outcome — null or "scheduled" means "not recorded"
  alreadySent: boolean; // outcome_nudge_sent_at is set
  graceMs?: number;
  maxAgeMs?: number;
};

// Bounded escalation (S445 slice 2). Cumulative offsets from scheduled_at at which
// the 1st / 2nd / 3rd nudge become due: ~fresh (the GRACE), ~next morning, ~two
// days later. The Nth nudge (0-indexed by count) is due once elapsed crosses
// OFFSETS[count]. The cron runs a few-hourly sweep, so successive steps naturally
// land on separate sweeps (no burst) and each is spaced by the offset gap. All
// steps sit inside MAX_AGE (7d), so the backlog bound still caps the whole series.
export const OUTCOME_NUDGE_OFFSETS_MS = [
  OUTCOME_NUDGE_GRACE_MS, // ~2h — right after it's over
  20 * HOUR_MS, // ~next morning
  44 * HOUR_MS, // ~two days later (final)
];
// The per-showing count of nudges already sent (drives the step gate).
export const OUTCOME_NUDGE_COUNT_COLUMN = "outcome_nudge_count";

export type OutcomeNudgeStepInput = {
  scheduledAtMs: number;
  nowMs: number;
  outcome: string | null; // null / "scheduled" means "not recorded"
  nudgeCount: number; // showings.outcome_nudge_count — how many already sent
  maxNudges: number; // organizations.outcome_nudge_max — 1 (once) or 3 (follow-up)
  offsets?: readonly number[];
  maxAgeMs?: number;
};

/**
 * Should this showing get its NEXT outcome nudge right now? The bounded-escalation
 * generalization of the old one-shot rule:
 *
 *   - a real outcome recorded             → false (attended/no_show/cancelled)
 *   - nudgeCount >= maxNudges             → false (hit the org's cadence cap)
 *   - nudgeCount >= offsets.length        → false (no further step defined)
 *   - elapsed > MAX_AGE                    → false (too old; backlog bound)
 *   - elapsed < offsets[nudgeCount]        → false (the next step's time hasn't come)
 *   - otherwise                           → true
 *
 * Recording the outcome (the one-tap answer) makes every future call false, so the
 * series stops the instant it's answered — the "nudge until filled, then quit".
 */
export function outcomeNudgeStepDue(input: OutcomeNudgeStepInput): boolean {
  const {
    scheduledAtMs,
    nowMs,
    outcome,
    nudgeCount,
    maxNudges,
    offsets = OUTCOME_NUDGE_OFFSETS_MS,
    maxAgeMs = OUTCOME_NUDGE_MAX_AGE_MS,
  } = input;
  if (outcome !== null && outcome !== "scheduled") return false; // already recorded
  if (nudgeCount >= maxNudges) return false; // hit the cadence cap
  if (nudgeCount >= offsets.length) return false; // no further step
  const elapsed = nowMs - scheduledAtMs;
  if (elapsed > maxAgeMs) return false; // too old
  if (elapsed < offsets[nudgeCount]) return false; // next step not reached yet
  return true;
}

/**
 * Back-compat one-shot form (the pre-escalation contract). Expressed in terms of
 * the stepped primitive: a single nudge whose only step is the GRACE offset.
 */
export function outcomeNudgeDue(input: OutcomeNudgeDueInput): boolean {
  return outcomeNudgeStepDue({
    scheduledAtMs: input.scheduledAtMs,
    nowMs: input.nowMs,
    outcome: input.outcome,
    nudgeCount: input.alreadySent ? 1 : 0,
    maxNudges: 1,
    offsets: [input.graceMs ?? OUTCOME_NUDGE_GRACE_MS],
    maxAgeMs: input.maxAgeMs ?? OUTCOME_NUDGE_MAX_AGE_MS,
  });
}

export const OUTCOME_NUDGE_SENT_COLUMN = "outcome_nudge_sent_at";

// ---------------------------------------------------------------------------
// Pre-showing UNCONFIRMED nudge (S440, showing routing Slice 3).
//
// The mirror image of the outcome nudge: that one fires AFTER a viewing when no
// outcome is recorded; this one fires BEFORE a viewing when an assigned viewing
// hasn't been confirmed with the renter yet, reminding the covering agent to
// confirm it (one tap on their /agent/[token] calendar). Closes the "did anyone
// actually confirm this?" gap the "Howard" episode exposed, without the lead
// agent having to chase.
//
// Timing: a viewing is "due" for a confirmation nudge when it is still in the
// future but within LEAD_MS of its start (default 24h) — close enough that an
// unconfirmed viewing is a real risk, not so early that confirming is premature.
// Once the start time passes, this stops firing (a past unconfirmed viewing is
// the outcome nudge's job, not this one). One nudge per showing: the cron stamps
// confirmation_nudge_sent_at after send so a re-run never double-sends.
// ---------------------------------------------------------------------------

// Nudge inside the 24h before a viewing's start.
export const CONFIRMATION_NUDGE_LEAD_MS = 24 * HOUR_MS;

export type ConfirmationNudgeDueInput = {
  scheduledAtMs: number;
  nowMs: number;
  assigned: boolean; // a showing_agent is assigned
  confirmed: boolean; // confirmed_at is set
  outcome: string | null; // open == null or "scheduled"
  alreadySent: boolean; // confirmation_nudge_sent_at is set
  leadMs?: number;
};

/**
 * Should this showing get its (single) pre-showing unconfirmed nudge right now?
 *
 *   - alreadySent                         → false (one nudge per showing)
 *   - not assigned                        → false (nothing to confirm)
 *   - already confirmed                   → false
 *   - a real outcome recorded             → false (cancelled/attended/no_show)
 *   - start already passed                → false (outcome-nudge territory)
 *   - start more than LEAD_MS away        → false (too early to chase)
 *   - otherwise                           → true
 *
 * remaining = scheduled_at - now. Boundaries inclusive: due exactly at LEAD_MS
 * out, and still due right up to the start (remaining == 0).
 */
export function confirmationNudgeDue(input: ConfirmationNudgeDueInput): boolean {
  const {
    scheduledAtMs,
    nowMs,
    assigned,
    confirmed,
    outcome,
    alreadySent,
    leadMs = CONFIRMATION_NUDGE_LEAD_MS,
  } = input;
  if (alreadySent) return false;
  if (!assigned) return false;
  if (confirmed) return false;
  if (outcome !== null && outcome !== "scheduled") return false; // closed
  const remaining = scheduledAtMs - nowMs;
  if (remaining < 0) return false; // already started/past
  if (remaining > leadMs) return false; // too early
  return true;
}

export const CONFIRMATION_NUDGE_SENT_COLUMN = "confirmation_nudge_sent_at";
