// ============================================================================
// renter-emails (S806, REVIEW-S805 finding 7). Renters who write on Kijiji,
// Rentals.ca or Zumper reach Vacantless only when the landlord forwards those
// sites' emails to the account's own address. Before S806 that step lived at
// the bottom of a second sites page that no setup step pointed at, so a new
// landlord could connect every site, go live, and never see one renter from
// them. It is now step 2 of "Connect your rental sites", a getting-started
// step, and a card on Today when a site has a live ad and no renter email has
// ever come in from it. Pure: no I/O.
// ============================================================================

import { PORTAL_INBOX_LABEL, type PortalInboxEvent } from "./portal-inbox";
import type { PortalKey } from "./portal-senders";

/** The one sites page; the renter-email step sits under the site rows. */
export const RENTER_EMAILS_ANCHOR = "renter-emails";
export const RENTER_EMAILS_HREF = `/dashboard/sites#${RENTER_EMAILS_ANCHOR}`;

/** Outcomes that prove a site's emails reach us (a held scam still came through the rule). */
const ARRIVED = new Set(["lead_created", "duplicate", "scam_held"]);

/** Sites whose renter emails have reached Vacantless at least once. */
export function sitesWithRenterEmails(events: readonly Pick<PortalInboxEvent, "source" | "outcome">[]): Set<string> {
  const out = new Set<string>();
  for (const e of events) if (ARRIVED.has(String(e.outcome))) out.add(String(e.source));
  return out;
}

/** True once any site's renter email has reached Vacantless. */
export function hasRenterEmails(events: readonly Pick<PortalInboxEvent, "source" | "outcome">[]): boolean {
  return sitesWithRenterEmails(events).size > 0;
}

export type RenterEmailNotice = {
  key: string;
  title: string;
  line: string;
  action: { label: string; href: string };
};

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * One Today card when a site has a live ad and not one renter email has ever
 * come in from it. Only sites the ingest reads (enabledSites). Quiet once any
 * email from that site has arrived: after that a missing renter is just a
 * quiet week, not a setup gap.
 */
export function renterEmailNotices(input: {
  /** Sites (kijiji, rentals_ca, zumper) with at least one live ad on this account. */
  liveSites: readonly string[];
  /** Sites the ingest reads today (lib/portal-inbox portalInboxSites keys). */
  enabledSites: readonly PortalKey[];
  events: readonly Pick<PortalInboxEvent, "source" | "outcome">[];
}): RenterEmailNotice[] {
  const arrived = sitesWithRenterEmails(input.events);
  const live = new Set(input.liveSites);
  const missing = input.enabledSites.filter((k) => live.has(k) && !arrived.has(k));
  if (missing.length === 0) return [];
  const names = joinNames(missing.map((k) => PORTAL_INBOX_LABEL[k]));
  return [
    {
      key: "renter-emails",
      title: `Renters who write on ${names} are not reaching you yet.`,
      line: `Your ad is up, but no renter email from ${names} has come in. Send those emails to your Vacantless address once, about 3 minutes.`,
      action: { label: "Set it up", href: RENTER_EMAILS_HREF },
    },
  ];
}
