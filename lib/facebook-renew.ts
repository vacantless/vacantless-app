// S775 (Noam, 2026-11-09 19:26): the yellow bar on Rentals asked him to renew a
// Marketplace ad while Facebook's own menu showed Renew greyed, "Renew (7 days)".
// Facebook runs its own Renew clock: read live, Pillette 3 (listed 11/8) said 7
// days on 11/9, while Assumption 9 and Unit 33 said 5 and 6 days at 11 and 8
// days old (S765). No fixed age fits. Vacantless cannot see that clock: the
// helper reads it only inside Facebook and sends back the renewals it saw
// pressed, not the countdown. So no Vacantless surface says a Marketplace ad
// can be renewed now. It says the ad's age and points to the ad's ... menu,
// where Facebook shows Renew or the days left. One source for every surface:
// the Rentals row and banner, Keep it fresh, the Get online row, the Today
// button and the old-ads email.
// If a later helper sends the countdown, this file is where it plugs in.

/** The button that opens the landlord's Marketplace ads. */
export const FACEBOOK_RENEW_CHECK = "Check Renew on Marketplace";

/** Where Renew lives and who decides. No claim that it is open. */
export const FACEBOOK_RENEW_HOW = "Open your Marketplace ads. If Facebook shows Renew, press it.";

/** S806 (REVIEW-S805 finding 5): the one chip a rental row carries for Marketplace. */
export const FACEBOOK_RENEW_CHIP = "Marketplace: check renew";

/** "Marketplace ad is 12 days old, Renew may be open". */
export function facebookRenewLine(days: number | null): string {
  if (days == null) return "Marketplace ad: Renew may be open";
  return `Marketplace ad is ${days} ${days === 1 ? "day" : "days"} old, Renew may be open`;
}

/** "1 ad to renew", "2 Marketplace ads to check", joined with " · ". */
export function oldAdsCount(renew: number, marketplace: number): string {
  const parts: string[] = [];
  if (renew > 0) parts.push(renew === 1 ? "1 ad to renew" : `${renew} ads to renew`);
  if (marketplace > 0) parts.push(marketplace === 1 ? "1 Marketplace ad to check" : `${marketplace} Marketplace ads to check`);
  return parts.join(" · ");
}

/** Facebook's Your listings page: Renew is in each ad's "..." menu. Works on a computer. */
export const FACEBOOK_YOUR_LISTINGS = "https://www.facebook.com/marketplace/you/selling";

/**
 * S805: where "Check Renew on Marketplace" goes. On a phone, Your listings
 * opens the Facebook app's Marketplace search ("No results found"), so a phone
 * gets the ad itself, which opens in the Facebook app. Only a facebook.com
 * Marketplace item link is used; anything else on a phone gives null.
 */
export function facebookRenewHref(adUrl: string | null | undefined, onPhone: boolean): string | null {
  if (!onPhone) return FACEBOOK_YOUR_LISTINGS;
  const url = (adUrl ?? "").trim();
  return /^https:\/\/(www\.|m\.)?facebook\.com\/marketplace\/item\/\d+/i.test(url) ? url : null;
}
