// ============================================================================
// lib/coming-vacant.ts (S770, REVIEW-S770 section 6): the bridge from "this
// tenant is leaving" to "the unit is relisted and renters can book".
//
// Until S770 the tenancy page recorded the tenant's renewal answer ("leaving")
// and showed "Moving out", and nothing happened next. The landlord had to
// remember, open the rental, pick a date, relist, and set when viewings may
// start: five steps on three pages. This file is the one rule that decides
// when a unit is coming vacant and what the one click should do. Pure: same
// inputs, same output, so Today's card, the tenancy page and the test read
// the same rule.
//
// What counts as coming vacant (two sources, both the tenant's own word):
//   1. tenancies.move_out_date: the landlord recorded the tenant's notice
//      (an N9, a text, a conversation) with the day they leave.
//   2. renewal_intent = "leaving": the tenant answered the renewal check-in.
//      The unit comes vacant on the lease's completion date (end_date, or
//      move-in plus 12 months, the same anchor lib/renewal uses).
// What does NOT count: an N12 (the landlord or family moves in: relisting
// would be bad faith), an N13 (repairs, demolition, conversion), and an N4,
// N5 or N8 on its own (the tenant may pay or the Board may refuse). When one
// of those ends in the tenant leaving, the landlord records the move-out
// date (source 1) and the bridge takes over from there.
// ============================================================================

import { deriveRenewalCheckin, type RenewalIntent } from "./renewal";

/** Viewings may start this many days before the unit is empty. */
export const VIEWINGS_BEFORE_VACANT_DAYS = 21;
/** A move-out this far in the past is history, not a vacancy to relist. */
export const STALE_AFTER_DAYS = 30;

export type MoveOutSource = "tenant_notice" | "renewal_checkin" | "landlord";

export type ComingVacantInput = {
  tenancyId: string;
  propertyId: string;
  address: string;
  /** tenancies.start_date / end_date (YYYY-MM-DD). */
  startDate: string | null;
  endDate?: string | null;
  renewalIntent?: RenewalIntent | null;
  /** tenancies.move_out_date, when the landlord recorded the tenant's notice. */
  moveOutDate?: string | null;
  /** properties.status, available_date, viewing_earliest_date. */
  propertyStatus: string | null;
  availableDate?: string | null;
  viewingEarliestDate?: string | null;
};

export type ComingVacant = {
  tenancyId: string;
  propertyId: string;
  address: string;
  /** The day the unit is empty (YYYY-MM-DD). */
  vacantDate: string;
  /** The day viewings may start: 21 days before, never before today. */
  viewingsFrom: string;
  /** Where the date came from. */
  source: "move_out_date" | "renewal_checkin";
  /** Days from today to the vacant date (negative once past). */
  daysUntilVacant: number;
  /** True once the rental is live with the vacant date as its available date. */
  relisted: boolean;
  /** One line for Today. */
  title: string;
  line: string;
};

/**
 * Decide whether this tenancy's unit is coming vacant, as of `today`
 * (YYYY-MM-DD in the account's time zone). Null when it is not, when the
 * move-out is more than STALE_AFTER_DAYS in the past, or when a date cannot
 * be read.
 */
export function deriveComingVacant(input: ComingVacantInput, today: string): ComingVacant | null {
  if (!isYmd(today)) return null;
  let vacantDate: string | null = null;
  let source: ComingVacant["source"] | null = null;
  if (isYmd(input.moveOutDate)) {
    vacantDate = input.moveOutDate;
    source = "move_out_date";
  } else if (input.renewalIntent === "leaving") {
    const checkin = deriveRenewalCheckin(
      { startDate: input.startDate, endDate: input.endDate ?? null, intent: "leaving" },
      today,
    );
    if (!checkin) return null;
    vacantDate = checkin.completionDate;
    source = "renewal_checkin";
  }
  if (!vacantDate || !source) return null;

  const daysUntilVacant = daysBetween(today, vacantDate);
  if (daysUntilVacant < -STALE_AFTER_DAYS) return null;

  const earliest = addDays(vacantDate, -VIEWINGS_BEFORE_VACANT_DAYS);
  const viewingsFrom = earliest < today ? today : earliest;

  const relisted =
    input.propertyStatus === "available" && (input.availableDate ?? null) === vacantDate;

  const when = daysUntilVacant < 0 ? "was due to be empty" : "is coming vacant";
  const title = `${input.address} ${when} on ${shortDate(vacantDate)}.`;
  const line = relisted
    ? `Relisted. Ads are up and viewings open from ${shortDate(viewingsFrom)}.`
    : `Relist now: ads go up today, and viewings open from ${shortDate(viewingsFrom)}.`;

  return {
    tenancyId: input.tenancyId,
    propertyId: input.propertyId,
    address: input.address,
    vacantDate,
    viewingsFrom,
    source,
    daysUntilVacant,
    relisted,
    title,
    line,
  };
}

/** The values the one click writes on the rental. Pure. */
export function relistPlan(cv: Pick<ComingVacant, "vacantDate" | "viewingsFrom">): {
  status: "available";
  available_date: string;
  viewing_earliest_date: string;
} {
  return { status: "available", available_date: cv.vacantDate, viewing_earliest_date: cv.viewingsFrom };
}

/**
 * The heads-up a landlord can send the tenant with one click after relisting.
 * Ontario needs 24 hours' written notice before each entry; this message does
 * not replace that, it says viewings are coming and how they will hear.
 */
export function showingHeadsUp(args: {
  address: string;
  viewingsFrom: string;
  vacantDate: string;
  orgName: string;
}): { subject: string; body: string } {
  return {
    subject: `Viewings at ${args.address} from ${shortDate(args.viewingsFrom)}`,
    body:
      `Hello,\n\n` +
      `Thank you for telling us you are moving out on ${longDate(args.vacantDate)}. ` +
      `We will show the unit to new renters from ${longDate(args.viewingsFrom)}.\n\n` +
      `You get written notice at least 24 hours before each viewing. It names the date and a time between 8 a.m. and 8 p.m. ` +
      `If some days or times do not work for you, reply to this message. We will work around them.\n\n` +
      `Thank you,\n${args.orgName}`,
  };
}

// --- dates (UTC-anchored, same as lib/renewal) -------------------------------
function isYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function toMs(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
function fromMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(ymd: string, days: number): string {
  return fromMs(toMs(ymd) + days * 86_400_000);
}
function daysBetween(from: string, to: string): number {
  return Math.round((toMs(to) - toMs(from)) / 86_400_000);
}
function shortDate(ymd: string): string {
  return new Date(toMs(ymd)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}
function longDate(ymd: string): string {
  return new Date(toMs(ymd)).toLocaleDateString("en-CA", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
