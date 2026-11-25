// ============================================================================
// site-work-waiting (S841d, REVIEW-S841-SIGNIN-GROUPING).
//
// A robot site that signed the landlord out needs nobody until there is
// something to do there: an ad to post, change, take down or renew. Rentals.ca
// signs out every 2 to 3 days (KI1743), so asking at every sign-out meant a
// sign-in every few days with nothing waiting. The ads stay up while signed
// out. This module answers three questions, all pure:
//
//  1. siteWorkWaiting: is anything waiting on this site right now?
//  2. recheckDecision: one site was just found signed out; which other sites
//     have not been looked at since, and should the one email wait for them?
//  3. signinDueSoon: a site that still works but is late in a sign-in that
//     usually ends soon, worth doing in the same sitting.
//
// Leans toward asking: any doubt counts as work waiting.
// ============================================================================

import { isUnavailableStatus } from "./ads-still-up";

export type SiteWorkReason = "queued_job" | "takedown" | "renewal";
export type SiteWork = { waiting: boolean; reasons: SiteWorkReason[] };

export type WorkProperty = { id: string; status: string | null; archived: boolean };
export type WorkPost = {
  propertyId: string | null;
  portal: string;
  status: string | null;
  postedOn: string | null;
  notes: string | null;
};
export type WorkItem = { channel: string | null; publishStatus: string | null; status: string | null; updatedAt: string | null };

/** A job in one of these states is waiting on the robot, so on the sign-in. */
export const WAITING_PUBLISH_STATUSES: readonly string[] = ["queued", "submitting", "needs_login", "needs_operator"];
/** An older open job is stale history (a skipped run from weeks ago), not work. */
export const WAITING_JOB_DAYS = 14;

/**
 * The robot renews a free Rentals.ca ad 18 days after its last post or renewal
 * (worker rentals-renew-logic RENEW_AFTER_DAYS; the ad drops at 21). We ask for
 * the sign-in one day before, so it is fresh when the robot comes by.
 */
export const RENEW_ASK_AFTER_DAYS = 17;

const YMD = /\b(\d{4}-\d{2}-\d{2})\b/;
const DAY_MS = 86_400_000;

/** Same rule as the worker's lastRenewedOn: the post date, or a later note line that says it renewed. */
export function lastRenewedOn(postedOn: string | null | undefined, notes: string | null | undefined): string | null {
  let best: string | null = postedOn && YMD.test(postedOn) ? postedOn.slice(0, 10) : null;
  for (const seg of String(notes ?? "").split(/\n|\|/)) {
    if (!/renewed/i.test(seg)) continue;
    const m = seg.match(YMD);
    if (m && (!best || m[1] > best)) best = m[1];
  }
  return best;
}

function daysBetween(a: string | null, b: string): number | null {
  if (!a) return null;
  const ta = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const tb = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return Math.round((tb - ta) / DAY_MS);
}

export function siteWorkWaiting(input: {
  channel: string;
  properties: readonly WorkProperty[];
  posts: readonly WorkPost[];
  items: readonly WorkItem[];
  /** Today in the account's time zone, YYYY-MM-DD. */
  today: string;
  nowISO: string;
}): SiteWork {
  const reasons: SiteWorkReason[] = [];
  const now = Date.parse(input.nowISO);

  const jobWaiting = input.items.some((i) => {
    if (i.channel !== input.channel) return false;
    if (i.status === "done" || i.status === "skipped") return false;
    if (!WAITING_PUBLISH_STATUSES.includes(String(i.publishStatus ?? ""))) return false;
    const at = i.updatedAt ? Date.parse(i.updatedAt) : NaN;
    // No date on an open job: count it (lean toward asking).
    return !Number.isFinite(at) || !Number.isFinite(now) || now - at <= WAITING_JOB_DAYS * DAY_MS;
  });
  if (jobWaiting) reasons.push("queued_job");

  const byId = new Map(input.properties.map((p) => [p.id, p]));
  const live = input.posts.filter((p) => p.portal === input.channel && p.status === "live");
  const takedown = live.some((p) => {
    const prop = p.propertyId ? byId.get(p.propertyId) : undefined;
    // An ad whose rental we cannot see is left alone: not ours to call work.
    if (!prop) return false;
    return prop.archived || isUnavailableStatus(prop.status);
  });
  if (takedown) reasons.push("takedown");

  if (input.channel === "rentals_ca") {
    const renewal = live.some((p) => {
      const prop = p.propertyId ? byId.get(p.propertyId) : undefined;
      if (!prop || prop.archived || prop.status !== "available") return false;
      const d = daysBetween(lastRenewedOn(p.postedOn, p.notes), input.today);
      return d !== null && d >= RENEW_ASK_AFTER_DAYS;
    });
    if (renewal) reasons.push("renewal");
  }

  return { waiting: reasons.length > 0, reasons };
}

