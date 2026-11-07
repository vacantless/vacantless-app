// ============================================================================
// sites-setup (S760). The one-time "Connect your rental sites" step.
//
// A new landlord met six site rows with six different verbs ("Add this site",
// "Fill Marketplace for me", "Post it again", "Turn off auto-post", "Sign in
// once", "Connect") and no moment that said what to do once so that every
// rental they add is posted when they press Set Live. This module turns the
// tile states the app already computes (lib/distribution-channel-tile-statuses)
// into five rows with one state each, and one summary line. Pure: no I/O.
// ============================================================================

import { isRobotPostedChannel } from "@/lib/posting-lanes";
import { SITE_SIGNIN_ORDER, signinNeeded, type SiteSigninChannel } from "@/lib/site-signin";
import { MARKETPLACE_HELPER_INSTALL_URL } from "@/lib/marketplace-helper";

export const SITES_SETUP_HREF = "/dashboard/sites";

/** One state per site, the same four words everywhere. */
export type SiteSetupState = "on" | "needs_you" | "checking" | "with_posting";

export type SiteSetupRow = {
  key: SiteSigninChannel | "facebook_feed" | "facebook_marketplace";
  label: string;
  state: SiteSetupState;
  /** The one-line status under the name. */
  line: string;
  /** The single action for a row that needs the landlord; null otherwise. */
  action: { label: string; href: string; external?: boolean } | null;
  /** A short note under the action (Zumper's ID check, the helper's one rule). */
  note: string | null;
};

export type SitesSetupInput = {
  /** Tile state by channel key (linked, not_linked, dead_session, checking, ...). */
  tileStateByChannel: Readonly<Record<string, string | null | undefined>>;
  /** The org has the Posting add-on (robot sites post for it). */
  postingAllowed: boolean;
  /** true/false once this browser has asked the helper; null before it answers or on a phone. */
  helperInstalled: boolean | null;
  /** Hidden sites for this org (lib/posting-lanes isHiddenForOrg). */
  hiddenFor?: (channel: string) => boolean;
  /** Carry the rental the landlord came from into the sign-in links. */
  propertyId?: string | null;
  /** The Posting add-on's Billing anchor. */
  postingHref: string;
};

export type SitesSetup = {
  rows: SiteSetupRow[];
  connectedCount: number;
  total: number;
  /** "3 of 5 connected" */
  progress: string;
  /** The one line under the title. */
  summary: string;
  /** True once at least one site is On: the onboarding step counts as done. */
  done: boolean;
  /** The first robot site that still needs a sign-in, for the "Sign in to all" button. */
  nextSignin: SiteSigninChannel | null;
};

const ROBOT_LABEL: Record<SiteSigninChannel, string> = {
  kijiji: "Kijiji",
  rentals_ca: "Rentals.ca",
  zumper: "Zumper + PadMapper",
};

const ROBOT_FREE_LINE: Record<SiteSigninChannel, string> = {
  kijiji: "1 free ad per personal account, then $33.84 each, paid on Kijiji.",
  rentals_ca: "Free for up to 3 listings per account.",
  zumper: "Free for up to 5 listings per account.",
};

export function signinChainHref(propertyId?: string | null): string {
  return propertyId ? `/dashboard/site-signin?property=${encodeURIComponent(propertyId)}` : "/dashboard/site-signin";
}

