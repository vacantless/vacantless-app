// S836d: units still marked for rent whose ads are all down. Noam 2026-11-23:
// "do we have a record of what listings were once up but now are not which
// would mean rented ... is there another smarter way ... perhaps it may have
// expired or suspended or terminated". For each such unit, say why its ads
// came down (from what our own records already hold) and whether anything
// shows it rented. It only suggests: marking it Rented stays one click by the
// landlord, because a wrong guess would throw off the vacancy rate and books.
// Pure and tested in scripts/test-s836d-ads-down.ts.

export type AdPost = {
  portal: string | null;
  status: string | null;
  notes: string | null;
  /** When the ad went from live to down (0330); null for ads that came down before it existed. */
  downAt: string | null;
};

export type RentedEvidence = {
  /** A tenancy for this unit, and its start date. */
  tenancyStart?: string | null;
  hasTenancy?: boolean;
  offerAcceptedAt?: string | null;
  leaseSignedAt?: string | null;
  applicationSubmittedAt?: string | null;
  /** A renter for this unit at Applied or Leased. */
  renterAtApplied?: boolean;
  renterLeased?: boolean;
};

export type DownReason = "you_took_down" | "site_removed" | "expired" | "unknown";

export type AdsDownUnit = {
  propertyId: string;
  address: string;
  /** "probably_rented" when something shows it rented; else why the ads are down. */
  verdict: "probably_rented" | "ads_expired" | "taken_down" | "unknown";
  /** One plain line, for the list. */
  line: string;
  /** The last day an ad came down, when known. */
  lastDownDay: string | null;
  /** Per ad: the site and why it came down. */
  ads: { portal: string; reason: DownReason }[];
};

const DOWN = new Set(["removed", "expired"]);

/** Why one ad came down, from its status and the notes our code writes. Pure. */
export function downReason(p: AdPost): DownReason {
  const n = p.notes ?? "";
  if (/Taken down by /.test(n)) return "you_took_down";
  if (/live-check [^\n]*REMOVED|removed this ad|adRemoved=|no longer exists|flipped live -> expired/i.test(n)) {
    return p.status === "expired" ? "expired" : "site_removed";
  }
  if (p.status === "expired") return "expired";
  return "unknown";
}

function day(iso: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso ?? "");
  return m ? m[1] : null;
}
function nice(d: string): string {
  const [y, m, dd] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd)).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** The strongest sign it rented, as a short phrase, or null. Strongest first. Pure. */
export function rentedSign(e: RentedEvidence): string | null {
  if (e.hasTenancy) return e.tenancyStart ? `a tenancy starts ${nice(day(e.tenancyStart) as string)}` : "a tenancy is set up";
  if (e.leaseSignedAt) return `lease signed ${nice(day(e.leaseSignedAt) as string)}`;
  if (e.offerAcceptedAt) return `offer accepted ${nice(day(e.offerAcceptedAt) as string)}`;
  if (e.renterLeased) return "a renter is marked Leased";
  if (e.applicationSubmittedAt) return `an application came in ${nice(day(e.applicationSubmittedAt) as string)}`;
  if (e.renterAtApplied) return "a renter is at Applied";
  return null;
}

const SITE: Record<string, string> = {
  kijiji: "Kijiji",
  facebook: "Facebook Marketplace",
  facebook_feed: "Facebook Page",
  zumper: "Zumper",
  rentals_ca: "Rentals.ca",
  padmapper: "PadMapper",
  viewit: "Viewit.ca",
  rentfaster: "RentFaster",
};
function siteName(p: string | null): string {
  return (p && SITE[p]) || (p ? p.charAt(0).toUpperCase() + p.slice(1) : "A site");
}
function words(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * One unit: still marked for rent, had at least one ad, none live now.
 * Returns null when it does not qualify (an ad is live, or it never had one).
 */
export function adsDownUnit(
  u: { propertyId: string; address: string; status: string | null },
  posts: readonly AdPost[],
  evidence: RentedEvidence,
): AdsDownUnit | null {
  if ((u.status ?? "").toLowerCase() !== "available") return null;
  if (posts.some((p) => p.status === "live")) return null;
  const down = posts.filter((p) => DOWN.has(p.status ?? ""));
  if (down.length === 0) return null;

  const ads = down.map((p) => ({ portal: p.portal ?? "", reason: downReason(p) }));
  const days = down.map((p) => day(p.downAt)).filter((d): d is string => !!d).sort();
  const lastDownDay = days.length ? days[days.length - 1] : null;
  const when = lastDownDay ? ` Last ad down ${nice(lastDownDay)}.` : "";

  const sign = rentedSign(evidence);
  if (sign) {
    return { propertyId: u.propertyId, address: u.address, verdict: "probably_rented", line: `Probably rented: ${sign}. Mark it rented?${when}`, lastDownDay, ads };
  }
  const by = (r: DownReason) => [...new Set(ads.filter((a) => a.reason === r).map((a) => siteName(a.portal)))];
  const expired = [...by("expired"), ...by("site_removed")];
  const took = by("you_took_down");
  if (expired.length && !took.length) {
    const verb = by("site_removed").length && !by("expired").length ? "removed by" : "expired on";
    return { propertyId: u.propertyId, address: u.address, verdict: "ads_expired", line: `Ads ${verb} ${words(expired)}, still marked for rent. Repost it, or mark it rented.${when}`, lastDownDay, ads };
  }
  if (took.length) {
    return { propertyId: u.propertyId, address: u.address, verdict: "taken_down", line: `Ads taken down (${words(took)}), still marked for rent. Rented? Mark it.${when}`, lastDownDay, ads };
  }
  return { propertyId: u.propertyId, address: u.address, verdict: "unknown", line: `Ads down, reason not recorded, still marked for rent. Rented? Mark it.${when}`, lastDownDay, ads };
}
