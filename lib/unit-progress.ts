// S788b: unit progress links (PLAN-S788-UNIT-PROGRESS). Pure: no DB, no env.
// A landlord's crew (manager, leasing, contractor, cleaner, photographer)
// each get a no-login link (/crew/<token>) and tap each unit's stage. The
// latest event is the unit's current stage. Same stages for every account.

export const CREW_ROLES = ["manager", "leasing", "contractor", "cleaner", "photographer"] as const;
export type CrewRole = (typeof CREW_ROLES)[number];

export const CREW_ROLE_LABEL: Record<CrewRole, string> = {
  manager: "Manager",
  leasing: "Leasing",
  contractor: "Contractor",
  cleaner: "Cleaner",
  photographer: "Photographer",
};

export function isCrewRole(v: unknown): v is CrewRole {
  return typeof v === "string" && (CREW_ROLES as readonly string[]).includes(v);
}

export const STAGES = [
  "under_construction",
  "being_cleaned",
  "ready_for_photos",
  "photographer_booked",
  "photos_in",
  "touch_up",
  "ready_to_post",
  "live",
  "waiting_deposit",
  "deposit_clearing",
  "rented",
  "put_back_up",
] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export const STAGE_LABEL: Record<Stage, string> = {
  under_construction: "Under construction",
  being_cleaned: "Being cleaned",
  ready_for_photos: "Ready for photos",
  photographer_booked: "Photographer booked",
  photos_in: "Photos are in",
  touch_up: "Photos being touched up",
  ready_to_post: "Ready to post",
  live: "Ads are up",
  waiting_deposit: "Waiting for deposit",
  deposit_clearing: "Deposit clearing",
  rented: "Rented",
  put_back_up: "Back on the market",
};

/** The stages a person taps on their link, in the order they show. */
export const TAP_ORDER: Stage[] = [
  "under_construction",
  "being_cleaned",
  "ready_for_photos",
  "photographer_booked",
  "photos_in",
  "ready_to_post",
  "waiting_deposit",
  "deposit_clearing",
  "rented",
];

const ROLE_TAPS: Record<CrewRole, readonly Stage[]> = {
  manager: TAP_ORDER,
  leasing: TAP_ORDER,
  contractor: ["under_construction", "being_cleaned", "ready_for_photos", "photos_in"],
  cleaner: ["under_construction", "being_cleaned", "ready_for_photos", "photos_in"],
  photographer: ["photos_in"],
};

/** Whether this role may set this stage from their link. */
export function canTap(role: CrewRole, stage: Stage): boolean {
  return ROLE_TAPS[role].includes(stage);
}

/** The buttons a role sees for a unit, leaving out the stage it is already at. */
export function tapsFor(role: CrewRole, current: Stage | null): Stage[] {
  return TAP_ORDER.filter((s) => canTap(role, s) && s !== current);
}

export type ProgressEvent = { stage: string; created_at: string };

/** The unit's current stage: the newest valid event, or null when none. */
export function currentStage(events: readonly ProgressEvent[]): Stage | null {
  let best: ProgressEvent | null = null;
  for (const e of events) {
    if (!isStage(e.stage)) continue;
    if (!best || Date.parse(e.created_at) > Date.parse(best.created_at)) best = e;
  }
  return best ? (best.stage as Stage) : null;
}

/** A stage that takes the ads down. */
export function takesAdsDown(stage: Stage): boolean {
  return stage === "rented";
}

/** A note is kept short and plain; empty means none. */
export function cleanNote(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return s.length > 0 ? s : null;
}