export function buildSitesSetup(input: SitesSetupInput): SitesSetup {
  const hidden = input.hiddenFor ?? (() => false);
  const rows: SiteSetupRow[] = [];

  // 1. Facebook Page: one secure button, posts by API, free on every plan.
  const page = input.tileStateByChannel.facebook_feed;
  if (!hidden("facebook_feed")) {
    if (page === "linked") {
      rows.push({
        key: "facebook_feed",
        label: "Facebook Page",
        state: "on",
        line: "Connected. Every rental you post goes up here on its own.",
        action: null,
        note: null,
      });
    } else if (page === "connected_needs_authorization") {
      rows.push({
        key: "facebook_feed",
        label: "Facebook Page",
        state: "needs_you",
        line: "Connected. Let us post to it.",
        action: { label: "Allow posting", href: "/dashboard/link-portals" },
        note: null,
      });
    } else if (page === "checking") {
      rows.push({
        key: "facebook_feed",
        label: "Facebook Page",
        state: "checking",
        line: "Checking the connection. A few minutes.",
        action: null,
        note: null,
      });
    } else {
      rows.push({
        key: "facebook_feed",
        label: "Facebook Page",
        state: "needs_you",
        line: "Free. One secure button, then we post every rental to your Page.",
        action: { label: "Connect", href: "/api/integrations/facebook/connect" },
        note: null,
      });
    }
  }

  // 2. Marketplace: the helper on this computer; Facebook makes a person press Post.
  if (!hidden("facebook_marketplace")) {
    if (input.helperInstalled === true) {
      rows.push({
        key: "facebook_marketplace",
        label: "Facebook Marketplace",
        state: "on",
        line: "The helper is in your Chrome. One click fills the ad and photos; you press Facebook's Post button.",
        action: null,
        note: null,
      });
    } else if (input.helperInstalled === false) {
      rows.push({
        key: "facebook_marketplace",
        label: "Facebook Marketplace",
        state: "needs_you",
        line: "Free. Install the helper once, about 20 seconds.",
        action: { label: "Install the helper", href: MARKETPLACE_HELPER_INSTALL_URL, external: true },
        note: "Facebook only lets a person press Post on Marketplace. The helper fills the ad and photos; you press Post.",
      });
    } else {
      rows.push({
        key: "facebook_marketplace",
        label: "Facebook Marketplace",
        state: "needs_you",
        line: "Free. On a computer, install the helper once, about 20 seconds.",
        action: { label: "Install the helper", href: MARKETPLACE_HELPER_INSTALL_URL, external: true },
        note: "On your phone, the Marketplace kit on each rental does the same job.",
      });
    }
  }

  // 3-5. The robot sites, in the sign-in order.
  let nextSignin: SiteSigninChannel | null = null;
  for (const key of SITE_SIGNIN_ORDER) {
    if (hidden(key)) continue;
    // No tile row yet (a brand-new org) means not signed in.
    const state = input.tileStateByChannel[key] ?? "not_linked";
    if (!input.postingAllowed) {
      rows.push({
        key,
        label: ROBOT_LABEL[key],
        state: "with_posting",
        line: `With Posting, $49 a month. ${ROBOT_FREE_LINE[key]}`,
        action: { label: "Add Posting", href: input.postingHref },
        note: null,
      });
      continue;
    }
    if (state === "checking") {
      rows.push({ key, label: ROBOT_LABEL[key], state: "checking", line: "Checking your sign-in. A few minutes.", action: null, note: null });
      continue;
    }
    if (!signinNeeded(state)) {
      rows.push({
        key,
        label: ROBOT_LABEL[key],
        state: "on",
        line: `Signed in. We post, renew and take down your ads here. ${ROBOT_FREE_LINE[key]}`,
        action: null,
        note: null,
      });
      continue;
    }
    if (!nextSignin) nextSignin = key;
    rows.push({
      key,
      label: ROBOT_LABEL[key],
      state: "needs_you",
      line:
        state === "dead_session"
          ? "Your sign-in ended. Sign in again, about 2 minutes."
          : `Sign in once, about 2 minutes. ${ROBOT_FREE_LINE[key]}`,
      action: { label: state === "dead_session" ? "Sign in again" : "Sign in once", href: signinChainHref(input.propertyId) },
      note: key === "zumper" ? "Zumper checks your ID before it lets you post. Do that on Zumper today; it can take a day." : null,
    });
  }

  const connectedCount = rows.filter((r) => r.state === "on").length;
  const total = rows.length;
  const needs = rows.filter((r) => r.state === "needs_you").length;
  const withPosting = rows.filter((r) => r.state === "with_posting").length;
  const summary =
    total === 0
      ? "No sites to connect."
      : connectedCount === total
        ? "Every site is connected. Post a rental and it goes up on each one."
        : needs === 0 && withPosting > 0
          ? "Your free sites are connected. Add Posting and we post to the other three for you."
          : "Do this once. After it, post a rental and it goes up on every site here. Some sites sign you out every few weeks; we tell you when.";

  return {
    rows,
    connectedCount,
    total,
    progress: `${connectedCount} of ${total} connected`,
    summary,
    done: connectedCount > 0,
    nextSignin,
  };
}

/** Server-side "has this org connected at least one site" for the onboarding checklist (the helper is browser-only and not counted). */
export function orgHasConnectedSite(
  tileStateByChannel: Readonly<Record<string, string | null | undefined>>,
): boolean {
  if (tileStateByChannel.facebook_feed === "linked") return true;
  return SITE_SIGNIN_ORDER.some((k) => tileStateByChannel[k] != null && !signinNeeded(tileStateByChannel[k]) && tileStateByChannel[k] !== "checking");
}

/** The four words a site can read on a rental's Get online tab. */
export type SiteWord = "On" | "Posting" | "Needs you" | "Off";
export const SITE_WORD_CLASS: Record<SiteWord, string> = {
  On: "bg-green-50 text-green-700",
  Posting: "bg-sky-50 text-sky-700",
  "Needs you": "bg-amber-50 text-amber-800",
  Off: "bg-gray-100 text-gray-600",
};

export function isRobotSite(key: string): boolean {
  return isRobotPostedChannel(key);
}
