// ============================================================================
// unit-journey (S807). One progress line per rental, from turnover to moved in,
// with one "Next:" line. Noam, 2026-11-16: "do we show a progress line for the
// property lifecycle so we know what needs to be done next - we need to make
// this easy and useful though not a mistake".
//
// Truth rules:
// - A step is done only from a recorded fact passed in here (a crew tap, photos
//   on the rental, a saved live ad link, a renter, a booked viewing, a tenancy).
//   Nothing on the line can be clicked to tick a step.
// - When a crew tap and the app's facts disagree, the fact wins and `gap` says
//   what is missing (crew "Ads are up" with no ad link saved, crew "Rented" with
//   no tenancy).
// - S808: an account with no tenancies in Vacantless at all (Agile keeps them in
//   Buildium) ends the line at Rented: no "Moved in" step, no "Add the tenancy"
//   nudge. Any tenancy on the account turns the full line back on.
// PURE. Tests: scripts/test-unit-journey.ts.
// ============================================================================

export const JOURNEY_STEPS = ["turnover", "photos", "ads", "renters", "viewings", "rented", "moved_in"] as const;
export type JourneyStep = (typeof JOURNEY_STEPS)[number];
export type JourneyState = "done" | "current" | "todo";

export const JOURNEY_LABEL: Record<JourneyStep, string> = {
  turnover: "Turnover",
  photos: "Photos",
  ads: "Ads up",
  renters: "Renters",
  viewings: "Viewings",
  rented: "Rented",
  moved_in: "Moved in",
};

export type JourneyInput = {
  /** properties.status: draft | available | paused | leased | off_market ... */
  status: string;
  /** Latest crew stage key (lib/unit-progress STAGES), or null. */
  crewStage: string | null;
  photoCount: number;
  /** Rent, beds and baths are set. */
  hasBasics: boolean;
  /** Live ads with a saved link on rental sites (not counting the Vacantless page). */
  liveAdCount: number;
  /** Renters since the rental last went live. */
  renters: number;
  /** Viewings booked since the rental last went live. */
  viewings: number;
  /** Latest tenancy on the unit, if any. */
  tenancy: "upcoming" | "active" | null;
  /** The account keeps tenancies in Vacantless (it has at least one). */
  tracksTenancies: boolean;
};

export type Journey = {
  steps: { key: JourneyStep; label: string; state: JourneyState }[];
  current: JourneyStep | null;
  next: string | null;
  gap: string | null;
};

const TURNOVER_STAGES = new Set(["notice_given", "under_construction", "being_cleaned", "touch_up", "ready_for_photos", "photographer_booked"]);
const CREW_RENTED = new Set(["waiting_deposit", "deposit_clearing", "rented", "lease_signed"]);

export function unitJourney(i: JourneyInput): Journey {
  const live = i.status === "available";
  const leased = i.status === "leased";
  const inTurnover = i.crewStage != null && TURNOVER_STAGES.has(i.crewStage);
  // A tenant in place and no new turnover: the whole line is done.
  const movedIn = i.tenancy === "active" && !inTurnover && i.crewStage !== "notice_given";
  const rented = movedIn || i.tenancy === "upcoming" || leased;

  const done: Record<JourneyStep, boolean> = {
    turnover: !inTurnover,
    photos: rented || i.photoCount > 0,
    ads: rented || i.liveAdCount > 0,
    renters: rented || (live && i.renters > 0),
    viewings: rented || (live && i.viewings > 0),
    rented,
    moved_in: movedIn,
  };

  const order: readonly JourneyStep[] = i.tracksTenancies ? JOURNEY_STEPS : JOURNEY_STEPS.filter((k) => k !== "moved_in");
  let current: JourneyStep | null = null;
  for (const k of order) {
    if (!done[k]) {
      current = k;
      break;
    }
  }
  const steps = order.map((key) => ({
    key,
    label: JOURNEY_LABEL[key],
    state: (done[key] && (current == null || order.indexOf(key) < order.indexOf(current))
      ? "done"
      : key === current
        ? "current"
        : "todo") as JourneyState,
  }));

  let gap: string | null = null;
  if (i.crewStage === "live" && i.liveAdCount === 0) gap = "Your crew marked ads as up, but no ad link is saved here yet.";
  else if (i.crewStage != null && CREW_RENTED.has(i.crewStage) && !rented)
    gap = i.tracksTenancies ? "Your crew marked it rented, but there is no tenancy yet." : "Your crew marked it rented, but it is not marked rented here yet.";
  else if (i.tracksTenancies && i.crewStage === "moved_in" && i.tenancy !== "active") gap = "Your crew marked it moved in, but there is no active tenancy yet.";

  return { steps, current, next: nextLine(current, i), gap };
}

function nextLine(step: JourneyStep | null, i: JourneyInput): string | null {
  switch (step) {
    case null:
      return null;
    case "turnover":
      return "Waiting on the crew to finish the turnover.";
    case "photos":
      return "Add photos, or link the unit's Drive or Dropbox folder.";
    case "ads":
      if (!i.hasBasics) return "Add the rent, beds and baths, then set it live.";
      if (i.status !== "available") return "Set it live.";
      return "It is live on your page. Post it to the rental sites.";
    case "renters":
      return "No renters yet. Check the ads are showing.";
    case "viewings":
      return "Renters but no viewings yet. Check viewing times are open.";
    case "rented":
      return "Viewings are booking. Mark it rented when a lease is signed.";
    case "moved_in":
      return "Add the tenancy so rent and the move-in start.";
  }
}
