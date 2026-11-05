// S754 (review item 1): which sites each available rental is on, and which it
// could be on but is not. Pure. Before this, Agile had four rentals available
// with three sites signed in and alive, and the rentals sat on 1, 2, 2 and 3
// sites; no screen or email said so.
//
// A site is OFFERED to an org when it can be posted today without new setup:
//   - Facebook Marketplace: always (the kit or the helper, every plan);
//   - Kijiji, Rentals.ca, Zumper: the Posting add-on AND a signed-in session;
//   - Facebook Page and Instagram: connected (an alive session row).
// A site the org has not signed in to is not a gap on a rental; it is listed
// once per org as "sign in to add it".

import { isRobotPostedChannel, ROBOT_POSTED_CHANNELS } from "./posting-lanes";

export const MARKETPLACE_KEY = "facebook";
const API_KEYS = ["facebook_feed", "instagram"] as const;

export const COVERAGE_LABELS: Record<string, string> = {
  facebook: "Marketplace",
  kijiji: "Kijiji",
  rentals_ca: "Rentals.ca",
  zumper: "Zumper",
  facebook_feed: "Facebook Page",
  instagram: "Instagram",
};

export function coverageLabel(channel: string): string {
  return COVERAGE_LABELS[channel] ?? channel;
}

export type CoverageProperty = { id: string; address: string | null; status: string | null };
export type CoveragePost = { propertyId: string; portal: string; status: string | null };
export type CoverageSession = { channel: string; alive: boolean | null };

export type CoverageInput = {
  properties: CoverageProperty[];
  posts: CoveragePost[];
  sessions: CoverageSession[];
  /** canUseRobotPosting for the org. */
  postingAddon: boolean;
};

export type CoverageRow = {
  propertyId: string;
  address: string | null;
  live: string[];
  /** Offered sites with no live ad, in site order. */
  missing: string[];
  /** The subset of `missing` the robot posts (Kijiji, Rentals.ca, Zumper). */
  missingRobot: string[];
  offered: number;
};

export type Coverage = {
  rows: CoverageRow[];
  /** Robot sites the org could add by signing in (Posting on, no alive session). */
  signInToAdd: string[];
  /** Rentals with at least one missing site. */
  gaps: number;
};

const SITE_ORDER = [MARKETPLACE_KEY, ...ROBOT_POSTED_CHANNELS, ...API_KEYS] as const;

export function offeredSites(input: Pick<CoverageInput, "sessions" | "postingAddon">): string[] {
  const alive = new Set(input.sessions.filter((s) => s.alive === true).map((s) => s.channel));
  const out: string[] = [MARKETPLACE_KEY];
  if (input.postingAddon) {
    for (const k of ROBOT_POSTED_CHANNELS) if (alive.has(k)) out.push(k);
  }
  for (const k of API_KEYS) if (alive.has(k)) out.push(k);
  return SITE_ORDER.filter((k) => out.includes(k));
}

export function postingCoverage(input: CoverageInput): Coverage {
  const offered = offeredSites(input);
  const alive = new Set(input.sessions.filter((s) => s.alive === true).map((s) => s.channel));
  const signInToAdd = input.postingAddon
    ? ROBOT_POSTED_CHANNELS.filter((k) => !alive.has(k))
    : [];
  const liveByProperty = new Map<string, Set<string>>();
  for (const p of input.posts) {
    if (p.status !== "live") continue;
    const set = liveByProperty.get(p.propertyId) ?? new Set<string>();
    set.add(p.portal);
    liveByProperty.set(p.propertyId, set);
  }
  const rows: CoverageRow[] = [];
  for (const prop of input.properties) {
    if (prop.status !== "available") continue;
    const live = liveByProperty.get(prop.id) ?? new Set<string>();
    const missing = offered.filter((k) => !live.has(k));
    rows.push({
      propertyId: prop.id,
      address: prop.address,
      live: SITE_ORDER.filter((k) => live.has(k)),
      missing,
      missingRobot: missing.filter((k) => isRobotPostedChannel(k)),
      offered: offered.length,
    });
  }
  return { rows, signInToAdd: [...signInToAdd], gaps: rows.filter((r) => r.missing.length > 0).length };
}

/** "Pillette 33 is on 1 of 4 sites. Missing: Kijiji, Rentals.ca, Zumper." */
export function coverageLine(row: CoverageRow, shortAddress: (a: string | null) => string = (a) => a ?? "A rental"): string {
  const names = row.missing.map(coverageLabel).join(", ");
  return `${shortAddress(row.address)} is on ${row.live.length} of ${row.offered} sites. Missing: ${names}.`;
}

/** Health-email lines for one org: one per rental with a gap, capped. */
export function coverageHealthLines(orgName: string, coverage: Coverage, cap = 6): string[] {
  const out: string[] = [];
  for (const row of coverage.rows) {
    if (row.missing.length === 0) continue;
    if (out.length >= cap) {
      out.push(`${orgName}: ${coverage.gaps - cap} more rental${coverage.gaps - cap === 1 ? "" : "s"} with missing sites.`);
      break;
    }
    out.push(`${orgName}: ${coverageLine(row)}`);
  }
  return out;
}

/** "833 Pillette Rd, Unit 33, Windsor, ON N8Y 3B4" -> "833 Pillette Rd, Unit 33". */
export function shortAddress(address: string | null): string {
  if (!address) return "A rental";
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 2) return address;
  return parts.slice(0, parts[1]?.toLowerCase().startsWith("unit") || /^(apt|suite|#)/i.test(parts[1] ?? "") ? 2 : 1).join(", ");
}
