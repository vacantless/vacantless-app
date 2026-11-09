// S772: the Rentals list as one row per rental. Pure. Before this the page
// opened with two panels (missing sites, ads to renew) that filled the first
// screen and repeated rentals the list showed again below; each row then said
// its state three or four ways. This module decides, per rental: its site
// lights, its old ads, its place in the list, and the counts at the top.

import { COVERAGE_LABELS, coverageLabel, type CoverageRow } from "./posting-coverage";
import { listingPostLiveCheckTarget } from "./listing-post-live-check";

export type SiteLight = {
  key: string;
  label: string;
  live: boolean;
  /** The saved ad link when live; null when there is none to open. */
  url: string | null;
};

export type RowRenew = { portal: string; label: string; days: number | null };

const SITE_ORDER = Object.keys(COVERAGE_LABELS);

function siteIndex(key: string): number {
  const i = SITE_ORDER.indexOf(key);
  return i === -1 ? SITE_ORDER.length : i;
}

/**
 * S773: the link a site light opens is the ad a renter sees. Zumper rows save
 * the owner's manage link (zumper.com/manage/properties/listing/<id>), which
 * asks for a Zumper sign-in, so a teammate or a second device hit a wall. The
 * public page is derived here; the saved link is never rewritten.
 */
export function publicAdUrl(portal: string, url: string): string {
  if (portal !== "zumper") return url;
  return listingPostLiveCheckTarget("zumper", url)?.url ?? url;
}

/**
 * One light per site the rental is on or could be on today, in site order.
 * A site the rental is live on stays lit even when the account no longer
 * offers it (the ad is still up).
 */
export function siteLights(row: Pick<CoverageRow, "live" | "missing">, adUrls: Map<string, string>): SiteLight[] {
  const keys = Array.from(new Set([...row.live, ...row.missing])).sort((a, b) => siteIndex(a) - siteIndex(b));
  const live = new Set(row.live);
  return keys.map((key) => ({
    key,
    label: coverageLabel(key),
    live: live.has(key),
    url: live.has(key) ? siteLightUrl(key, adUrls.get(key)) : null,
  }));
}

function siteLightUrl(key: string, url: string | undefined): string | null {
  return url ? publicAdUrl(key, url) : null;
}

/** "Post to Kijiji", "Post to Kijiji and Zumper", "Post to 3 sites". */
export function postMissingLabel(missingRobot: string[]): string {
  const names = missingRobot.map(coverageLabel);
  if (names.length === 0) return "";
  if (names.length === 1) return `Post to ${names[0]}`;
  if (names.length === 2) return `Post to ${names[0]} and ${names[1]}`;
  return `Post to ${names.length} sites`;
}

/** "Kijiji ad is 28 days old", "Marketplace ad needs a renew". */
export function renewLine(item: RowRenew): string {
  const name = coverageLabel(item.portal) || item.label;
  return item.days != null ? `${name} ad is ${item.days} days old` : `${name} ad needs a renew`;
}

/**
 * List order: rentals taking inquiries first, then ones still being set up,
 * then paused, off market, and rented last. Ties keep the incoming order
 * (newest first from the query).
 */
export function listRank(status: string, bookable: boolean): number {
  if (status === "leased") return 4;
  if (status === "off_market") return 3;
  if (bookable) return 0;
  if (status === "paused") return 2;
  return 1;
}

export function sortForList<T>(rows: T[], rank: (row: T) => number): T[] {
  return rows
    .map((row, i) => ({ row, i, r: rank(row) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.row);
}

export type ListHeadline = {
  live: number;
  rented: number;
  inquiries: number;
  /** Rentals with a missing site, an old ad, or a detail to fix. */
  needYou: number;
};

export function listHeadline(
  rows: { status: string; bookable: boolean; inquiries: number; needsYou: boolean }[],
): ListHeadline {
  return {
    live: rows.filter((r) => r.bookable && r.status !== "leased").length,
    rented: rows.filter((r) => r.status === "leased").length,
    inquiries: rows.reduce((sum, r) => sum + (r.inquiries || 0), 0),
    needYou: rows.filter((r) => r.needsYou).length,
  };
}

/** "4 rentals are missing a site", "3 ads to renew", joined with " · ". */
export function todoSummary(gaps: number, renew: number): string {
  const parts: string[] = [];
  if (gaps > 0) parts.push(gaps === 1 ? "1 rental is missing a site" : `${gaps} rentals are missing a site`);
  if (renew > 0) parts.push(renew === 1 ? "1 ad to renew" : `${renew} ads to renew`);
  return parts.join(" · ");
}
