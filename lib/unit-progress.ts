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

/**
 * A stage that takes the ads down. S789: Lease signed and Moved in do too, so
 * a crew that skips the Rented tap never leaves ads up on a full unit (the
 * caller only acts when the rental is not already leased).
 */
export function takesAdsDown(stage: Stage): boolean {
  return stage === "rented" || stage === "lease_signed" || stage === "moved_in";
}

// S789: what a tap does to the unit's tenancy. Pure.
//   Tenant gave notice (with a date): the move-out date lands on the one
//     current tenancy when it has none yet, so Today's "coming vacant" card
//     (lib/coming-vacant) offers the one-click relist. Ads never go up on
//     their own: posting can cost money, the landlord presses Relist.
//   Moved in: the one upcoming tenancy becomes active; with no tenancy at
//     all, the landlord is asked to add it.
export type TenancyLite = { id: string; status: string; move_out_date: string | null };

export type TenancyEffect =
  | { kind: "none" }
  | { kind: "set_move_out"; tenancyId: string; date: string }
  | { kind: "move_out_already"; tenancyId: string; date: string }
  | { kind: "activate"; tenancyId: string }
  | { kind: "already_active"; tenancyId: string }
  | { kind: "needs_tenancy" };

export function tenancyEffect(stage: Stage, dueDate: string | null, tenancies: readonly TenancyLite[]): TenancyEffect {
  const active = tenancies.filter((t) => t.status === "active");
  const upcoming = tenancies.filter((t) => t.status === "upcoming");
  if (stage === "notice_given") {
    if (!dueDate || active.length !== 1) return { kind: "none" };
    const t = active[0];
    if (t.move_out_date) return { kind: "move_out_already", tenancyId: t.id, date: t.move_out_date };
    return { kind: "set_move_out", tenancyId: t.id, date: dueDate };
  }
  if (stage === "moved_in") {
    if (upcoming.length === 1 && active.length === 0) return { kind: "activate", tenancyId: upcoming[0].id };
    if (active.length === 1 && upcoming.length === 0) return { kind: "already_active", tenancyId: active[0].id };
    if (active.length === 0 && upcoming.length === 0) return { kind: "needs_tenancy" };
    return { kind: "none" };
  }
  return { kind: "none" };
}

/** The extra sentence and button the landlord's email carries for an effect. */
export function tenancyEffectAction(
  effect: TenancyEffect,
  propertyId: string,
  appUrl: string,
): { line: string; label: string; url: string } | null {
  switch (effect.kind) {
    case "set_move_out":
    case "move_out_already":
      return {
        line: "The move-out date is on the tenancy. Relist from Today to put the ads up. Viewings open 3 weeks before.",
        label: "Relist now",
        url: `${appUrl}/dashboard`,
      };
    case "activate":
      return { line: "The tenancy is now active.", label: "See the tenancy", url: `${appUrl}/dashboard/tenancies/${effect.tenancyId}` };
    case "needs_tenancy":
      return {
        line: "There is no tenancy for this unit yet. Add it so rent, renewals and notices start.",
        label: "Add the tenancy",
        url: `${appUrl}/dashboard/tenancies/new?property=${encodeURIComponent(propertyId)}`,
      };
    default:
      return null;
  }
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

// S790a: the stage chip on the Rentals list and the rental page, so the
// landlord sees a turnover without opening Unit progress. Pure.
export type StageTone = "notice" | "work" | "ready" | "done" | "hold";

const STAGE_TONE: Record<Stage, StageTone> = {
  notice_given: "notice",
  under_construction: "work",
  being_cleaned: "work",
  touch_up: "work",
  ready_for_photos: "ready",
  photographer_booked: "ready",
  photos_in: "ready",
  ready_to_post: "ready",
  live: "done",
  put_back_up: "done",
  waiting_deposit: "done",
  deposit_clearing: "done",
  rented: "done",
  lease_signed: "done",
  moved_in: "done",
  on_hold: "hold",
};

/** Stages that end a turnover: the chip goes away 14 days after them. */
const FINISHING: readonly Stage[] = ["live", "put_back_up", "rented", "lease_signed", "moved_in"];

export type LatestStage = { stage: string; at: string; date: string | null; by: string | null };
export type StageChip = { label: string; detail: string; title: string; tone: StageTone };

/** "today", "yesterday" or "3 days ago", counted in whole days. */
export function daysAgoText(at: string, now: Date = new Date()): string {
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "";
  const days = Math.max(0, Math.floor((now.getTime() - t) / (24 * 3600 * 1000)));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/**
 * The chip for a unit's latest stage, or null when there is none to show:
 * no tap yet, a finished turnover more than 14 days old, or any stage more
 * than 60 days old.
 */
export function stageChip(latest: LatestStage | null | undefined, now: Date = new Date()): StageChip | null {
  if (!latest || !isStage(latest.stage)) return null;
  const stage = latest.stage;
  const t = Date.parse(latest.at);
  if (!Number.isFinite(t)) return null;
  const ageDays = (now.getTime() - t) / (24 * 3600 * 1000);
  if (ageDays > 60) return null;
  if (FINISHING.includes(stage) && ageDays > 14) return null;
  const label = STAGE_LABEL[stage];
  const dateLine = stageDateLine(stage, latest.date);
  const ago = daysAgoText(latest.at, now);
  const who = latest.by?.trim() ? latest.by.trim().split(/\s+/)[0] : "";
  const detail = dateLine || ago;
  const title = [`${label}.`, dateLine ? `${dateLine}.` : "", who ? `${who} set it ${ago}.` : `Set ${ago}.`]
    .filter(Boolean)
    .join(" ");
  return { label, detail, title, tone: STAGE_TONE[stage] };
}

export const STAGE_TONE_CLASS: Record<StageTone, string> = {
  notice: "border-violet-200 bg-violet-50 text-violet-700",
  work: "border-amber-200 bg-amber-50 text-amber-800",
  ready: "border-sky-200 bg-sky-50 text-sky-700",
  done: "border-emerald-200 bg-emerald-50 text-emerald-700",
  hold: "border-gray-200 bg-gray-50 text-gray-600",
};

// S791a: the photographer's one-time link (/crew/shoot/<token>). Made when a
// unit is marked "Photographer booked"; one unit, one "Photos are in" tap.
export type ShootLinkState = "open" | "used" | "off" | "expired";

/** When a shoot link stops working: 30 days after the shoot, or 45 days from now without a date. */
export function shootLinkExpiry(shootDate: string | null, now: Date = new Date()): Date {
  const day = 24 * 3600 * 1000;
  if (shootDate && /^\d{4}-\d{2}-\d{2}$/.test(shootDate)) {
    const t = Date.parse(`${shootDate}T23:59:00Z`);
    if (Number.isFinite(t)) return new Date(Math.max(t + 30 * day, now.getTime() + 7 * day));
  }
  return new Date(now.getTime() + 45 * day);
}

export function shootLinkState(
  row: { used_at: string | null; revoked_at: string | null; expires_at: string },
  now: Date = new Date(),
): ShootLinkState {
  if (row.used_at) return "used";
  if (row.revoked_at) return "off";
  const t = Date.parse(row.expires_at);
  if (!Number.isFinite(t) || t <= now.getTime()) return "expired";
  return "open";
}

/** A person's name as typed, up to 120 characters; else null. */
export function cleanPersonName(raw: unknown): string | null {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  return s.length > 0 ? s : null;
}

/** Who the landlord's email names for a photographer's tap. */
export function photographerLabel(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  return n ? `Photographer ${n}` : "The photographer";
}
