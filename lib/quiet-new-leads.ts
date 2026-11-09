// S771 (REVIEW-S770 section 5): "New" should mean what a landlord thinks it
// means: a renter nobody has answered. Half of Agile's inquiries sat at "New"
// even though the auto-reply went out within seconds, because nobody moved the
// stage. A renter who got an email or text from us and has not written back
// in 3 days moves to "Contacted" on its own. Writing back already sets
// "replied", and booking sets "booked", so only "new" is ever moved.
//
// Pure rule; app/api/cron/quiet-new-leads reads the rows and writes the move.

export const QUIET_DAYS = 3;
export const QUIET_MS = QUIET_DAYS * 24 * 3_600_000;
/** Older than this and the lead is history, not a stage to tidy (matches nurture). */
export const QUIET_MAX_AGE_MS = 30 * 24 * 3_600_000;

export type QuietNewInput = {
  status: string | null | undefined;
  createdAtMs: number | null;
  nowMs: number;
  /** An outbound email or text to this renter is logged in messages. */
  hasOutboundReply: boolean;
};

export function shouldMoveToContacted(i: QuietNewInput): boolean {
  if (i.status !== "new") return false;
  if (!i.hasOutboundReply) return false; // never answered: it really is still "New"
  if (i.createdAtMs == null) return false;
  const age = i.nowMs - i.createdAtMs;
  return age >= QUIET_MS && age <= QUIET_MAX_AGE_MS;
}

export const QUIET_MOVE_NOTE =
  `Moved to Contacted automatically: our reply went out and the renter has not written back in ${QUIET_DAYS} days.`;