const REASON_PHRASE: Record<SiteWorkReason, string> = {
  queued_job: "an ad is waiting to go up or change",
  takedown: "an ad for a rented rental is waiting to come down",
  renewal: "a free ad is due to be renewed",
};

/** "an ad is waiting to go up or change, and a free ad is due to be renewed" */
export function siteWorkPhrase(work: SiteWork): string {
  const parts = work.reasons.map((r) => REASON_PHRASE[r]);
  if (parts.length === 0) return "nothing is waiting";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

// ---- 2. One check, one ask --------------------------------------------------

export type RecheckRow = {
  channel: string;
  alive: boolean | null;
  lastCheckedAt: string | null;
  checkRequestedAt: string | null;
};

/** Another site looked at this recently is taken as checked. */
export const RECHECK_FRESH_MINUTES = 60;
/** The one email waits at most this long for the other sites' answer (a sleeping home computer never answers). */
export const RECHECK_WAIT_MINUTES = 30;

/**
 * `lostCheckedAt` is when the signed-out site was found. Other sites that read
 * signed in but were last looked at well before that are asked again
 * (`request`), and the email holds until they answer or the wait runs out.
 */
export function recheckDecision(input: {
  lostCheckedAt: string | null;
  others: readonly RecheckRow[];
  nowISO: string;
}): { request: string[]; hold: boolean } {
  const found = input.lostCheckedAt ? Date.parse(input.lostCheckedAt) : NaN;
  const now = Date.parse(input.nowISO);
  if (!Number.isFinite(found) || !Number.isFinite(now)) return { request: [], hold: false };
  const request: string[] = [];
  let hold = false;
  for (const o of input.others) {
    if (o.alive !== true) continue; // already known signed out, or never signed in
    const checked = o.lastCheckedAt ? Date.parse(o.lastCheckedAt) : NaN;
    if (Number.isFinite(checked) && checked >= found - RECHECK_FRESH_MINUTES * 60_000) continue;
    const asked = o.checkRequestedAt ? Date.parse(o.checkRequestedAt) : NaN;
    if (!Number.isFinite(asked) || asked < found - RECHECK_FRESH_MINUTES * 60_000) {
      request.push(o.channel);
      hold = true;
      continue;
    }
    // Asked already and not answered: wait, but not for ever.
    if (now - asked < RECHECK_WAIT_MINUTES * 60_000) hold = true;
  }
  return { request, hold };
}

// ---- 3. Late in a sign-in that usually ends soon ------------------------------

/**
 * How long a sign-in usually lasts, in days, where we have seen it end often
 * enough to say: Rentals.ca 2 to 3 days (KI1743), Zumper about 15 (S769).
 * Kijiji has held for months, so it is never "due soon".
 */
export const USUAL_SIGNIN_DAYS: Readonly<Record<string, number>> = { rentals_ca: 2.5, zumper: 15 };

/**
 * A long sign-in (a week or more) is worth renewing in the same sitting once
 * 70% used: it buys days. A short one is only named once it is past its usual
 * life, when it has probably ended and nobody has looked yet.
 */
export function signinDueSoon(input: {
  channel: string;
  alive: boolean | null;
  /** When the landlord last signed in (distribution_channel_sessions.last_validated_at). */
  signedInAt: string | null;
  nowISO: string;
}): { soon: boolean; ageDays: number | null; usualDays: number | null } {
  const usual = USUAL_SIGNIN_DAYS[input.channel] ?? null;
  const at = input.signedInAt ? Date.parse(input.signedInAt) : NaN;
  const now = Date.parse(input.nowISO);
  if (usual == null || input.alive !== true || !Number.isFinite(at) || !Number.isFinite(now)) {
    return { soon: false, ageDays: null, usualDays: usual };
  }
  const ageDays = (now - at) / DAY_MS;
  const threshold = usual >= 7 ? usual * 0.7 : usual;
  return { soon: ageDays >= threshold, ageDays, usualDays: usual };
}

/** "Zumper still works, but it is 12 days into a sign-in that usually lasts about 15." Past its usual life it reads "has probably signed out by now". */
export function dueSoonLine(siteLabel: string, ageDays: number, usualDays: number): string {
  const age = Math.max(1, Math.round(ageDays));
  const usual = Math.round(usualDays);
  const days = `${age} ${age === 1 ? "day" : "days"}`;
  if (ageDays >= usualDays) {
    return `${siteLabel} has probably signed out by now: it is ${days} since you signed in, and it usually lasts about ${usual}.`;
  }
  return `${siteLabel} still works, but it is ${days} into a sign-in that usually lasts about ${usual}.`;
}
