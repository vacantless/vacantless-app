// ============================================================================
// ad-edits-follow (S761, REVIEW-S761 item 2: "Edits follow").
//
// Change the rent, the description or the move-in date on a live rental and,
// until S761, the Vacantless page updated while the ads on Kijiji, Rentals.ca
// and Zumper kept the old details, and nothing said so. This module is the
// pure half of the fix:
//
//  - which saved fields count as a change the ads must carry;
//  - which live ads the robot refreshes by itself (free robot sites: take the
//    old ad down, then post the new one; the free slot comes back first), and
//    which the landlord edits on the site (Kijiji's paid ad would cost again
//    if re-posted, so it waits for the robot to learn Kijiji's edit page;
//    Marketplace is always the landlord's);
//  - the note that marks a takedown as "re-post me after", and the decision
//    the sweep makes when that takedown is done.
// ============================================================================

import { isRobotPostedChannel } from "./posting-lanes";
import { siteName } from "./ads-still-up";

/** The saved fields every ad shows. A change to one of them must reach the ads. */
export const AD_FIELDS = ["rent_cents", "description", "available_date", "beds", "baths", "parking"] as const;
export type AdField = (typeof AD_FIELDS)[number];

const AD_FIELD_LABEL: Record<AdField, string> = {
  rent_cents: "rent",
  description: "description",
  available_date: "move-in date",
  beds: "bedrooms",
  baths: "bathrooms",
  parking: "parking",
};

type AdFieldValues = Partial<Record<AdField, string | number | null | undefined>>;

function norm(v: string | number | null | undefined): string {
  if (v == null) return "";
  return String(v).trim();
}

/** The labels of the ad fields that changed, in AD_FIELDS order. Pure. */
export function adDetailsChanged(before: AdFieldValues, after: AdFieldValues): string[] {
  const out: string[] = [];
  for (const f of AD_FIELDS) {
    if (norm(before[f]) !== norm(after[f])) out.push(AD_FIELD_LABEL[f]);
  }
  return out;
}

/** Free robot sites: the robot refreshes these by re-posting. */
export const REPOST_ON_EDIT_CHANNELS: readonly string[] = ["rentals_ca", "zumper"];

export type LivePostRow = { id: string; portal: string; status: string | null; url: string | null };

export type AdUpdatePlan = {
  /** Sites the robot refreshes on its own (takedown, then re-post). */
  repost: string[];
  /** Sites whose ad the landlord edits on the site, with the ad link. */
  byHand: { portal: string; url: string | null }[];
  /** S762: the Facebook Page post's text was changed in place. */
  page?: boolean;
  /** S762: sites the robot edits in place (Kijiji, behind the kijiji_edits switch). */
  edit?: string[];
};

export function adUpdatePlan(input: {
  posts: LivePostRow[];
  aliveChannels: readonly string[];
  postingAllowed: boolean;
  autopilot: boolean | null | undefined;
  /** S762: sites the robot may edit in place for this change (Kijiji with the switch on, text changes only). */
  editInPlace?: readonly string[];
}): AdUpdatePlan {
  const alive = new Set(input.aliveChannels);
  const plan: AdUpdatePlan = { repost: [], byHand: [], edit: [] };
  for (const p of input.posts) {
    if (p.status !== "live") continue;
    const robotCanEdit =
      input.postingAllowed &&
      input.autopilot === true &&
      (input.editInPlace ?? []).includes(p.portal) &&
      alive.has(p.portal) &&
      !!p.url;
    if (robotCanEdit) {
      if (!plan.edit!.includes(p.portal)) plan.edit!.push(p.portal);
      continue;
    }
    const robotCanRepost =
      input.postingAllowed &&
      input.autopilot === true &&
      isRobotPostedChannel(p.portal) &&
      REPOST_ON_EDIT_CHANNELS.includes(p.portal) &&
      alive.has(p.portal);
    if (robotCanRepost) {
      if (!plan.repost.includes(p.portal)) plan.repost.push(p.portal);
    } else if (p.portal !== "facebook_feed" && p.portal !== "instagram") {
      if (!plan.byHand.some((b) => b.portal === p.portal)) plan.byHand.push({ portal: p.portal, url: p.url });
    }
  }
  return plan;
}

