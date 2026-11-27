// S846 (KI1823): the team cancels a booked viewing, confirmed or not, with a
// reason. Before this, Release was the only way to tell the renter, and it
// said "still unconfirmed" even to a renter who had confirmed. Pure helpers;
// the send lives in lib/showing-release.ts.

export const TEAM_CANCEL_REASONS = ["unit_rented", "other"] as const;
export type TeamCancelReason = (typeof TEAM_CANCEL_REASONS)[number];

export function isTeamCancelReason(v: unknown): v is TeamCancelReason {
  return typeof v === "string" && (TEAM_CANCEL_REASONS as readonly string[]).includes(v);
}

/** The words for the reason, as the team and the agent read them. */
export function teamCancelReasonLabel(reason: TeamCancelReason): string {
  return reason === "unit_rented" ? "the unit is rented" : "the team had to cancel it";
}

/** Who pressed it: their name if the account has one, else their email. */
export function actorLabel(
  user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined,
): string {
  const meta = user?.user_metadata ?? {};
  const name = [meta.full_name, meta.name].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  return name?.trim() || user?.email?.trim() || "a team member";
}

/** The activity note on the renter's page. Names who did it and why. */
export function teamCancelNote(input: { reason: TeamCancelReason; actor: string; whenLabel: string }): string {
  const why = input.reason === "unit_rented" ? " because the unit is rented" : "";
  return `Viewing on ${input.whenLabel} cancelled by ${input.actor}${why}. The renter was emailed.`;
}

/** The note when the team releases an unconfirmed viewing (names who did it). */
export function operatorReleaseNote(actor: string): string {
  return `Viewing released by ${actor} because it was still unconfirmed.`;
}

/** Only an open viewing still ahead can be cancelled. */
export function canTeamCancel(s: { outcome: string | null; scheduled_at: string | null }, nowMs: number): boolean {
  if (s.outcome != null && s.outcome !== "scheduled") return false;
  if (!s.scheduled_at) return false;
  const t = new Date(s.scheduled_at).getTime();
  return Number.isFinite(t) && t > nowMs;
}
