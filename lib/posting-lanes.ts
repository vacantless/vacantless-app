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

export const MARKETPLACE_ORG_IDS: readonly string[] = [
  "921f7c08-98af-428f-a238-36f4a781b0de", // Agile Real Estate Group
];

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