/** The note line on a takedown item that asks the sweep to re-post once it is done. */
export const UPDATE_REPOST_MARK = "update re-post";

export function updateRepostNote(nowISO: string, changed: string[]): string {
  const what = changed.length ? changed.join(", ") : "details";
  return `${nowISO.slice(0, 10)} ${UPDATE_REPOST_MARK}: ${what} changed; post the new ad once this one is down`;
}

export function isUpdateRepost(notes: string | null | undefined): boolean {
  return String(notes ?? "").includes(UPDATE_REPOST_MARK);
}

export function updateTakedownAudit(portal: string): string {
  return `Updating your ${siteName(portal)} ad. We take the old one down, then post the new details.`;
}

/** S762: text changes the robot can carry into a Kijiji edit (not photos). Pure. */
export function editableInPlace(changed: readonly string[]): boolean {
  return changed.some((c) => c !== "photos");
}

export function editInPlaceAudit(portal: string): string {
  return `Editing your ${siteName(portal)} ad with the new details. No new fee.`;
}

export function updateRepostAudit(portal: string): string {
  return `Posting your updated ${siteName(portal)} ad now. Press Stop on the rental to hold it.`;
}

/** What the sweep does with a takedown item that carries the mark. Pure. */
export function updateRepostDecision(input: {
  transport: string | null;
  publishStatus: string | null;
  notes: string | null;
  propertyStatus: string | null;
  propertyArchived: boolean;
  postingAllowed: boolean;
  autopilot: boolean | null | undefined;
  sessionAlive: boolean;
}): "repost" | "wait" | "drop" {
  if (!isUpdateRepost(input.notes)) return "drop";
  if (input.transport !== "takedown") return "drop";
  if (input.publishStatus === "queued" || input.publishStatus === "submitting") return "wait";
  if (input.publishStatus !== "skipped") return "drop";
  if (input.propertyArchived || input.propertyStatus !== "available") return "drop";
  if (!input.postingAllowed || input.autopilot !== true || !input.sessionAlive) return "drop";
  return "repost";
}

/**
 * The saved notice after a save: what is updating on its own, what is the landlord's.
 * S764: portals in `shownElsewhere` (Facebook Marketplace when the page shows
 * the helper's update button) are left out of the text.
 */
export function adUpdateNotice(plan: AdUpdatePlan, shownElsewhere: readonly string[] = []): string | null {
  const parts: string[] = [];
  if (plan.page) parts.push("Facebook Page: we updated your post.");
  if (plan.edit?.length) parts.push(`${plan.edit.map(siteName).join(" and ")}: we are editing your ad. No new fee.`);
  if (plan.repost.length) {
    parts.push(`${plan.repost.map(siteName).join(" and ")}: we are updating your ad.`);
  }
  for (const b of plan.byHand) {
    if (shownElsewhere.includes(b.portal)) continue;
    parts.push(`${siteName(b.portal)} still shows the old details. Edit the ad there.`);
  }
  return parts.length ? parts.join(" ") : null;
}

/** The saved page reads the plan back from the redirect ("rentals_ca,zumper,hand:kijiji"). */
export function adUpdatePlanFromParam(value: string | null | undefined): AdUpdatePlan {
  const plan: AdUpdatePlan = { repost: [], byHand: [] };
  for (const raw of String(value ?? "").split(",")) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "page") plan.page = true;
    else if (part.startsWith("edit:")) (plan.edit ??= []).push(part.slice(5));
    else if (part.startsWith("hand:")) plan.byHand.push({ portal: part.slice(5), url: null });
    else plan.repost.push(part);
  }
  return plan;
}
