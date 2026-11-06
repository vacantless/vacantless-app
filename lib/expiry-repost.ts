// S756 (review item 7, REVIEW-S754-POSTING-AUTOPILOT): re-post an ad a robot
// site dropped while the rental is still available. Pure.
//
// The daily live checks flip a listing_posts row live -> removed when the site
// itself says the ad is gone: listing-post-live-check (Kijiji at 60 days,
// Zumper's "Alert me when this rental is available") and the home Rentals.ca
// check. Before this the row just said "nothing was re-posted" and a person had
// to notice the gap. Now, for an org with the Posting add-on and "post without
// asking each time" on, the run item that made the ad is queued again, the same
// write "Post it for me" makes. Free ads go straight up under the standing
// setting; a paid Kijiji ad still stops at checkout for the landlord's card.
//
// Guards, so this can never loop: only a removal the check wrote in the last
// few days (old gaps are the landlord's call, "Post to the missing sites"),
// only an ad that stayed up at least a week (a site that pulls a fresh ad is
// moderation, not expiry), and once per removed row (a note line marks it).

import { isRobotPostedChannel } from "./posting-lanes";
import { siteName } from "./ads-still-up";

/** A removal older than this is not re-posted automatically. */
export const EXPIRY_REPOST_WINDOW_DAYS = 3;
/** An ad that lived less than this was pulled, not expired. */
export const EXPIRY_REPOST_MIN_LIVE_DAYS = 7;
/** The note line that marks a removed row as handled (never twice). */
export const EXPIRY_REPOST_MARK = "expiry re-post";

const DAY_MS = 86_400_000;

/**
 * The date of the live check's removal line, when the LAST note line is one.
 * Two writers: "live-check 2026-09-07 22:40Z: REMOVED (...)" (app) and
 * "2026-10-26 home live check: Rentals.ca no longer shows this ad" (worker).
 * A person's later note (or any other last line) means a person has been
 * here, so it returns null.
 */
export function removalDateFromNotes(notes: string | null | undefined): string | null {
  const lines = String(notes ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  let m = last.match(/^live-check (\d{4}-\d{2}-\d{2}) \d{2}:\d{2}Z: REMOVED\b/);
  if (m) return m[1];
  m = last.match(/^(\d{4}-\d{2}-\d{2}) home live check: .* no longer shows this ad\b/);
  if (m) return m[1];
  return null;
}

export type ExpiryRepostInput = {
  portal: string;
  postStatus: string | null;
  notes: string | null;
  /** listing_posts.posted_on (YYYY-MM-DD) or, failing that, created_at. */
  postedOn: string | null;
  propertyStatus: string | null;
  propertyArchived: boolean;
  /** readRobotPostingAccess: the Posting add-on gate. */
  addonAllowed: boolean;
  /** organizations.posting_autopilot. */
  autopilot: boolean;
  /** The org's saved sign-in on this site reads alive. */
  sessionAlive: boolean;
  /** The org may see this site at all (lib/posting-lanes isHiddenForOrg). */
  channelShown: boolean;
  nowISO: string;
};

export type ExpiryRepostReason =
  | "repost"
  | "not_robot_site"
  | "not_removed"
  | "already_handled"
  | "not_a_live_check_removal"
  | "removal_too_old"
  | "pulled_too_soon"
  | "rental_not_available"
  | "no_posting_addon"
  | "setting_off"
  | "signed_out"
  | "site_hidden";

export function expiryRepostDecision(input: ExpiryRepostInput): { repost: boolean; reason: ExpiryRepostReason } {
  const no = (reason: ExpiryRepostReason) => ({ repost: false, reason });
  if (!isRobotPostedChannel(input.portal)) return no("not_robot_site");
  if (input.postStatus !== "removed") return no("not_removed");
  if (String(input.notes ?? "").toLowerCase().includes(EXPIRY_REPOST_MARK)) return no("already_handled");
  const removedOn = removalDateFromNotes(input.notes);
  if (!removedOn) return no("not_a_live_check_removal");
  const now = Date.parse(input.nowISO);
  const removedMs = Date.parse(`${removedOn}T00:00:00Z`);
  if (!Number.isFinite(now) || !Number.isFinite(removedMs)) return no("not_a_live_check_removal");
  if (now - removedMs > EXPIRY_REPOST_WINDOW_DAYS * DAY_MS) return no("removal_too_old");
  const postedMs = input.postedOn ? Date.parse(`${input.postedOn.slice(0, 10)}T00:00:00Z`) : NaN;
  if (!Number.isFinite(postedMs) || removedMs - postedMs < EXPIRY_REPOST_MIN_LIVE_DAYS * DAY_MS) {
    return no("pulled_too_soon");
  }
  if (input.propertyStatus !== "available" || input.propertyArchived) return no("rental_not_available");
  if (!input.channelShown) return no("site_hidden");
  if (!input.addonAllowed) return no("no_posting_addon");
  if (!input.autopilot) return no("setting_off");
  if (!input.sessionAlive) return no("signed_out");
  return { repost: true, reason: "repost" };
}

/** Audit line on the re-queued run item (shown on the rental's Get online tab). */
export function expiryRepostAudit(portal: string): string {
  return `The ${siteName(portal)} ad ended on the site and the rental is still available, so we are posting it again (your Posting setting: post without asking each time). Press Stop on the rental to hold it.`;
}

/** Note line appended to the removed listing_posts row once it is handled. */
export function expiryRepostNoteLine(nowISO: string, runItemId: string | null): string {
  const day = nowISO.slice(0, 10);
  return runItemId
    ? `${day} ${EXPIRY_REPOST_MARK}: queued run item ${runItemId} to post it again.`
    : `${day} ${EXPIRY_REPOST_MARK}: not queued (no run item made this ad); use Post to the missing sites.`;
}
