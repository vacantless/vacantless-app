// S702v (2026-10-10, Noam): which sites our posting robot handles, and which
// need a person.
//
// Kijiji, Rentals.ca and Zumper are posted by our own browser on the
// landlord's account. That costs us almost nothing, so asking us to post them
// never uses the monthly done-for-you allowance.
//
// Facebook Marketplace has no API and must be posted from a personal profile.
// Until a Vacantless leasing profile exists (Noam's call, 2026-10-10), only
// orgs whose Marketplace ads are already posted by hand see it at all.

export const ROBOT_POSTED_CHANNELS = ["kijiji", "rentals_ca", "zumper"] as const;

export function isRobotPostedChannel(channel: unknown): boolean {
  return (ROBOT_POSTED_CHANNELS as readonly string[]).includes(String(channel ?? ""));
}

/** Only a person-posted site uses the monthly done-for-you allowance. */
export function usesDeskAllowance(channel: unknown): boolean {
  return !isRobotPostedChannel(channel);
}

export const MARKETPLACE_CHANNEL_KEY = "facebook";

const AGILE_ORG_ID = "921f7c08-98af-428f-a238-36f4a781b0de"; // Agile Real Estate Group

export const MARKETPLACE_ORG_IDS: readonly string[] = [AGILE_ORG_ID];

// S704 (2026-10-11, Noam): Rentals.ca blocks our GitHub robot (Cloudflare, in
// every setup we probed), so we cannot post it for a new landlord. Agile's
// Rentals.ca ads run from Noam's Mac, so only Agile sees the site. No other
// org should be shown "We post it" for a site we cannot post.
export const RENTALS_CA_CHANNEL_KEY = "rentals_ca";

export const RENTALS_CA_ORG_IDS: readonly string[] = [AGILE_ORG_ID];

/** Sites shown only to the orgs listed against them. Every other site shows for everyone. */
const ORG_ONLY_CHANNELS: Readonly<Record<string, readonly string[]>> = {
  [MARKETPLACE_CHANNEL_KEY]: MARKETPLACE_ORG_IDS,
  [RENTALS_CA_CHANNEL_KEY]: RENTALS_CA_ORG_IDS,
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
  return orgId != null && MARKETPLACE_ORG_IDS.includes(orgId);
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
