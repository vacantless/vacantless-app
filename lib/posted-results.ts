// S734: what the landlord sees right after "Post everywhere" or "Set Live".
// Before S734 it was one green line ("Your rental is now Live. Share this
// link") that never named the sites, not even the Facebook Page post the
// same click had just made. This is the pure half: which sites are live,
// what the landlord can still add, in the order a landlord reads them.
import { siteName } from "@/lib/ads-still-up";

export type PostedResultsPost = {
  portal: string | null;
  status: string | null;
  url: string | null;
};

export type PostedResultsSite = { key: string; label: string; url: string };

export type PostedResultsNext = {
  key: "marketplace" | "facebook_page" | "posting";
  title: string;
  body: string;
  href: string;
  action: string;
};

const SITE_ORDER = ["facebook_feed", "instagram", "facebook", "kijiji", "rentals_ca", "zumper"];

/** The sites with a live ad link, one per site, in reading order. */
export function postedResultsSites(posts: readonly PostedResultsPost[]): PostedResultsSite[] {
  const seen = new Set<string>();
  const out: PostedResultsSite[] = [];
  for (const p of posts) {
    const key = String(p.portal ?? "");
    const url = (p.url ?? "").trim();
    if (!key || p.status !== "live" || !url || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: siteName(key), url });
  }
  const rank = (k: string) => {
    const i = SITE_ORDER.indexOf(k);
    return i === -1 ? SITE_ORDER.length : i;
  };
  return out.sort((a, b) => rank(a.key) - rank(b.key));
}

/** "Live on 3 sites" counts the Vacantless page as one. */
export function postedResultsHeadline(liveSiteCount: number): string {
  const n = liveSiteCount + 1;
  return n === 1 ? "Your rental page is live" : `Live on ${n} sites`;
}

/**
 * What the landlord can still add, biggest free win first. Marketplace is
 * where most renters come from, so it leads whenever it is not live yet.
 */
export function postedResultsNextSteps(args: {
  propertyId: string;
  liveKeys: readonly string[];
  facebookPageConnected: boolean;
  robotPostingAllowed: boolean;
  marketplaceKitAvailable: boolean;
}): PostedResultsNext[] {
  const live = new Set(args.liveKeys);
  const sitesHref = `/dashboard/properties/${encodeURIComponent(args.propertyId)}?tab=distribute#distribute-header`;
  const out: PostedResultsNext[] = [];
  if (args.marketplaceKitAvailable && !live.has("facebook")) {
    out.push({
      key: "marketplace",
      title: "Facebook Marketplace, free",
      body: "Most renters look here first. Copy the ad we wrote, add the photos, post it from your own Facebook. About five minutes.",
      href: `${sitesHref.replace("#distribute-header", "")}#for-you-facebook`,
      action: "Open the Marketplace kit",
    });
  }
  if (!args.facebookPageConnected && !live.has("facebook_feed")) {
    out.push({
      key: "facebook_page",
      title: "Your Facebook Page, free",
      body: "Connect your business Page once. We post each rental there with its booking link. Then again every week while it is open.",
      href: "/dashboard/settings?tab=distribution#facebook-page",
      action: "Connect the Page",
    });
  }
  const robotLive = ["kijiji", "rentals_ca", "zumper"].filter((k) => live.has(k)).length;
  if (!args.robotPostingAllowed && robotLive === 0) {
    out.push({
      key: "posting",
      title: "Kijiji, Rentals.ca and Zumper, posted for you",
      body: "Sign in to each site once, about three minutes. We post every ad for you. You approve each one. Renters from those sites land in the same list.",
      href: "/dashboard/billing#posting-addon",
      action: "See the Posting add-on",
    });
  }
  return out;
}
