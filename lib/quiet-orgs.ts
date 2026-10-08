import { NON_PRODUCTION_ORGANIZATION_IDS } from "./channel-provenness";

// S700g: Noam's own test and demo orgs send him a daily pile of operator emails
// (leasing snapshot, listing health, "a Kijiji post is prepared"). Every member
// of these orgs is one of Noam's own addresses [verified 2026-10-07 via SQL].
// sendOrgNotification skips every org listed here. Remove an id to hear from
// that org again. Never list a real customer org.
export const QUIET_NOTIFICATION_ORGANIZATION_IDS: readonly string[] = [
  ...NON_PRODUCTION_ORGANIZATION_IDS,
  "b2cb4eab-9a29-4972-8fca-564dc8ca6a61", // Abbas Husain (demo org, Noam's logins only)
  "9315e41e-1c03-43e3-9c8f-78563512f302", // Davis Muscovitch Rentals (Noam's login only)
];

const QUIET = new Set(QUIET_NOTIFICATION_ORGANIZATION_IDS);

export function isQuietNotificationOrg(orgId: string | null | undefined): boolean {
  return !!orgId && QUIET.has(orgId);
}
