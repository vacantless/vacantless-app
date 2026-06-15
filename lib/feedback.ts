// Pure post-showing feedback-request scheduling logic (no I/O) so it can be
// unit-tested in isolation — the same shape as lib/reminders.ts.
//
// A single feedback request goes to the renter after a showing they ATTENDED.
// The cron sweep (app/api/cron/feedback) stamps showings.feedback_request_sent_at
// after a successful send, so re-running the sweep never double-sends. The
// decision below is idempotent + catch-up safe: given a showing's scheduled
// time, the current time, its outcome, whether a request was already sent, and
// the org's configured delay, it returns whether a request is due now.

export const HOUR_MS = 3_600_000;

// Don't back-blast feedback requests across historical attended showings the
// first time the feature (or a newly enabled org) goes live — only ask while
// the visit is still fresh. A showing older than this is skipped.
export const FEEDBACK_MAX_AGE_HOURS = 14 * 24; // 14 days

export type FeedbackDueInput = {
  scheduledAtMs: number | null;
  nowMs: number;
  outcome: string;
  requestSent: boolean;
  delayHours: number;
  enabled: boolean;
};

/**
 * Should a post-showing feedback request fire for this showing right now?
 *
 * True only when ALL hold:
 *   - the org has feedback collection enabled
 *   - the showing's outcome is "attended" (we only ask people who showed up;
 *     no_show / cancelled / still-scheduled never trigger a request)
 *   - a request hasn't already been sent
 *   - the showing has a scheduled time
 *   - at least `delayHours` have elapsed since the scheduled time
 *   - but no more than FEEDBACK_MAX_AGE_HOURS have elapsed (freshness cap)
 *
 * A negative or non-finite delay is floored to 0 so a misconfigured value can
 * never push the window into the future or the past indefinitely.
 */
export function feedbackDue(input: FeedbackDueInput): boolean {
  const { scheduledAtMs, nowMs, outcome, requestSent, delayHours, enabled } =
    input;

  if (!enabled) return false;
  if (outcome !== "attended") return false;
  if (requestSent) return false;
  if (scheduledAtMs == null) return false;

  const delay = Number.isFinite(delayHours) && delayHours > 0 ? delayHours : 0;
  const elapsedMs = nowMs - scheduledAtMs;

  if (elapsedMs < delay * HOUR_MS) return false; // too soon
  if (elapsedMs > FEEDBACK_MAX_AGE_HOURS * HOUR_MS) return false; // too stale

  return true;
}
