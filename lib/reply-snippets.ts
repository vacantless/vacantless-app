// ============================================================================
// Pure reply-snippet builder (S412 Slice 2). No DOM / env / IO — unit-tested
// (scripts/test-reply-snippets.ts).
//
// When a renter messages an operator on Facebook Marketplace / Kijiji, the
// operator replies by hand. These are ready-to-paste replies that route the
// renter to the branded booking page. Facebook mangles clickable links inside
// DMs (KI590), so the FB snippets tell the renter to COPY the link into their
// browser rather than tap it. House rules carry from listing-copy: hyphens not
// em dashes; never fabricate claims.
// ============================================================================

export type ReplySnippet = {
  key: string;
  label: string;
  text: string;
};

// Channels where a link inside a message is unreliable (Facebook DMs strip or
// break links), so the snippet says "copy this into your browser".
const LINK_UNRELIABLE = new Set(["facebook"]);

export function buildReplySnippets(opts: {
  channelKey: string;
  address: string;
  // The tracked booking link, or null when the rental isn't Live yet.
  bookingUrl: string | null;
  rentLabel?: string | null; // e.g. "$1,295/mo"
}): ReplySnippet[] {
  const { channelKey, address, bookingUrl, rentLabel } = opts;
  const linkLine = bookingUrl
    ? LINK_UNRELIABLE.has(channelKey)
      ? `Here are the details and the viewing calendar - copy this into your browser: ${bookingUrl}`
      : `Here are the details and the viewing calendar: ${bookingUrl}`
    : "I'll send you the details and viewing link shortly.";

  const rentBit = rentLabel ? ` It's ${rentLabel}.` : "";

  const snippets: ReplySnippet[] = [
    {
      key: "available",
      label: "It's available",
      text: `Hi! Yes, ${address} is still available.${rentBit} ${linkLine}`,
    },
    {
      key: "book",
      label: "How to book a viewing",
      text: bookingUrl
        ? `You can see photos, all the details, and book a viewing time here${
            LINK_UNRELIABLE.has(channelKey)
              ? " (copy into your browser)"
              : ""
          }: ${bookingUrl} Pick any open slot that works for you.`
        : `I'll send you a link to book a viewing time as soon as the listing is live.`,
    },
    {
      key: "details",
      label: "Send details",
      text: `Thanks for your interest in ${address}.${rentBit} ${linkLine}`,
    },
  ];
  return snippets;
}
