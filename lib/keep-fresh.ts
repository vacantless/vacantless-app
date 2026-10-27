// S739: the "Keep it fresh" card on a rental's Get online tab (review item 10).
// One line per live ad saying how it stays near the top, and a Renew button
// only where the landlord has something to press. Pure; the card renders it.
//
// The windows match lib/distribution-channels CHANNEL_REFRESH_DAYS and what was
// read live: Facebook Marketplace offers Renew about 9 days after the last
// renewal (S737); a paid Kijiji Lite ad runs 31 days; a free Rentals.ca ad
// ends after 21 days, and the robot renews it in place 3 days before (S739);
// Zumper free ads stay up.

export type KeepFreshInput = {
  key: string;
  label: string;
  /** distribution-channels status value: posted, needs_refresh, ... */
  status: string;
  lastPostedOn: string | null;
  liveUrl: string | null;
};

export type KeepFreshRow = {
  key: string;
  label: string;
  line: string;
  /** true: show Renew on <site> and "I already renewed it". */
  renew: boolean;
};

const FACEBOOK_RENEW_DAYS = 9;
const KIJIJI_AD_DAYS = 31;
const RENTALS_FREE_DAYS = 21;
const RENTALS_ROBOT_RENEW_DAYS = 18;

function addDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
function daysFrom(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-12" -> "Nov 12". */
export function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${MONTHS[(m || 1) - 1]} ${d}`;
}
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
const isYmd = (v: string | null): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One row per live ad, in the order given. Ads with no live link are left out. */
export function keepFreshRows(
  cards: KeepFreshInput[],
  opts: { today: string; rentalsRobotRenews: boolean },
): KeepFreshRow[] {
  const rows: KeepFreshRow[] = [];
  for (const c of cards) {
    if (!c.liveUrl || (c.status !== "posted" && c.status !== "needs_refresh")) continue;
    const posted = isYmd(c.lastPostedOn) ? c.lastPostedOn : null;
    const age = posted ? daysFrom(posted, opts.today) : null;
    const stale = c.status === "needs_refresh";
    let line: string;
    let renew = stale;
    switch (c.key) {
      case "facebook": {
        if (age === null) line = "Renew it on Facebook when it offers Renew.";
        else if (age >= FACEBOOK_RENEW_DAYS || stale) {
          line = "Facebook lets you renew it now. Old ads sink lower.";
          renew = true;
        } else line = `Renew opens in ${plural(FACEBOOK_RENEW_DAYS - age, "day")}.`;
        break;
      }
      case "kijiji": {
        line = posted ? `Ad ends ${shortDate(addDays(posted, KIJIJI_AD_DAYS))}.` : "Paid ad. Renew it on Kijiji before it ends.";
        if (stale) line += " Renew it on Kijiji.";
        break;
      }
      case "rentals_ca": {
        if (opts.rentalsRobotRenews) {
          line = "We renew this free ad for you before it ends.";
          renew = false;
        } else if (posted) {
          line = `Free ad ends ${shortDate(addDays(posted, RENTALS_FREE_DAYS))}.`;
          if (age !== null && age >= RENTALS_ROBOT_RENEW_DAYS) renew = true;
        } else line = "Free ads end after 21 days. Renew it on Rentals.ca.";
        break;
      }
      case "zumper":
        line = "Stays up while the rental is open.";
        renew = false;
        break;
      case "facebook_feed":
        line = age === null ? "Posted on your Page." : `Posted on your Page ${age === 0 ? "today" : `${plural(age, "day")} ago`}.`;
        renew = false;
        break;
      default:
        line = age === null ? "Live." : `Posted ${age === 0 ? "today" : `${plural(age, "day")} ago`}.`;
    }
    rows.push({ key: c.key, label: c.label, line, renew });
  }
  return rows;
}
