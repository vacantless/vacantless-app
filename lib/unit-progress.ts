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
  "notice_given",
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
  "lease_signed",
  "moved_in",
  "on_hold",
  "put_back_up",
] as const;
export type Stage = (typeof STAGES)[number];

export function isStage(v: unknown): v is Stage {
  return typeof v === "string" && (STAGES as readonly string[]).includes(v);
}

export const STAGE_LABEL: Record<Stage, string> = {
  notice_given: "Tenant gave notice",
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
  lease_signed: "Lease signed",
  moved_in: "Moved in",
  on_hold: "On hold",
  put_back_up: "Back on the market",
};

/** The stages a person taps on their link, in the order they show. */
export const TAP_ORDER: Stage[] = [
  "notice_given",
  "under_construction",
  "being_cleaned",
  "ready_for_photos",
  "photographer_booked",
  "photos_in",
  "ready_to_post",
  "waiting_deposit",
  "deposit_clearing",
  "rented",
  "lease_signed",
  "moved_in",
  "on_hold",
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

/** Stages that carry a date, and what the date means. */
export const STAGE_DATE_LABEL: Partial<Record<Stage, string>> = {
  notice_given: "Moving out",
  under_construction: "Ready by",
  being_cleaned: "Ready by",
  photographer_booked: "Shoot date",
};

export function stageTakesDate(stage: Stage): boolean {
  return STAGE_DATE_LABEL[stage] !== undefined;
}

/** A YYYY-MM-DD date within two years either side of now, or null. */
export function cleanDate(raw: unknown, now: Date = new Date()): string | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T12:00:00Z`);
  if (!Number.isFinite(t)) return null;
  const twoYears = 2 * 366 * 24 * 3600 * 1000;
  if (Math.abs(t - now.getTime()) > twoYears) return null;
  return new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/** "Ready by Dec 1" for a stage's date; empty when there is none. */
export function stageDateLine(stage: Stage, date: string | null): string {
  const label = STAGE_DATE_LABEL[stage];
  if (!label || !date) return "";
  const d = new Date(`${date}T12:00:00Z`);
  const md = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(d);
  return `${label} ${md}`;
}

/** A note is kept short and plain; empty means none. */
export function cleanNote(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return s.length > 0 ? s : null;
}

// S788e: the manager or leasing person can add a unit from their link (a unit
// starting a reno that is not in Vacantless yet). It lands as a private draft.
export function canAddUnit(role: CrewRole): boolean {
  return role === "manager" || role === "leasing";
}

/** A unit number as typed: letters, digits and dashes, up to 10; else null. */
export function cleanUnitNumber(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/^(unit|suite|apt|#)\s*/i, "");
  return /^[A-Za-z0-9-]{1,10}$/.test(s) ? s : null;
}

/** "833 Pillette Rd, Windsor, ON" + "22" -> "833 Pillette Rd, Unit 22, Windsor, ON". */
export function composeUnitAddress(street: string, unit: string): string {
  const parts = street.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return `Unit ${unit}`;
  return [parts[0], `Unit ${unit}`, ...parts.slice(1)].join(", ");
}
