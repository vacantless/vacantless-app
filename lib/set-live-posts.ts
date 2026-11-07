// ============================================================================
// set-live-posts (S761). Set Live posts to the robot sites on its own.
//
// Until S761, Set Live (and "Post everywhere", the same action) put the rental
// on its Vacantless page and a connected Facebook Page, and nothing else:
// Kijiji, Rentals.ca and Zumper were only queued when the landlord clicked a
// site row one at a time (REVIEW-S761 section 1, measured on Lakeview's Set
// Live of 2026-11-06, which staged no run). This module decides, without I/O,
// which robot sites Set Live should queue for a rental, so that "connect your
// sites once, then Set Live posts everywhere" is what the product does.
//
// It queues a site only when every one of these holds:
//   - the org may use robot posting (the Posting add-on, or grandfathered);
//   - the standing setting "post without asking each time" is on (S754);
//   - the site is shown to this org and connected (its tile is not a sign-in
//     state: S760c already refuses to park an item on a signed-out site);
//   - nothing is already live, queued or waiting for the landlord on that site
//     for this rental (an upsert would overwrite an in-flight item's status).
// ============================================================================

import { SITE_SIGNIN_ORDER, signinNeeded, type SiteSigninChannel } from "./site-signin";

export type SetLivePostsInput = {
  postingAllowed: boolean;
  autopilot: boolean | null | undefined;
  /** Tile state by channel key (linked, not_linked, dead_session, checking, ...). */
  tileStateByChannel: Readonly<Record<string, string | null | undefined>>;
  /** Items already on the rental's active run: channel to publish_status. */
  existingItemStatusByChannel?: Readonly<Record<string, string | null | undefined>>;
  hiddenFor?: (channel: string) => boolean;
};

/** An item in one of these states is left alone: it is up, on its way, or waiting for the landlord. */
export const SET_LIVE_LEAVE_ALONE_STATUSES: readonly string[] = [
  "live",
  "queued",
  "submitting",
  "submitted",
  "needs_payment",
  "needs_operator",
  "needs_login",
];

export function robotSitesToPostAtSetLive(input: SetLivePostsInput): SiteSigninChannel[] {
  if (!input.postingAllowed || input.autopilot !== true) return [];
  const hidden = input.hiddenFor ?? (() => false);
  const existing = input.existingItemStatusByChannel ?? {};
  const out: SiteSigninChannel[] = [];
  for (const channel of SITE_SIGNIN_ORDER) {
    if (hidden(channel)) continue;
    const state = input.tileStateByChannel[channel] ?? "not_linked";
    if (signinNeeded(state)) continue;
    const itemStatus = String(existing[channel] ?? "").trim();
    if (itemStatus && SET_LIVE_LEAVE_ALONE_STATUSES.includes(itemStatus)) continue;
    out.push(channel);
  }
  return out;
}

/** The audit line on an item Set Live queued (plain words, no mechanism). */
export function setLiveAudit(siteLabel: string): string {
  return `Posting now on your ${siteLabel} account, because you pressed Set Live and this site is connected. Press Stop on the rental to hold it.`;
}
