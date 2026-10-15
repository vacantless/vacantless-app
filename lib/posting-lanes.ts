// S702v (2026-10-10, Noam): which sites our posting robot handles, and which
// need a person.
//
// Kijiji, Rentals.ca and Zumper are posted by our own browser on the
// landlord's account. That costs us almost nothing, so asking us to post them
// never uses the monthly done-for-you allowance.
//
// Facebook Marketplace has no API and must be posted from a personal profile.
// S712 (Noam, 2026-10-13): every org sees it. The org's own team posts it (the
// landlord or one of their showing agents) from the Marketplace kit: ad text,
// photos, the booking link, and a box to paste the ad link back. A robot-run
// Vacantless profile was ruled out (Facebook bans it, taking every org's ads).

export const ROBOT_POSTED_CHANNELS = ["kijiji", "rentals_ca", "zumper"] as const;

export function isRobotPostedChannel(channel: unknown): boolean {
  return (ROBOT_POSTED_CHANNELS as readonly string[]).includes(String(channel ?? ""));
}

/**
 * S719: what the landlord does next when the robot has built an ad and
 * stopped. On a robot site the landlord never submits the ad or pastes a link:
 * they approve (or sign in once) on the rental's page and the robot posts it.
 * Returns null for a person-posted site (the caller keeps its own wording).
 */
export function robotNextStep(
  gate: string,
  channel: unknown,
  siteLabel: string,
): string | null {
  if (!isRobotPostedChannel(channel)) return null;
  if (gate === "needs_operator") {
    return `click "Approve and post" on the rental's page. We then post it on your ${siteLabel} account for you`;
  }
  if (gate === "needs_payment") {
    return `open the rental's page and finish the ${siteLabel} payment step there. We never enter card details for you`;
  }
  if (gate === "needs_login") {
    return `sign in once to ${siteLabel} from the rental's page. Then we post it for you`;
  }
  return null;
}

/** Only a person-posted site uses the monthly done-for-you allowance. */
export function usesDeskAllowance(channel: unknown): boolean {
  return !isRobotPostedChannel(channel);
}

export const MARKETPLACE_CHANNEL_KEY = "facebook";

const AGILE_ORG_ID = "921f7c08-98af-428f-a238-36f4a781b0de"; // Agile Real Estate Group

/** S712: Marketplace shows for every org; kept for callers and tests. */
export const MARKETPLACE_ORG_IDS: readonly string[] = [AGILE_ORG_ID];

// S704 (2026-10-11, Noam): Rentals.ca blocks our GitHub robot (Cloudflare, in
// every setup we probed), so it was Agile only. S717 (2026-10-14): Rentals.ca
// now runs on the home runner (a computer with a home connection, which its
// Cloudflare lets through): posting (worker post-home.yml) and "Sign in once"
// (signin-window-home.yml, proven by Agile's sign-in that day). So every org
// sees Rentals.ca, like Kijiji and Zumper.
export const RENTALS_CA_CHANNEL_KEY = "rentals_ca";

// S710 (Noam took the audit's recommendation): Realtor.ca is an MLS listing
// that only a Royal LePage agent can place, as a full-service listing under a
// signed representation agreement. It is not a site we post to, so it leaves
// the site list for every org. It comes back later as a separate brokerage
// request, not a posting tile.
export const REALTOR_CA_CHANNEL_KEY = "realtor_ca";

export const REALTOR_CA_ORG_IDS: readonly string[] = [];

/** Sites shown only to the orgs listed against them. Every other site shows for everyone. */
const ORG_ONLY_CHANNELS: Readonly<Record<string, readonly string[]>> = {
  [REALTOR_CA_CHANNEL_KEY]: REALTOR_CA_ORG_IDS,
};

export function channelShownFor(channel: unknown, orgId: string | null | undefined): boolean {
  const allowed = ORG_ONLY_CHANNELS[String(channel ?? "")];
  if (!allowed) return true;
  return orgId != null && allowed.includes(orgId);
}

export function isHiddenForOrg(channel: unknown, orgId: string | null | undefined): boolean {
  return !channelShownFor(channel, orgId);
}

/**
 * Narrow a "shown channels" list so org-only sites (Marketplace, Rentals.ca)
 * drop out for orgs not listed against them. `keys` null means "show
 * everything"; it stays null only when nothing is hidden for this org.
 */
export function withoutHiddenChannels(
  keys: readonly string[] | null,
  allKeys: readonly string[],
  orgId: string | null | undefined,
): readonly string[] | null {
  const hidesAny = Object.keys(ORG_ONLY_CHANNELS).some((k) => isHiddenForOrg(k, orgId));
  if (!hidesAny) return keys;
  return (keys ?? allKeys).filter((k) => !isHiddenForOrg(k, orgId));
}

export function marketplaceShownFor(orgId: string | null | undefined): boolean {
  // S712: every org (the org's own team posts it).
  return orgId != null && orgId !== "";
}

export function isHiddenMarketplace(
  channel: unknown,
  orgId: string | null | undefined,
): boolean {
  return String(channel ?? "") === MARKETPLACE_CHANNEL_KEY && !marketplaceShownFor(orgId);
}

/**
 * Narrow a "shown channels" list so Marketplace drops out for orgs that do not
 * post it by hand. `keys` null means "show everything", so start from allKeys.
 */
export function withoutHiddenMarketplace(
  keys: readonly string[] | null,
  allKeys: readonly string[],
  orgId: string | null | undefined,
): readonly string[] | null {
  if (marketplaceShownFor(orgId)) return keys;
  return (keys ?? allKeys).filter((k) => k !== MARKETPLACE_CHANNEL_KEY);
}
