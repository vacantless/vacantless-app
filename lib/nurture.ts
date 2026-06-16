// Pure lead-nurture scheduling logic (no I/O) so it can be unit-tested in
// isolation — the same shape as lib/reminders.ts and lib/feedback.ts.
//
// A nurture drip is a short, paced series of branded follow-up emails to a
// renter who inquired but hasn't booked a showing yet. The cron sweep
// (app/api/cron/nurture) sends only the NEXT due step and bumps
// leads.nurture_step_sent, so a re-run never double-sends. The decision below
// is idempotent + catch-up safe: given when the lead inquired, the current
// time, the lead's pipeline status, how many steps already went out, when the
// last one was sent, and the org's on/off switch, it returns WHICH step (1..3)
// is due right now, or 0 for "nothing to send".

export const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Cumulative cadence, measured from the inquiry (lead.created_at). Step N is
// eligible once at least STEP_THRESHOLD_HOURS[N-1] have elapsed since the
// inquiry. Gentle by design: ~2 days, ~5 days, ~10 days.
export const STEP_THRESHOLD_HOURS = [2 * 24, 5 * 24, 10 * 24] as const;
export const NURTURE_STEPS = STEP_THRESHOLD_HOURS.length;

// Minimum spacing between two nurture sends to the same lead. When an org turns
// the feature on, a lead whose inquiry is older than several thresholds would
// otherwise have all remaining steps fire in one sweep; this paces them out to
// at most one step per ~day instead of a burst.
export const MIN_GAP_HOURS = 24;

// Don't start (or continue) a drip for a lead who inquired a long time ago —
// e.g. when a newly created org imports/enables the feature over historical
// leads. A normal lead completes the whole 10-day sequence well inside this
// window; anything older is considered cold and skipped entirely.
export const NURTURE_MAX_AGE_MS = 30 * DAY_MS;

// The pipeline stages a lead can be nurtured in: it inquired but hasn't booked
// a showing yet, and isn't lost. As soon as the lead advances to booked /
// showed / applied / leased (or is marked lost), it falls out of this set and
// the drip stops automatically — no separate "cancel" bookkeeping.
export const NURTURABLE_STATUSES = ["new", "replied", "contacted"] as const;

export function isNurturableStatus(status: string | null | undefined): boolean {
  return (NURTURABLE_STATUSES as readonly string[]).includes(status ?? "");
}

export type NurtureDueInput = {
  createdAtMs: number | null;
  nowMs: number;
  status: string;
  stepsSent: number;
  lastSentAtMs: number | null;
  enabled: boolean;
};

/**
 * Which nurture step (1..NURTURE_STEPS) should fire for this lead right now?
 * Returns 0 when nothing is due.
 *
 * Returns a positive step only when ALL hold:
 *   - the org has nurture enabled
 *   - the lead is still in a nurturable stage (inquired, not yet booked/lost)
 *   - it hasn't already received every step
 *   - the lead has an inquiry time, and that inquiry isn't older than the
 *     freshness cap (don't drip cold/imported leads)
 *   - at least the NEXT step's cadence threshold has elapsed since the inquiry
 *   - at least MIN_GAP_HOURS have passed since the previous nurture send (pacing)
 *
 * The step returned is always exactly stepsSent + 1, so callers send the steps
 * strictly in order, one per sweep.
 */
export function nurtureStepDue(input: NurtureDueInput): number {
  const { createdAtMs, nowMs, status, stepsSent, lastSentAtMs, enabled } = input;

  if (!enabled) return 0;
  if (!isNurturableStatus(status)) return 0;

  // Clamp a malformed count into range; never below 0.
  const sent = Number.isInteger(stepsSent) && stepsSent > 0 ? stepsSent : 0;
  if (sent >= NURTURE_STEPS) return 0;

  if (createdAtMs == null) return 0;

  const ageMs = nowMs - createdAtMs;
  if (ageMs < 0) return 0; // inquiry in the future — nothing to do
  if (ageMs > NURTURE_MAX_AGE_MS) return 0; // too cold

  const nextStep = sent + 1; // 1-based
  const thresholdMs = STEP_THRESHOLD_HOURS[nextStep - 1] * HOUR_MS;
  if (ageMs < thresholdMs) return 0; // too soon for the next step

  if (lastSentAtMs != null && nowMs - lastSentAtMs < MIN_GAP_HOURS * HOUR_MS) {
    return 0; // sent something too recently — pace it
  }

  return nextStep;
}

export type NurtureCopy = {
  // A short subject base; the email composer appends the property address when
  // one is known. Kept here (not in lib/email) so the per-step copy is pure +
  // unit-testable.
  subject: string;
  // The lead-in line of the email body.
  lead: string;
  // The call-to-action button label.
  cta: string;
};

const STEP_COPY: Record<number, NurtureCopy> = {
  1: {
    subject: "Still interested? Let's find a time",
    lead: "We wanted to follow up on the home you asked about. It may still be available - would you like to come see it?",
    cta: "Book a showing",
  },
  2: {
    subject: "Your next home might still be waiting",
    lead: "Just checking back in - the listing you inquired about could still be a fit. Booking a quick viewing is the best way to know.",
    cta: "See it & book a showing",
  },
  3: {
    subject: "One last note about that listing",
    lead: "We don't want you to miss out. If you're still looking, we'd love to show you around - and if the timing isn't right, just let us know.",
    cta: "Take a look",
  },
};

/**
 * Per-step nurture copy. Steps outside 1..NURTURE_STEPS fall back to step 1 so
 * the composer never renders empty strings.
 */
export function nurtureCopy(step: number): NurtureCopy {
  return STEP_COPY[step] ?? STEP_COPY[1];
}
