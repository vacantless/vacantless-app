// ============================================================================
// needs-you (S761). The one card on Today for a site that stopped posting.
//
// When Kijiji, Rentals.ca or Zumper signs a landlord out, posting there stops
// until they sign in again. Before S761 the only places that said so were a
// site row deep inside a rental's Get online tab and one email (S736), and
// 8 of Agile's 14 sign-in windows in 45 days ran out before anyone signed in
// (REVIEW-S761 section 1). This module turns the tile states the app already
// computes into one short notice per site, with the one button that opens the
// sign-in page. Pure: no I/O.
// ============================================================================

import { SITE_SIGNIN_LABEL, SITE_SIGNIN_ORDER, siteSigninHref, type SiteSigninChannel } from "./site-signin";

export type NeedsYouNotice = {
  channel: SiteSigninChannel;
  /** "Zumper signed you out." */
  title: string;
  /** "Posting there stopped. Sign in again, about 2 minutes." */
  line: string;
  action: { label: string; href: string };
};

export type NeedsYouInput = {
  /** The org may use robot posting (the Posting add-on, or grandfathered). */
  postingAllowed: boolean;
  /** Tile state by channel key (linked, not_linked, dead_session, checking, ...). */
  tileStateByChannel: Readonly<Record<string, string | null | undefined>>;
  hiddenFor?: (channel: string) => boolean;
};

/**
 * Only a session that worked and then died earns a card. A site never signed
 * in to is a setup step (the sites page), not an interruption.
 */
export function needsYouNotices(input: NeedsYouInput): NeedsYouNotice[] {
  if (!input.postingAllowed) return [];
  const hidden = input.hiddenFor ?? (() => false);
  const out: NeedsYouNotice[] = [];
  for (const channel of SITE_SIGNIN_ORDER) {
    if (hidden(channel)) continue;
    if (input.tileStateByChannel[channel] !== "dead_session") continue;
    const name = SITE_SIGNIN_LABEL[channel];
    out.push({
      channel,
      title: `${name} signed you out.`,
      line: "Posting there stopped. Sign in again, about 2 minutes. Your other sites keep working.",
      action: { label: `Sign in to ${name}`, href: siteSigninHref(channel) },
    });
  }
  return out;
}
