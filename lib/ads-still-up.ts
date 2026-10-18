// ads-still-up.ts (S723). Ads that still show a rental that is no longer available.
//
// Telling a realtor "your ads come down when it rents" was not true: archiving
// or marking a rental leased never touched its outside ads (project memory
// "archive leaves the ad live"). Most of those ads sit on the landlord's own
// Kijiji, Zumper, Rentals.ca or Facebook account, and we cannot delete them
// for the landlord. So when a rental leaves the market and an ad we know about
// is still live, we email the landlord each site with its link, and the
// rental's page shows the same list with an "I took it down" button. The
// listing-post live check (S693) also marks Kijiji, Zumper and Rentals.ca ads
// removed on its own once they disappear from the site.
//
// Deliberately NOT done here (FINDINGS-S675): no automatic delete, no change to
// the leased ladder, no listing_posts status written by automation.

export const UNAVAILABLE_STATUSES = ["leased", "off_market", "paused"] as const;

export function isUnavailableStatus(status: string | null | undefined): boolean {
  return (UNAVAILABLE_STATUSES as readonly string[]).includes(String(status ?? ""));
}

export type StillUpPost = {
  id: string;
  portal: string;
  url: string | null;
  status: string | null;
  label?: string | null;
};

const SITE_NAMES: Record<string, string> = {
  kijiji: "Kijiji",
  zumper: "Zumper",
  rentals_ca: "Rentals.ca",
  facebook: "Facebook Marketplace",
  facebook_feed: "Facebook Page",
  instagram: "Instagram",
  viewit: "Viewit",
  rentfaster: "RentFaster",
  realtor_ca: "Realtor.ca",
  craigslist: "Craigslist",
  padmapper: "PadMapper",
  linkedin: "LinkedIn",
};

export function siteName(portal: string | null | undefined): string {
  const k = String(portal ?? "");
  return SITE_NAMES[k] ?? (k ? k.replace(/_/g, " ") : "Another site");
}

/** Live ads with a link. Drafts, expired and removed rows are not "still up". */
export function adsStillUp<T extends StillUpPost>(posts: readonly T[] | null | undefined): T[] {
  return (posts ?? []).filter((p) => p.status === "live" && !!p.url?.trim());
}

export function statusPhrase(status: string | null | undefined, archived: boolean): string {
  if (status === "leased") return "is leased";
  if (status === "paused") return "is paused";
  if (status === "off_market" || archived) return "is off the market";
  return "is no longer available";
}

const KIJIJI_PAID_NOTE =
  "Paid for the Kijiji ad? You can leave it up until it ends. Renters who reply can see your other rentals.";

/** The list that goes in the email, one site per line. */
export function adsListText(posts: readonly StillUpPost[]): string {
  const lines = posts.map((p) => `- ${siteName(p.portal)}: ${p.url?.trim() ?? ""}`);
  if (posts.some((p) => p.portal === "kijiji")) lines.push("", KIJIJI_PAID_NOTE);
  return lines.join("\n");
}

export function stillUpNoticeVars(input: {
  orgName: string | null | undefined;
  address: string | null | undefined;
  status: string | null | undefined;
  archived: boolean;
  posts: readonly StillUpPost[];
  dashboardUrl: string;
}): Record<string, string> {
  const n = input.posts.length;
  return {
    org_name: input.orgName ?? "",
    property_address: input.address ?? "this rental",
    status_phrase: statusPhrase(input.status, input.archived),
    ad_count: n === 1 ? "1 ad" : `${n} ads`,
    ads_list: adsListText(input.posts),
    dashboard_url: input.dashboardUrl,
  };
}

/** Note added to a listing_posts row when the landlord says they took it down. */
export function takenDownNote(prior: string | null | undefined, byEmail: string | null | undefined, now: Date): string {
  const line = `Taken down by ${byEmail || "the landlord"} on ${now.toISOString().slice(0, 10)} (marked in Vacantless).`;
  return prior?.trim() ? `${prior.trim()}\n${line}` : line;
}

// S723: a free Rentals.ca account shows 3 ads at a time; a 4th posts but stays
// hidden with no message (project memory S686). Warn before approving.
export const RENTALS_CA_FREE_LIVE_CAP = 3;

export function rentalsCaCapNote(liveElsewhere: number): string | null {
  if (liveElsewhere < RENTALS_CA_FREE_LIVE_CAP) return null;
  return `You already have ${liveElsewhere} ads live on Rentals.ca. A free Rentals.ca account shows only 3 at a time, so this one would stay hidden. Take one down first, or move to a paid plan on Rentals.ca.`;
}
