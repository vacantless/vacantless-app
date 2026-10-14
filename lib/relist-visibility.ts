// ============================================================================
// relist-visibility (S714d). When the rental page shows "Relist / refresh
// this ad" as its main button.
//
// Found on S714's new-landlord run: a rental made live seconds earlier showed
// "Relist / refresh this ad" as its main button. Refreshing is for a leased
// rental coming back, or an ad that has been up a while. A live rental younger
// than RELIST_MIN_DAYS hides it. An unknown start date (older rentals made live
// before available_since was stamped) counts as old, so nothing is lost.
// ============================================================================

export const RELIST_MIN_DAYS = 7;

export function showRelistButton(input: {
  enabled: boolean;
  leased: boolean;
  bookable: boolean;
  missingRequired: number;
  availableSince: string | null | undefined;
  now?: Date;
}): boolean {
  if (!input.enabled) return false;
  if (input.leased) return true;
  if (!input.bookable || input.missingRequired > 0) return false;
  const since = input.availableSince ? Date.parse(input.availableSince) : NaN;
  if (!Number.isFinite(since)) return true;
  const now = (input.now ?? new Date()).getTime();
  return now - since >= RELIST_MIN_DAYS * 24 * 60 * 60 * 1000;
}
