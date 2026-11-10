// S775: group viewings per rental (migration 0280, properties.viewing_group_size).
// Landlords on the forums name group viewings as the best answer to no-shows:
// one time, several renters, so a no-show costs nothing. One place for the
// rule's words and parsing; the database enforces the size (set_showing_slot_lock).

export const GROUP_SIZE_MAX = 20;

/** Form value to a stored size: blank = the account's rule; 1 to 20 kept. */
export function parseGroupSize(v: unknown): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n >= 1 && n <= GROUP_SIZE_MAX ? n : null;
}

/** What blank means on this account, for the rental form's hint. */
export function accountGroupRule(allowDoubleBooking: boolean): string {
  return allowDoubleBooking ? "Blank: open house, no limit" : "Blank: one renter per time";
}

/**
 * The renter page line above the times. group_size from get_public_availability:
 * 1 (or missing) = one renter, nothing to say; 0 = open house, no limit; N = up to N.
 */
export function groupViewingLine(groupSize: number | null | undefined): string | null {
  if (groupSize == null || groupSize === 1) return null;
  if (groupSize === 0) return "These are group viewings. Other renters may join the same time.";
  return `These are group viewings, up to ${groupSize} renters at each time.`;
}
