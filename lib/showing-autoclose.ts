// ============================================================================
// lib/showing-autoclose.ts — the showing-outcome auto-close default (S546).
//
// THE PROBLEM: the outcome loop is proven end-to-end (reminder -> tokenized
// one-tap Attended/No-show/Cancelled page -> DB write), but a busy operator
// often never taps, so a passed showing sits at outcome='scheduled' forever and
// the back half of the funnel stays dark even after the S391/S445 nudge series
// is exhausted.
//
// THE DEFAULT: when the org opts in, once the nudge series is spent AND a
// configurable grace has passed with still no human/renter outcome, the system
// auto-closes the showing to a distinct terminal state `auto_closed`.
//
// WHY `auto_closed` AND NOT "assumed attended": this codebase honest-nulls
// everywhere and never records by inference. We do NOT know whether the renter
// showed up, so we must not fabricate `attended`/`no_show` — that would corrupt
// the exact attendance signal the gate exists to measure. `auto_closed` is
// honest: it means "the showing passed and nobody recorded an outcome, so the
// system closed it." It is excluded from the attendance-rate math, and the SIZE
// of the auto_closed bucket is itself the adoption signal (how often the
// operator doesn't tap). A real outcome recorded later always overrides it.
//
// PURE: same inputs -> same output, no DB/DOM/clock. The impure sweep (the
// per-org query, the guarded UPDATE, the timeline note) lives in the reminders
// cron behind the org opt-in, mirroring the outcome-nudge sweep.
// ============================================================================

import { HOUR_MS } from "./reminders";

/** The terminal outcome the auto-close writes. Distinct from attended/no_show. */
export const AUTO_CLOSED_OUTCOME = "auto_closed" as const;

/** Default grace after the showing time before auto-close is even considered. */
export const AUTOCLOSE_DEFAULT_AFTER_MS = 48 * HOUR_MS;

/**
 * Never auto-close a showing older than this. Bounds the first-enable backlog
 * (flipping the org flag on won't sweep months of stale blank showings) exactly
 * like the outcome nudge's MAX_AGE. Kept a little above the last nudge offset
 * (44h) + a comfortable default grace so a normal cadence always completes.
 */
export const AUTOCLOSE_MAX_AGE_MS = 14 * 24 * HOUR_MS;

export type ShowingAutoCloseInput = {
  /** Whether the org has opted into the auto-close default. */
  enabled: boolean;
  scheduledAtMs: number;
  nowMs: number;
  /** showings.outcome — null or "scheduled" means "no real outcome recorded". */
  outcome: string | null;
  /** showings.outcome_nudge_count — how many nudges have already been sent. */
  nudgeCount: number;
  /** organizations.outcome_nudge_max — the org's nudge cadence cap (1 or 3). */
  maxNudges: number;
  /** Grace after scheduled_at before auto-close (org-configurable). */
  autoCloseAfterMs?: number;
  /** Safety backlog bound. */
  maxAgeMs?: number;
};

/**
 * Should this showing be auto-closed right now? Pure. Due only when ALL hold:
 *   - the org opted in                                   (enabled)
 *   - no real outcome is recorded yet                    (null / "scheduled")
 *   - the nudge series is exhausted                      (nudgeCount >= maxNudges)
 *   - enough time has passed since the showing            (elapsed >= after)
 *   - the showing isn't stale beyond the backlog bound    (elapsed <= maxAge)
 *
 * Recording any real outcome (operator or renter tap) makes this false forever,
 * so a genuine answer always wins over the default. Requiring the nudge series
 * to be spent first means the human always gets every chance before the system
 * closes it.
 */
export function showingAutoCloseDue(input: ShowingAutoCloseInput): boolean {
  const {
    enabled,
    scheduledAtMs,
    nowMs,
    outcome,
    nudgeCount,
    maxNudges,
    autoCloseAfterMs = AUTOCLOSE_DEFAULT_AFTER_MS,
    maxAgeMs = AUTOCLOSE_MAX_AGE_MS,
  } = input;

  if (!enabled) return false;
  if (outcome !== null && outcome !== "scheduled") return false; // already recorded
  if (nudgeCount < maxNudges) return false; // give the human every nudge first
  const elapsed = nowMs - scheduledAtMs;
  if (elapsed < autoCloseAfterMs) return false; // grace not yet elapsed
  if (elapsed > maxAgeMs) return false; // too old; backlog bound
  return true;
}

/**
 * The scheduled_at band the cron sweep should query, so the impure route stays a
 * thin translation of this pure rule. A showing is only ever a candidate when its
 * time is in [now - maxAge, now - after]: newer than the backlog bound (so
 * flipping the flag on can't sweep months of stale blanks) and older than the
 * grace (so a just-passed showing still has its full nudge window). Per-row
 * showingAutoCloseDue re-checks the exact predicate; this only bounds the query.
 */
export function autoCloseSweepBand(input: {
  nowMs: number;
  autoCloseAfterMs?: number;
  maxAgeMs?: number;
}): { oldestMs: number; newestMs: number } {
  const {
    nowMs,
    autoCloseAfterMs = AUTOCLOSE_DEFAULT_AFTER_MS,
    maxAgeMs = AUTOCLOSE_MAX_AGE_MS,
  } = input;
  return { oldestMs: nowMs - maxAgeMs, newestMs: nowMs - autoCloseAfterMs };
}
